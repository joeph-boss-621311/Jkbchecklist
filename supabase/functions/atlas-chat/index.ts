// Supabase Edge Function: proxies Atlas's chat to Grok (xAI), keeping the
// API key server-side. Deploy this from the Supabase dashboard:
// Edge Functions -> atlas-chat -> Code -> paste this file -> Deploy.
//
// Secrets needed (Edge Functions -> Secrets, or `supabase secrets set`):
//   XAI_API_KEY   - your xAI key (never put this in app.html or git)
//   XAI_MODEL     - optional, defaults to "grok-4-1-fast" (cheap tier)
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
// platform - no need to set those yourself.
//
// When the client sends a Google access token (the user's own, from
// Google Identity Services in app.html - never a secret this function
// owns), Atlas also gets two tools: searching Gmail and creating
// Calendar events, both scoped to whatever the user consented to.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_gmail",
      description: "Search the user's Gmail and return matching messages (sender, subject, date, snippet). Use Gmail search syntax.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query, e.g. 'is:unread newer_than:3d' or 'from:client@example.com'" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Create an event on the user's primary Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title" },
          start: { type: "string", description: "ISO 8601 datetime, e.g. 2026-09-26T14:00:00" },
          end: { type: "string", description: "ISO 8601 datetime" },
          description: { type: "string" },
          timeZone: { type: "string", description: "IANA timezone, e.g. Africa/Lagos. Default: UTC." },
        },
        required: ["summary", "start", "end"],
      },
    },
  },
];

async function searchGmail(token: string, query: string) {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=8`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) return { error: "Gmail search failed", detail: await listRes.text() };
  const list = await listRes.json();
  const ids = (list.messages || []).map((m: { id: string }) => m.id);
  const msgs = await Promise.all(ids.map(async (id: string) => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return null;
    const m = await r.json();
    const h = (name: string) => (m.payload?.headers || []).find((x: { name: string }) => x.name === name)?.value || "";
    return { from: h("From"), subject: h("Subject"), date: h("Date"), snippet: m.snippet };
  }));
  return { messages: msgs.filter(Boolean) };
}

async function createCalendarEvent(token: string, args: { summary: string; start: string; end: string; description?: string; timeZone?: string }) {
  const tz = args.timeZone || "UTC";
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: args.summary,
      description: args.description,
      start: { dateTime: args.start, timeZone: tz },
      end: { dateTime: args.end, timeZone: tz },
    }),
  });
  if (!res.ok) return { error: "Calendar event failed", detail: await res.text() };
  const ev = await res.json();
  return { ok: true, id: ev.id, htmlLink: ev.htmlLink };
}

async function runTool(name: string, args: Record<string, unknown>, googleToken: string | null) {
  if (!googleToken) return { error: "Google isn't connected." };
  try {
    if (name === "search_gmail") return await searchGmail(googleToken, String(args.query || ""));
    if (name === "create_calendar_event") {
      return await createCalendarEvent(googleToken, args as { summary: string; start: string; end: string; description?: string; timeZone?: string });
    }
  } catch (e) {
    return { error: String(e) };
  }
  return { error: "Unknown tool" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Only a signed-in owner of this project may spend the Grok key.
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Not signed in." }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { turns, modelTier, image, imageType, googleToken } = await req.json();
    if (!Array.isArray(turns) || !turns.length) {
      return new Response(JSON.stringify({ error: "No message." }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const messages: Record<string, unknown>[] = turns.map((t: { role: string; content: string }, i: number) => {
      // Attach the image (if any) to the last user turn.
      if (image && i === turns.length - 1 && t.role === "user") {
        return {
          role: t.role,
          content: [
            { type: "text", text: t.content },
            { type: "image_url", image_url: { url: `data:${imageType || "image/jpeg"};base64,${image}` } },
          ],
        };
      }
      return { role: t.role, content: t.content };
    });

    const model = modelTier === "default"
      ? (Deno.env.get("XAI_MODEL_HEAVY") || "grok-4-1")
      : (Deno.env.get("XAI_MODEL") || "grok-4-1-fast");

    let finalText = "";
    for (let round = 0; round < 4; round++) {
      const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("XAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model, messages, temperature: 0.4,
          ...(googleToken ? { tools: TOOLS, tool_choice: "auto" } : {}),
        }),
      });

      if (!grokRes.ok) {
        const detail = await grokRes.text();
        return new Response(JSON.stringify({ error: "Grok request failed", detail }), {
          status: 502,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const data = await grokRes.json();
      const choice = data?.choices?.[0];
      const msg = choice?.message;
      const toolCalls = msg?.tool_calls;

      if (Array.isArray(toolCalls) && toolCalls.length) {
        messages.push(msg);
        for (const call of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { /* leave empty */ }
          const result = await runTool(call.function?.name, args, googleToken || null);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue; // let Grok see the tool results and respond again
      }

      finalText = msg?.content || "";
      break;
    }

    let parsed;
    try {
      const jsonText = finalText.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "");
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = { reply: finalText, actions: [] };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
