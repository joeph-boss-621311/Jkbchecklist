// Supabase Edge Function: per-task push notifications. Called by a pg_cron
// job every 5 minutes (see cron.sql) - separate from daily-briefing, which
// only fires at 8am/8pm.
//
// Two things happen here:
// 1. Every task with its own "time" set (from the task sheet or Atlas's
//    {"time":"HH:MM"} action) gets a push the moment that time arrives.
// 2. For any hour in the 10am-midnight window that has NO explicitly-timed
//    task, he still gets pinged once - a relevant open task (due today or
//    overdue, favouring high priority) is picked and nudged about instead,
//    so reminders keep coming roughly hourly even for untimed work.
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
// The hourly-nudge fallback only runs in his stated active hours (matches
// the "10am to midnight" window tasks got spread across).
const NUDGE_START_HOUR = 10;
const NUDGE_END_HOUR = 23; // inclusive

function corsOr401(req: Request): Response | null {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Not authorized" }), { status: 401 });
  }
  return null;
}

type Task = { id: string; text: string; done?: boolean; due?: string | null; time?: string | null; priority?: string };
type Flat = { t: Task; project: string; section: string };

function localNow(): { dateStr: string; minutesSinceMidnight: number } {
  const local = new Date(Date.now() + TZ_OFFSET_MIN * 60000);
  const dateStr = local.toISOString().slice(0, 10);
  const minutesSinceMidnight = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { dateStr, minutesSinceMidnight };
}

function flatten(state: { projects?: { title: string; sections: { name: string; tasks: Task[] }[] }[] }): Flat[] {
  const out: Flat[] = [];
  for (const p of state.projects || []) {
    for (const s of p.sections) {
      for (const t of s.tasks) out.push({ t, project: p.title, section: s.name });
    }
  }
  return out;
}

async function push(supabase: ReturnType<typeof createClient>, userId: string, subs: { endpoint: string; subscription: unknown }[], title: string, body: string) {
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify({ title, body, url: "app.html" }));
    } catch (e) {
      const err = e as { statusCode?: number };
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      } else {
        throw e;
      }
    }
  }
}

Deno.serve(async (req) => {
  const unauth = corsOr401(req);
  if (unauth) return unauth;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { dateStr: today, minutesSinceMidnight: nowMin } = localNow();
  const nowHour = Math.floor(nowMin / 60);

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
    const userId = row.user_id as string;
    const all = flatten(state);

    // ---- 1. explicitly-timed tasks due right now ----
    const dueNow = all.filter(({ t }) => {
      if (t.done || t.due !== today || !t.time) return false;
      const [h, m] = t.time.split(":").map(Number);
      const taskMin = h * 60 + m;
      // eligible once its minute arrives, stays eligible a few minutes in
      // case a cron run was late, never fires for a time long past (e.g. a
      // time added retroactively for earlier today)
      return nowMin >= taskMin && nowMin - taskMin < 6;
    });

    let subs: { endpoint: string; subscription: unknown }[] | null = null;
    const getSubs = async () => subs ?? (subs = (await supabase.from("push_subscriptions").select("endpoint, subscription").eq("user_id", userId)).data || []);

    if (dueNow.length) {
      const { data: already } = await supabase.from("sent_reminders")
        .select("task_id").eq("user_id", userId).eq("day", today).in("task_id", dueNow.map((x) => x.t.id));
      const alreadySent = new Set((already || []).map((x) => x.task_id));
      const toSend = dueNow.filter((x) => !alreadySent.has(x.t.id));
      const theSubs = toSend.length ? await getSubs() : [];
      for (const { t, project, section } of toSend) {
        try {
          await push(supabase, userId, theSubs, t.text, `${project} · ${section}`);
          sent++;
        } catch (e) {
          errors.push(`${userId}/${t.id}: ${String(e)}`);
        }
        await supabase.from("sent_reminders").upsert({ user_id: userId, task_id: t.id, day: today });
      }
    }

    // ---- 2. hourly fallback nudge for hours with nothing explicitly timed ----
    if (nowHour >= NUDGE_START_HOUR && nowHour <= NUDGE_END_HOUR) {
      const { data: nudgedRows } = await supabase.from("hourly_nudges").select("hour, task_id").eq("user_id", userId).eq("day", today);
      const nudgedHours = new Set((nudgedRows || []).map((r) => r.hour as number));
      const nudgedTaskIds = new Set((nudgedRows || []).map((r) => r.task_id as string));

      if (!nudgedHours.has(nowHour)) {
        const hasTimedTaskThisHour = all.some(({ t }) => {
          if (t.done || t.due !== today || !t.time) return false;
          return Math.floor(Number(t.time.split(":")[0])) === nowHour;
        });

        if (!hasTimedTaskThisHour) {
          const relevant = all.filter(({ t }) =>
            !t.done && !t.time && !nudgedTaskIds.has(t.id) &&
            (t.due === today || (t.due && t.due < today)));
          const pool = relevant.filter((x) => x.t.priority === "high").length ? relevant.filter((x) => x.t.priority === "high") : relevant;

          if (pool.length) {
            const pick = pool[Math.floor(Math.random() * pool.length)];
            try {
              const theSubs = await getSubs();
              await push(supabase, userId, theSubs, pick.t.text, `${pick.project} · ${pick.section} — while you've got a minute`);
              sent++;
            } catch (e) {
              errors.push(`${userId}/${pick.t.id} (nudge): ${String(e)}`);
            }
            await supabase.from("hourly_nudges").upsert({ user_id: userId, day: today, hour: nowHour, task_id: pick.t.id });
          }
        }
      }
    }
  }

  // Housekeeping: these tables only need to answer "did this already fire
  // today", so nothing older than a couple of days is useful.
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await supabase.from("sent_reminders").delete().lt("day", cutoff);
  await supabase.from("hourly_nudges").delete().lt("day", cutoff);

  return new Response(JSON.stringify({ sent, errors }), { headers: { "Content-Type": "application/json" } });
});
