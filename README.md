# JKB Ops

Your checklist, managed by Claude. It plans your day, updates tasks when you tell it what happened, times your focus, and calls you out when you're dodging the important stuff.

**App:** https://claude.ai/artifact/1puenyhWtJ8GhNQZvAcqm8 (private to your Claude account)
**JKB Voice:** https://joeph-boss-621311.github.io/Jkbchecklist/voice.html (needs GitHub Pages on)

## Screens

- **Today**: Claude's note, focus ring, streak, focus time, overdue / due today / coming up, check-ins.
- **Coach**: chat with Claude. It marks tasks done, adds tasks (with due dates, repeats and steps), plans your day, and schedules check-ins. Every change has **Undo**.
- **Tasks**: search, filters (Today, This week, Overdue, High, Recurring, No date, Done), project filter, and projects → sections.
- **Progress**: tasks done per day (14 days), focus time per day, best/current streak, neglected projects, the tasks you've spent the most time on.
- **Task sheet**: priority, due date, repeat (daily / weekdays / weekly / monthly), steps, "Break it down with Claude", and a 15/25/50-minute focus timer.

## Daily check-ins (Claude routines)

- 8:00 AM WAT: morning plan + phone notification
- 8:00 PM WAT: evening review + phone notification
- Every 2 hours from 9 AM to 7 PM: silently books any extra check-ins you asked for in Coach

## Live voice coach (ElevenLabs)

claude.ai blocks the mic for pages it hosts, so live voice runs on JKB Voice:

1. In the app, tap **🎧 Talk**. JKB Voice opens with a briefing of your tasks (passed in the link's `#` part, which never reaches a server).
2. Talk. When you're done, tap **Copy for Coach & open app**, then paste into Coach. Claude applies what you said.

### One-time ElevenLabs agent setup

In the ElevenLabs dashboard, create a new Agent (blank template) and set:

- **LLM:** a Claude model (Haiku is the cheapest and fastest; Sonnet is smarter)
- **First message:** `Hey Joseph. What did you get done, and what's next?`
- **System prompt:**

  > You are Joseph's accountability coach on a live voice call. He's an ambitious founder on a tight budget running JKB Global (creative/tech agency), SafeGate (escrow platform), CVG and a weekly CEO routine. At the start of the call you'll get his current checklist as context — use it. Talk like a smart friend: casual, direct, short turns of one to three sentences, never read out long lists. Find out what he finished, what's blocking him, and what he'll do next, with times or dates. Push back when he dodges high-priority or overdue work, and help him decide when he's stuck. Before the call ends, recap in two sentences what he finished and what he committed to — that recap is sent to his task app.

- **Security:** leave authentication off, so the page can start calls with only the Agent ID. Anyone with the ID can use your minutes, so don't post it publicly, and set a usage limit if ElevenLabs offers one.

Then open JKB Voice, tap **Settings** and paste the Agent ID (`agent_…`). It's stored on that device only.

## Claude Code on your laptop (CLI + MCP connector)

Claude Code on your computer can manage the same tasks as the live app: same data, same rules.

```
 claude.ai cloud save (app/state) <── ArtifactData pull / push (Claude Code, signed in as you) ──> .jkb/app/state.json
        ▲                                                                                              ▲
  app · Coach · check-ins                                                  jkb CLI (cli.js) · MCP connector (mcp.js)
```

Only Claude Code's built-in ArtifactData tool can reach the cloud save, so Claude pulls the
checklist into `.jkb/`, the `jkb-checklist` tools edit it, and Claude pushes it back. The push is
pinned to the version it pulled, so it never overwrites something you changed on your phone in
the meantime. `CLAUDE.md` tells Claude this whole loop, so you just talk.

### Setup

```bash
git clone https://github.com/joeph-boss-621311/Jkbchecklist.git
cd Jkbchecklist
npm install
claude            # sign in with the same claude.ai account as the app; approve "jkb-checklist" when asked
```

Then ask things like:

- "Pull my checklist and tell me what's next"
- "Mark SafeGate test every page done"
- "Add 'Call Tunde about the invoice' to JKB, high priority, due Friday"
- "Give me my weekly review"

Want the connector in every folder, or in Claude Desktop? Use an absolute path:

```bash
claude mcp add --scope user jkb-checklist -- node /full/path/to/Jkbchecklist/mcp.js
```

### CLI

```bash
npm link                 # makes `jkb` available everywhere (or use: node cli.js ...)
jkb status               # focus, overdue, due soon, progress
jkb list safe --open
jkb find sitemap
jkb add safegate seo "Submit sitemap to Google" --priority high --due tomorrow
jkb done t2f
jkb edit t2f --due none --focus
jkb sync                 # how old the synced copy is, what's unpushed, the exact pull/push calls
```

The CLI edits `.jkb/app/state.json`. Nothing reaches the app until Claude pushes, and `jkb sync`
tells you what's waiting. Projects and sections work by id, name or prefix (`safe` = SafeGate).

MCP tools: `get_sync_info`, `get_status`, `list_tasks`, `search_tasks`, `add_task`,
`set_task_done`, `edit_task`, `delete_task`, `add_project`, `add_section`, `mark_pushed`.

## Adding more connectors

Add them at project scope so they're saved in `.mcp.json`. Put keys in environment variables
(e.g. a `.env` you load in your shell, which is gitignored). Never paste keys into `.mcp.json` or a chat.
Use single quotes around `${VAR}` in `claude mcp add` so the variable name is saved, not the key itself.

| Connector | How |
|---|---|
| **Gmail** | Already on your Claude.ai account. Log in to Claude Code with the same account (`/login`) and check `/mcp`. |
| **Obsidian** | Install the *Local REST API* community plugin, copy its API key, then:<br>`claude mcp add --scope project --transport http obsidian https://127.0.0.1:27124/mcp/ --header 'Authorization: Bearer ${OBSIDIAN_API_KEY}'`<br>Obsidian must be open. |
| **Outlook** (personal outlook.com) | Register a free app in the Azure portal for a client id, then use a Microsoft Graph MCP server such as [systmworks/outlook-mcp-proxy](https://github.com/systmworks/outlook-mcp-proxy) or [kacase/mcp-outlook](https://github.com/kacase/mcp-outlook). |
| **MT5** | Windows only (runs next to your MT5 terminal). Start read-only with [Cloudmeru/MetaTrader-5-MCP-Server](https://github.com/Cloudmeru/MetaTrader-5-MCP-Server); move to [ariadng/metatrader-mcp-server](https://github.com/ariadng/metatrader-mcp-server) once you want trading, ideally on a demo account first. |

## Development

```bash
npm test     # lib/tasks.js unit tests + an end-to-end MCP test
```

All checklist rules live in `lib/tasks.js` and mirror `app.html`. Change both together.
