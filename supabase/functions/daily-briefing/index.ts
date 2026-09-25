// Supabase Edge Function: the daily briefing. Called by a pg_cron job (see
// cron.sql), not by the app directly - runs across every user, generates a
// short plan/review with Grok, drops it into their Atlas chat, and pushes a
// notification to every device they've enabled it on.
//
// Secrets needed (Edge Functions -> Secrets):
//   XAI_API_KEY            - same one atlas-chat uses
//   XAI_MODEL               - optional, defaults to grok-4-1-fast
//   VAPID_PUBLIC_KEY        - from `npx web-push generate-vapid-keys`
//   VAPID_PRIVATE_KEY       - from the same command - never in app.html or git
//   CRON_SECRET              - a random string you pick; the cron job sends it
//                              back as a header so randoms on the internet
//                              can't trigger this and burn your Grok credits
//   SUPABASE_SERVICE_ROLE_KEY - already present by default on every project

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

function corsOr401(req: Request): Response | null {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Not authorized" }), { status: 401 });
  }
  return null;
}

type TaskLike = { text: string; priority?: string; due?: string | null; done?: boolean };

function briefLine(t: TaskLike, project: string) {
  return `- ${t.text} [${project}${t.priority === "high" ? ", high" : ""}${t.due ? ", due " + t.due : ""}]`;
}

function buildPrompt(kind: "morning" | "evening", state: Record<string, unknown>) {
  const today = new Date().toISOString().slice(0, 10);
  const projects = (state.projects as { title: string; sections: { tasks: TaskLike[] }[] }[]) || [];
  const all: { t: TaskLike; p: string }[] = [];
  projects.forEach((p) => p.sections.forEach((s) => s.tasks.forEach((t) => all.push({ t, p: p.title }))));
  const open = all.filter((x) => !x.t.done);
  const overdue = open.filter((x) => x.t.due && x.t.due < today);
  const doneToday = all.filter((x) => x.t.done && (x.t as unknown as { doneAt?: number }).doneAt &&
    new Date((x.t as unknown as { doneAt: number }).doneAt).toISOString().slice(0, 10) === today);
  const focusIds: string[] = ((state.today as { focus?: string[] })?.focus) || [];
  const focusDate = (state.today as { date?: string })?.date;
  const focusTasks = focusDate === today ? all.filter((x) => focusIds.includes((x.t as unknown as { id: string }).id)) : [];
  const top = open.filter((x) => !focusTasks.includes(x)).slice(0, 15);

  const lines = [
    `Overdue:\n${overdue.length ? overdue.map((x) => briefLine(x.t, x.p)).join("\n") : "- none"}`,
    `Today's focus:\n${focusTasks.length ? focusTasks.map((x) => briefLine(x.t, x.p)).join("\n") : "- not planned"}`,
    `Other open tasks:\n${top.map((x) => briefLine(x.t, x.p)).join("\n")}`,
  ];
  if (kind === "evening") lines.push(`Finished today:\n${doneToday.length ? doneToday.map((x) => briefLine(x.t, x.p)).join("\n") : "- nothing logged"}`);

  const instruction = kind === "morning"
    ? "Write Joseph's morning plan: 2-3 sentences, casual and direct like a smart friend, naming the 1-2 things that matter most today (favour overdue and high priority). No JSON, no bullet list back - just the message."
    : "Write Joseph's evening review: 2-3 sentences, casual and direct, acknowledge what he finished, call out anything overdue he's dodging. No JSON - just the message.";

  return `${instruction}\n\n${lines.join("\n\n")}`;
}

Deno.serve(async (req) => {
  const unauth = corsOr401(req);
  if (unauth) return unauth;

  const { kind } = await req.json().catch(() => ({ kind: "morning" }));
  const briefKind: "morning" | "evening" = kind === "evening" ? "evening" : "morning";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await supabase.from("app_state").select("user_id, state, coach, coach_saved_at");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  webpush.setVapidDetails(
    "mailto:atlas@jkbglobal.site",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const model = Deno.env.get("XAI_MODEL") || "grok-4-1-fast";
  const results: Record<string, string> = {};

  for (const row of rows || []) {
    if (!row.state || !Array.isArray((row.state as { projects?: unknown[] }).projects)) continue;
    try {
      const prompt = buildPrompt(briefKind, row.state as Record<string, unknown>);
      const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("XAI_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.5 }),
      });
      if (!grokRes.ok) { results[row.user_id] = "grok failed"; continue; }
      const data = await grokRes.json();
      const text = (data?.choices?.[0]?.message?.content || "").trim() || "Here's where things stand.";

      const coach = (row.coach as { messages?: unknown[] }) || { messages: [] };
      const messages = Array.isArray(coach.messages) ? coach.messages : [];
      const savedAt = Date.now();
      messages.push({ role: "assistant", content: text, ts: savedAt, changes: [] });
      await supabase.from("app_state").update({
        coach: { ...coach, messages: messages.slice(-40), savedAt },
        coach_saved_at: savedAt,
      }).eq("user_id", row.user_id);

      const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, subscription").eq("user_id", row.user_id);
      const title = briefKind === "morning" ? "Atlas — Morning plan" : "Atlas — Evening review";
      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(sub.subscription, JSON.stringify({ title, body: text.slice(0, 140), url: "app.html" }));
        } catch (e) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
        }
      }
      results[row.user_id] = "ok";
    } catch (e) {
      results[row.user_id] = String(e);
    }
  }

  return new Response(JSON.stringify({ kind: briefKind, results }), { headers: { "Content-Type": "application/json" } });
});
