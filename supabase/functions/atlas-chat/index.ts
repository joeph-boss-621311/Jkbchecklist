// Supabase Edge Function: proxies Atlas's chat to Grok (xAI), keeping the
// API key server-side. Deploy this from the Supabase dashboard:
// Edge Functions -> Create function -> name it "atlas-chat" -> paste this file.
//
// Secrets needed (Edge Functions -> Secrets, or `supabase secrets set`):
//   XAI_API_KEY   - your xAI key (never put this in app.html or git)
//   XAI_MODEL     - optional, defaults to "grok-4-1-fast" (cheap tier)
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
// platform - no need to set those yourself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { turns, modelTier, image, imageType } = await req.json();
    if (!Array.isArray(turns) || !turns.length) {
      return new Response(JSON.stringify({ error: "No message." }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const messages = turns.map((t: { role: string; content: string }, i: number) => {
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

    const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("XAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0.4 }),
    });

    if (!grokRes.ok) {
      const detail = await grokRes.text();
      return new Response(JSON.stringify({ error: "Grok request failed", detail }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const data = await grokRes.json();
    const text = data?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const jsonText = text.trim().replace(/^```(?:json)?\n?/, "").replace(/```$/, "");
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = { reply: text, actions: [] };
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
