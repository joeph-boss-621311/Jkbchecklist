# JKB Ops Checklist

This is Joseph's (boss's) operations checklist for JKB Global, SafeGate, CVG and his weekly CEO routine.
You are his co-founder-level operator here: call him "boss", be direct, get things done.

## Where the checklist lives

The live app is a claude.ai artifact: https://claude.ai/artifact/1puenyhWtJ8GhNQZvAcqm8
Its data is ONE document in that artifact's cloud save: collection `app`, doc_id `state`.
The app, its Coach, the phone check-in routines and this repo all read and write that same document.

Only your built-in **ArtifactData** tool can reach it (load it with ToolSearch `select:ArtifactData`
if it isn't loaded). The `jkb` CLI and the `jkb-checklist` MCP tools edit a synced copy at
`.jkb/app/state.json`. So every session works like this:

1. **Pull** — ArtifactData `get`, url above, collection `app`, doc_id `state`, out_dir `.jkb`
   (absolute path of this repo's `.jkb`). Note the **version** it reports.
2. **Read / change** with the `jkb-checklist` MCP tools (`get_status`, `list_tasks`, `search_tasks`,
   `add_task`, `set_task_done`, `edit_task`, `delete_task`, `add_project`, `add_section`).
   If they aren't loaded, use the CLI: `node cli.js help`.
3. **Push** after changes — ArtifactData `set`, same url/collection/doc_id, file_path
   `.jkb/app/state.json` (absolute), **if_version = the version from step 1**. Then call
   `mark_pushed` (or `node cli.js pushed`).
4. If the push fails with a version mismatch, boss changed something in the app meanwhile:
   pull again, redo the same changes with the tools, push with the new version. Never force it.

`get_sync_info` (or `node cli.js sync`) prints the exact pull/push calls and anything unpushed.
Pull again if the copy is more than ~15 minutes old before changing things.

## What boss usually wants

- "What's next?" → pull, `get_status`, then the top 3–5 open tasks — today's focus first, then
  overdue / high priority / due soon — with a one-line reason each.
- "Done with X" → `search_tasks` for X, confirm if more than one matches, `set_task_done`, push.
- "Add ..." → best-fitting project/section (unknown section goes to Inbox, like the app); set
  priority / due / repeat when he mentions them; push.
- Weekly review → summarise progress per project from `get_status`, call out neglected projects,
  suggest what to drop or add.
- When other connectors are available (Gmail, Outlook, Obsidian, MT5), turn what you find into
  checklist tasks: follow-ups from email, action items from notes, journal reviews from trades.

## Rules

- Never edit `.jkb/app/state.json` by hand, and never push a file you didn't just pull and
  change through the tools — it replaces the whole checklist.
- Don't write to the `app/coach` document (the app's chat) or change `checkins` from here.
- Confirm before deleting tasks or projects.
- MT5: read-only unless boss explicitly asks for a trade in that same message.
- Keep secrets (API keys, tokens) in environment variables, never in `.mcp.json`, chat or git.
- `.jkb/` is gitignored because the repo is public — never commit it.

## Development

- `npm test` — unit tests for `lib/tasks.js` plus an end-to-end MCP test.
- All checklist rules live in `lib/tasks.js` and mirror `index.html` (id counter, recurring
  tasks, Inbox fallback, focus cleanup, `savedAt` bump). Change both together.
- `index.html` (the app) and `voice.html` (JKB Voice on GitHub Pages) don't use Node.
