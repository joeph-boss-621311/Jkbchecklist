# JKB Ops — Supabase backend

Everything here is done from the Supabase dashboard in your phone's browser — no CLI needed.

## 1. Create the database table

Dashboard → **SQL Editor** → New query → paste the contents of `schema.sql` → Run.

## 2. Turn on email sign-in

Dashboard → **Authentication** → Providers → make sure **Email** is enabled.
Then **Authentication** → Users → **Add user** → create yourself an account
(your email + a password). This is the only login the app will ever need.

## 3. Add the Grok key as a secret

Dashboard → **Edge Functions** → **Secrets** → add:
- `XAI_API_KEY` = your xAI key (the one you generated at console.x.ai)

Leave `XAI_MODEL` / `XAI_MODEL_HEAVY` unset — the function defaults to the
cheap `grok-4.1-fast` model, which is plenty for Atlas.

## 4. Deploy the Atlas chat function

Dashboard → **Edge Functions** → **Create a new function** → name it
`atlas-chat` → paste the contents of `functions/atlas-chat/index.ts` → Deploy.

## 5. Note your project's public info

You'll need these two values (both safe to put in app.html — they're
public by design, the login + row-level security is what actually protects
your data):
- **Project URL**: `https://nbgmegpqxzvgvtqqlvko.supabase.co`
- **anon/publishable key**: the `sb_publishable_...` key from Settings → API

Once all five steps are done, tell Claude "supabase is set up" and the
app.html rewrite (login screen + reading/writing this database instead of
the claude.ai artifact) can go in.

## Daily briefing (push notifications)

`functions/daily-briefing/index.ts` runs on a schedule (see `cron.sql`),
generates a short morning plan / evening review with Grok, drops it into
Atlas's chat, and pushes a notification to every device that's turned it on
(Settings menu → Daily briefing, in the app).

Secrets it needs beyond the ones above: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
(generate with `npx web-push generate-vapid-keys` — the public key also goes
into `VAPID_PUBLIC_KEY` in app.html) and `CRON_SECRET` (any random string —
it's how the cron job proves it's really the cron job, not a stranger trying
to burn your Grok credits). Run `cron.sql` once, with that same secret
substituted in, to actually schedule it.

## Per-task reminders (a notification for each task's own time, not just 8am/8pm)

Every task can now carry a "time" (set it in the task sheet, or tell Atlas
"remind me at 3pm" / "add a time to that"). `functions/task-reminders/index.ts`
checks every 5 minutes for tasks whose time has arrived and pushes one
notification per task — completely separate from the daily briefing above.

It also fills the gaps: for any hour between 10am and midnight with nothing
explicitly timed, it picks one relevant open task (due today or overdue,
favouring high priority) and nudges about that instead — so reminders keep
coming roughly hourly even for tasks that never got a time set.

To turn it on:
1. Re-run `schema.sql` (it adds `sent_reminders` and `hourly_nudges`, the two
   tables this function needs — safe to re-run, everything in it is
   "if not exists").
2. Dashboard → **Edge Functions** → **Create a new function** → name it
   `task-reminders` → paste the contents of `functions/task-reminders/index.ts`
   → Deploy.
3. It reuses `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` and
   `SUPABASE_SERVICE_ROLE_KEY` — nothing new to add if the daily briefing is
   already set up.
4. Run the new `atlas-task-reminders` block in `cron.sql` (same file as
   before — it's been added at the bottom), with `<CRON_SECRET>` swapped for
   your real one.

Once that's running, notifications work the same way for a single task as
they do for the morning/evening briefing — no extra setup per task, just set
a time on it.
