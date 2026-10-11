# JKB Ops — notes for Claude

Joseph's ("boss") operations checklist for JKB Global, SafeGate, CVG, SEG, FloatBook, JKB Lux and his
weekly CEO routine, plus **Atlas**, the in-app AI coach that manages the list with him by chat.
You're his co-founder-level operator here: call him "boss", be direct, get things done.

## What's where

- `app.html` — the whole app: one HTML file, no build step, no framework. This is what he uses.
- `index.html` — the landing page; `voice.html` — JKB Voice (live ElevenLabs voice coach).
- Hosting: the JKB server (Caddy) at **https://checklist.jkbglobal.site**. This repo is the editing copy at
  `Live Project/checklist`; deploy with `bash "Live Project/publish.sh" checklist` (`--dry-run` first,
  `--rollback checklist` to undo), only when boss says to go live. `.publish-exclude` keeps the CLI, MCP
  connector and tests off the web. GitHub `main` is the code backup; its Pages site only redirects to
  checklist.jkbglobal.site (the `CNAME` file).
- Backend: **Supabase project `nbgmegpqxzvgvtqqlvko`** (`https://nbgmegpqxzvgvtqqlvko.supabase.co`), set up as
  in `supabase/README.md`:
  - `app_state` — one row per user: `state` (the checklist) and `coach` (Atlas's chat log), each jsonb with its
    own `state_saved_at` / `coach_saved_at`. Row Level Security: a user can only see and change their own row.
  - `push_subscriptions`, `sent_reminders`, `hourly_nudges` — web push and reminder bookkeeping.
  - Edge Functions: `atlas-chat` (Atlas, on Grok/xAI; can search Gmail/Calendar when Google is connected),
    `daily-briefing` (8 AM / 8 PM WAT plan and review), `task-reminders` (every 5 min: a push at each task's
    `time`, plus one nudge per hour 10 AM–midnight when nothing is timed).
  - `pg_cron` jobs from `supabase/cron.sql` call those functions with an `x-cron-secret` header.

## Joseph's data

`state` has the shape `{ v:2, nextId, savedAt, projects:[{id, emoji, title, sections:[{id, name, tasks}]}],
today:{date, focus, note}, checkins, sessions }`. A task is `{ id, text, done, doneAt, priority, due, time,
repeat, tags, subtasks, minutes, createdAt }`.

Sync works like this: the app writes the whole `state` with `state_saved_at = state.savedAt`; the newest
save wins, and Supabase Realtime pushes it to his other open devices.

**The old claude.ai artifact (`1puenyhWtJ8GhNQZvAcqm8`) and the ArtifactData pull/push workflow are dead.**
They hold a frozen copy from before the move to Supabase, so anything written there never reaches him.
Never use them.

## Changing his tasks

1. **Best:** he tells Atlas in the app (every Atlas change has an Undo button).
2. **From Claude Code:** the `jkb` CLI (`node cli.js …`) or the `jkb-checklist` MCP tools. They read and
   write his real `app_state` row **signed in as him**, and every write is a compare-and-swap on
   `state_saved_at`: if the app saved in between, the write is refused, re-read, and the same change is
   applied on top. Something he just did on his phone is never overwritten.
3. **Never** write `app_state` with SQL, the service-role key or the Management API. That bypasses his own
   session and the conflict check and can silently wipe edits he's making right now.

Also: don't write the `coach` chat log or `checkins` from here, and confirm before deleting tasks or projects.

### Signing the tools in (stored in `.jkb/session.json`, git-ignored, mode 600)

- At a computer: `node cli.js login` (his JKB Ops email, then the password, which isn't echoed).
- From his phone, through you: `node cli.js login --email <his email>`. Supabase emails him a one-time
  sign-in link. He must **not tap it** (tapping uses it up): he long-presses it, copies it and pastes it to
  you, then you run `node cli.js login --link '<that link>'`. It works once and expires after an hour.
- `node cli.js whoami` shows who's signed in; `node cli.js logout` signs out.
- MCP tools: `get_login_info`, `get_status`, `list_tasks`, `search_tasks`, `add_task`, `set_task_done`,
  `edit_task`, `delete_task`, `add_project`, `add_section`.

## What boss usually wants

- "What's next?" → `get_status`, then the top 3–5 open tasks (today's focus first, then overdue, high
  priority and due soon) with a one-line reason each.
- "Done with X" → `search_tasks`, confirm if more than one matches, `set_task_done`.
- "Add …" → best-fitting project/section (unknown section → Inbox, like the app); set priority / due /
  time / repeat when he mentions them.
- Weekly review → progress per project from `get_status`; call out neglected projects; suggest what to drop.
- 15 multi-step project tasks (SafeGate ads/referrals/partnerships, FloatBook integrations, CVG infra…)
  were left without dates on purpose. Ask him before scheduling them.

## Backend operations

- **Deploying an Edge Function:** use the multipart endpoint `POST /v1/projects/{ref}/functions/deploy?slug={slug}`
  (a `metadata` part `{"entrypoint_path":"index.ts","name":"{slug}"}` plus a `file` part with `index.ts`).
  The JSON-body endpoint returns 200 but produces a function that crashes at runtime.
- **Every redeploy resets `verify_jwt` to true.** The cron-called functions need it false
  (`PATCH /v1/projects/{ref}/functions/{slug}` with `{"verify_jwt": false}`), or the cron calls get 401.
- **`CRON_SECRET`** lives in two places that must match: Edge Functions → Secrets, and the literal header
  value inside each `cron.schedule(...)` job. Rotate both together. Never commit its value.
- Secrets he holds (never in code, chat logs or git): `XAI_API_KEY`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
  (the public one is also the `VAPID_PUBLIC_KEY` constant in `app.html`), `CRON_SECRET`, and a Supabase
  personal access token if he gives you one for Management API work. Confirm with him before using it.

## Rules for this repo

- The repo is **public**. Never commit `.jkb/`, `.env`, tokens, secrets or handoff notes that contain them.
- `npm test` before pushing anything that touches `lib/`, `cli.js` or `mcp.js`.
- All checklist rules live in `lib/tasks.js` and mirror `app.html` (id counter, recurring tasks, Inbox
  fallback, focus cleanup, `savedAt` bump). Change both together.
- Header is `position:fixed` (not sticky: iOS ghosting bug), and the viewport meta has
  `interactive-widget=resizes-content`. Don't add JS keyboard workarounds. The quick-action chip row above
  the composer was removed at his request; don't bring it back.

## Development

`npm test` runs the `lib/tasks.js` unit tests, an end-to-end MCP test (local-file mode: set
`JKB_STATE_FILE` to a JSON file with the same shape) and `lib/store.js` tests against a fake Supabase.
