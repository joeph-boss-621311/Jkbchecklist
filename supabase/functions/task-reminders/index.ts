// Supabase Edge Function: per-task push notifications. Called by a pg_cron
// job every 5 minutes (see cron.sql) - separate from daily-briefing, which
// only fires at 8am/8pm. This checks every task that has its own "time" set
// (from the task sheet or Atlas's {"time":"HH:MM"} action) and pushes a
// notification the moment that time arrives.
//
// Secrets needed (Edge Functions -> Secrets), same names daily-briefing uses:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  - from `npx web-push generate-vapid-keys`
//   CRON_SECRET                          - the cron job sends it back as a header
//   SUPABASE_SERVICE_ROLE_KEY            - already present by default

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Every task time in the app is "his local time" — this project has always
// meant Africa/Lagos (WAT, UTC+1, no DST). Same assumption daily-briefing's
// cron comments make ("7am UTC = 8am WAT").
const TZ_OFFSET_MIN = 60;

function corsOr401(req: Request): Response | null {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Not authorized" }), { status: 401 });
  }
  return null;
}

type Task = { id: string; text: string; done?: boolean; due?: string | null; time?: string | null };

function localNow(): { dateStr: string; minutesSinceMidnight: number } {
  const local = new Date(Date.now() + TZ_OFFSET_MIN * 60000);
  const dateStr = local.toISOString().slice(0, 10);
  const minutesSinceMidnight = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { dateStr, minutesSinceMidnight };
}

Deno.serve(async (req) => {
  const unauth = corsOr401(req);
  if (unauth) return unauth;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { dateStr: today, minutesSinceMidnight: nowMin } = localNow();

  const { data: rows, error } = await supabase.from("app_state").select("user_id, state");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  webpush.setVapidDetails(
    "mailto:atlas@jkbglobal.site",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  let sent = 0;
  const errors: string[] = [];

  for (const row of rows || []) {
    const state = row.state as { projects?: { title: string; sections: { name: string; tasks: Task[] }[] }[] } | null;
    if (!state || !Array.isArray(state.projects)) continue;

    const due: { t: Task; project: string; section: string }[] = [];
    for (const p of state.projects) {
      for (const s of p.sections) {
        for (const t of s.tasks) {
          if (t.done || t.due !== today || !t.time) continue;
          const [h, m] = t.time.split(":").map(Number);
          const taskMin = h * 60 + m;
          // Cron runs every 5 minutes - a task is "due now" once its minute has
          // arrived and stays eligible for a few minutes in case a run was late,
          // but never fires for a time that's already well in the past (e.g. a
          // task time added retroactively for earlier today).
          if (nowMin >= taskMin && nowMin - taskMin < 6) due.push({ t, project: p.title, section: s.name });
        }
      }
    }
    if (!due.length) continue;

    // Skip tasks this function already pushed for today.
    const { data: already } = await supabase.from("sent_reminders")
      .select("task_id").eq("user_id", row.user_id).eq("day", today).in("task_id", due.map((x) => x.t.id));
    const alreadySent = new Set((already || []).map((x) => x.task_id));
    const toSend = due.filter((x) => !alreadySent.has(x.t.id));
    if (!toSend.length) continue;

    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, subscription").eq("user_id", row.user_id);

    for (const { t, project, section } of toSend) {
      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(sub.subscription, JSON.stringify({
            title: t.text,
            body: `${project} · ${section}`,
            url: "app.html",
          }));
          sent++;
        } catch (e) {
          const err = e as { statusCode?: number };
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          } else {
            errors.push(`${row.user_id}/${t.id}: ${String(e)}`);
          }
        }
      }
      await supabase.from("sent_reminders").upsert({ user_id: row.user_id, task_id: t.id, day: today });
    }
  }

  // Housekeeping: this table only needs to answer "did today's reminder for
  // this task already go out", so nothing older than a couple of days is useful.
  await supabase.from("sent_reminders").delete().lt("day", new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));

  return new Response(JSON.stringify({ sent, errors }), { headers: { "Content-Type": "application/json" } });
});
