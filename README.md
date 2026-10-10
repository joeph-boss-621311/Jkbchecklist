# JKB Ops

Your checklist, managed by Claude. It plans your day, updates tasks when you tell it what happened, times your focus, and calls you out when you're dodging the important stuff.

**App:** https://checklist.jkbglobal.site/app.html (sign in with your JKB Ops email and password)
**JKB Voice:** https://checklist.jkbglobal.site/voice.html (needs GitHub Pages on)

## Screens

- **Today**: Claude's note, focus ring, streak, focus time, overdue / due today / coming up, check-ins.
- **Atlas** (the coach): chat with it. It marks tasks done, adds tasks (with due dates, repeats, tags and steps), reorganizes the checklist on its own initiative — new projects, new sections, tags — to keep it matching what you're actually working toward, plans your day, and schedules check-ins. Every change has **Undo**. You can attach a photo (screenshot, handwritten note, whiteboard, receipt) and it reads it. Tap 🎙 to read one of its replies aloud with your device's own voice, or 🎧 to hear it in Atlas's ElevenLabs voice on JKB Voice.
- **Tasks**: search, filters (Today, This week, Overdue, High, Recurring, No date, Done), project filter, tag filter, and projects → sections. Every list puts open high-priority tasks first, then normal, then low, with done tasks at the bottom.
- **Progress**: tasks done per day (14 days), focus time per day, best/current streak, neglected projects, the tasks you've spent the most time on.
- **Task sheet**: priority, due date, repeat (daily / weekdays / weekly / monthly), tags, steps, "Break it down with Claude", and a 15/25/50-minute focus timer.

## Daily check-ins and reminders (Supabase, automatic)

- 8:00 AM WAT: morning plan from Atlas + phone notification
- 8:00 PM WAT: evening review + phone notification
- Every task with a time gets a push notification at that time; in hours with nothing timed (10 AM to
  midnight), one nudge about a relevant open task

## Live voice coach (ElevenLabs)

Live voice and ElevenLabs text-to-speech run on JKB Voice (`voice.html`), a separate page:

1. In the app, tap **🎧 Talk**. JKB Voice opens with a briefing of your tasks (passed in the link's `#` part, which never reaches a server).
2. Talk. When you're done, tap **Copy for Atlas & open app**, then paste into Atlas. It applies what you said.

### Hearing Atlas's replies

- **🎙 in the chat** — reads the message aloud instantly using your device's own voice. No setup, works everywhere, but sounds like your phone's voice, not an ElevenLabs one.
- **🎧 in the chat** — opens JKB Voice with that message and plays it in a real ElevenLabs voice, if you've added a key there (Settings → Atlas's voice; a *separate* key from the live-call agent, saved on that device only). Defaults to ElevenLabs' "Adam" voice; paste a different Voice ID from [elevenlabs.io/app/voice-library](https://elevenlabs.io/app/voice-library) to change it.

### One-time ElevenLabs agent setup

In the ElevenLabs dashboard, create a new Agent (blank template) and set:

- **LLM:** a Claude model (Haiku is the cheapest and fastest; Sonnet is smarter)
- **First message:** `Hey Joseph. What did you get done, and what's next?`
- **System prompt:**

  > Your name is Atlas. You are Joseph's accountability coach on a live voice call. He's an ambitious founder on a tight budget running JKB Global (creative/tech agency), SafeGate (escrow platform), CVG and a weekly CEO routine. At the start of the call you'll get his current checklist as context — use it. Talk like a smart friend: casual, direct, short turns of one to three sentences, never read out long lists. Find out what he finished, what's blocking him, and what he'll do next, with times or dates. Push back when he dodges high-priority or overdue work, and help him decide when he's stuck. Before the call ends, recap in two sentences what he finished and what he committed to — that recap is sent to his task app.

- **Security:** leave authentication off, so the page can start calls with only the Agent ID. Anyone with the ID can use your minutes, so don't post it publicly, and set a usage limit if ElevenLabs offers one.

Then open JKB Voice, tap **Settings** and paste the Agent ID (`agent_…`). It's stored on that device only.

## Claude Code (CLI + MCP connector)

Claude Code can read and edit your real tasks, the same data as the app, signed in as you. Every save
checks that nothing changed since it read your list; if you just changed something on your phone, it
re-reads and applies its change on top, so it never overwrites you. Open apps update within seconds.

### Setup

```bash
git clone https://github.com/joeph-boss-621311/Jkbchecklist.git
cd Jkbchecklist
npm install
node cli.js login     # your JKB Ops email and password (stays on this machine, in .jkb/)
claude                # approve "jkb-checklist" when asked
```

No computer handy? Ask Claude to sign the tools in by email: it runs `node cli.js login --email <you>`,
Supabase emails you a one-time sign-in link, and you **long-press and copy it** (don't tap it, tapping uses it
up) and paste it to Claude, which finishes with `node cli.js login --link '<link>'`.

Then ask things like:

- "What's next?"
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
jkb login | whoami | logout
jkb status               # focus, overdue, due soon, progress
jkb list safe --open
jkb find sitemap
jkb add safegate seo "Submit sitemap to Google" --priority high --due tomorrow --time 15:00
jkb done t2f
jkb edit t2f --due none --focus
```

Projects and sections work by id, name or prefix (`safe` = SafeGate).

MCP tools: `get_login_info`, `get_status`, `list_tasks`, `search_tasks`, `add_task`, `set_task_done`,
`edit_task`, `delete_task`, `add_project`, `add_section`.

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
npm test     # lib/tasks.js unit tests, an end-to-end MCP test, and lib/store.js against a fake Supabase
```

All checklist rules live in `lib/tasks.js` and mirror `app.html`. Change both together.
