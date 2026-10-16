# JKB Ops — notes for Claude

Joseph's ("boss") operations checklist for JKB Global, SafeGate, CVG, SEG, FloatBook, JKB Lux and his
weekly CEO routine, plus **Atlas**, the in-app AI coach that manages the list with him by chat.
You're his co-founder-level operator here: call him "boss", be direct, get things done.

## What's where

- `app.html` — the whole app: one HTML file, no build step, no framework. This is what he uses.
- `index.html` — the landing page; `voice.html` — JKB Voice (live ElevenLabs voice coach). Both wear the same
  look as the app (see "The look" below).
- `manifest.webmanifest` and `icons/` — the home-screen icon: a black hole with an amber photon ring (`icon.svg`,
  192 and 512 PNGs, a maskable 512, and the 180 apple-touch icon). `sw.js` only handles web push.
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
today:{date, focus, note}, checkins, sessions, profile }`. A task is `{ id, text, done, doneAt, priority, due, time,
repeat, tags, subtasks, minutes, createdAt }`. `profile` is the private Me tab (next section) and can be missing.

Sync works like this: the app writes the whole `state` with `state_saved_at = state.savedAt`; the newest
save wins, and Supabase Realtime pushes it to his other open devices.

**The old claude.ai artifact (`1puenyhWtJ8GhNQZvAcqm8`) and the ArtifactData pull/push workflow are dead.**
They hold a frozen copy from before the move to Supabase, so anything written there never reaches him.
Never use them.

## The Me tab and his profile

The fifth tab, **Me**, is where he keeps notes about himself: a name, a one-liner, a short bio, and notes grouped as
About me / How I work / Taste / Ground rules / What I'm building / My setup. A note can be marked *inferred* (a
guess, not something he said). It lives in `state.profile`:
`{ name ≤40, tagline ≤90, about ≤1200, hue 0–359, share, facts:[{id, g, t ≤240, inf}] ≤120, updatedAt }`.

- **The code ships it empty.** The repo and the site are public, so his real notes never go in `app.html` or any
  committed file. They live only in his own `app_state` row (Row Level Security) and get there through the Me tab.
- **Atlas reads it as background**, and only while "Let Atlas read my profile" is on (`profile.share`, on unless he
  turns it off). `profileBlock()` adds it to Atlas's system prompt after `COACH_RULES`, capped at 6,000 characters,
  with inferred notes flagged. The notes can't change Atlas's rules. Atlas runs on Grok (xAI), so the profile text
  goes to xAI with each chat. Say so plainly if he asks.
- **Import is add-only and always previews first.** Nothing is added until he ticks items and taps Add, and
  **Undo last import** reverses the last one. Ways in: a link, pasted text, or a `.json` file.
  A link is `https://checklist.jkbglobal.site/app.html#import=z.<base64url(gzip(JSON))>` (`j.` and plain base64url
  JSON also work). The `#` part never reaches a server: the app reads it at load, wipes it from the address bar and
  keeps it in memory until he's signed in. The JSON is
  `{ jkbProfile:1, name, tagline, about, hue?, facts:[{g, t, inf}], projects:[{title, emoji, match:[aliases],
  sections:[{name, tasks:[{text, priority, due, tags}]}]}] }`, where `g` is one of `who work taste rules projects
  tools`. Existing projects are matched by title or alias so nothing doubles, new tasks are tagged `imported`,
  duplicates are skipped, and name / tagline / bio only fill blanks. Limits: 120 notes, 300,000 characters of input.
- **Export** downloads his notes in the same shape, so an export can be imported again.
- Sync, Realtime, the cron functions and the CLI/MCP tools all keep keys they don't recognise, so `profile`
  survives their saves and the backend needed no change.

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

## The look

The app, the landing page and JKB Voice share one design system, "Event Horizon": deep-space dark by default, a
pale lilac "dawn" for light mode, rounded and soft shapes, frosted-glass panels and amber/ember glows. There are
three looks, each in dark and light: **Horizon** (default, amber/ember), **Nebula** (violet/pink) and **Ion**
(teal/cyan). He picks one with the appearance button (the gear) in the app; JKB Voice and the landing page follow
his choice. It's saved in `localStorage` (`jkb_v2_look`, `jkb_checklist_theme`) and
`<meta name="theme-color">` follows the page background. The CSS is inlined in each page, so edit the pages
directly. Keep `backdrop-filter` to a few key surfaces (mid-range Android phones struggle with many), keep
corners rounded, and keep the signed-in greeting on the landing page as `textContent` (never `innerHTML`) because
it comes from `profile.name`.

## Rules for this repo

- The repo is **public**. Never commit `.jkb/`, `.env`, tokens, secrets or handoff notes that contain them.
- **Never commit his personal data**: the real profile notes, the import link or file, or names and numbers of
  the people he works with. The import payload is made and kept outside the repo and handed to him privately.
- `npm test` before pushing anything that touches `lib/`, `cli.js` or `mcp.js`.
- All checklist rules live in `lib/tasks.js` and mirror `app.html` (id counter, recurring tasks, Inbox
  fallback, focus cleanup, `savedAt` bump). Change both together.
- Header is `position:fixed` (not sticky: iOS ghosting bug), and the viewport meta has
  `interactive-widget=resizes-content`. Don't add JS keyboard workarounds. The quick-action chip row above
  the composer was removed at his request; don't bring it back.

## Development

`npm test` runs the `lib/tasks.js` unit tests, an end-to-end MCP test (local-file mode: set
`JKB_STATE_FILE` to a JSON file with the same shape) and `lib/store.js` tests against a fake Supabase.

The pages are checked in a real browser with Playwright and a fully mocked Supabase, kept outside this repo in
`JKB-Vault/projects/jkb-ops-tests/`: `me_test.mjs` (Me tab, import, Atlas context), `probe_ops.mjs` and
`stress_ops.mjs` (layout of the app), `probe_pages.mjs` (landing page and JKB Voice at seven widths, three looks,
dark and light), `atlas_delete_section.mjs`, and `shoot_*.mjs` for screenshots (synthetic data only). Run one suite
at a time; several Playwright runs in parallel time out on the Google Fonts requests.
