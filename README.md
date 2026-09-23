# JKB Ops Checklist

Black-and-gold ops checklist for JKB Global — a mobile web app that Claude can read and update
through a CLI or an MCP connector. Everything shares one task file, so when Claude ticks off a
task, the app updates within a few seconds.

```
 Web app (index.html) ─┐
 jkb CLI  (cli.js)  ───┼──> shared.js applyOp() ──> data/state.json
 MCP      (mcp.js)  ───┘         (server.js serves the app + /api)
```

## Setup

```bash
git clone https://github.com/joeph-boss-621311/jkbchecklist
cd jkbchecklist
npm install
npm start            # open http://127.0.0.1:4545
```

The badge next to the logo shows **● SYNCED** when the app is talking to the server.
If you open `index.html` directly (or from GitHub Pages) it shows **LOCAL** and saves in the browser only.
The first time you open the synced app, any progress already saved in that browser moves over.

## Using it from Claude Code

Open Claude Code in this folder (`claude`). The `jkb-checklist` connector in `.mcp.json` loads
automatically — approve it once, then just talk:

- "What should I work on next?"
- "Mark the sitemap task done"
- "Add 'Film SafeGate walkthrough' to SafeGate content"
- "Give me my weekly CEO review"

`CLAUDE.md` tells Claude how to behave here.

Want the connector in every project, or in Claude Desktop? Add it with an absolute path:

```bash
claude mcp add --scope user jkb-checklist -- node /full/path/to/jkbchecklist/mcp.js
```

## CLI

```bash
npm link             # makes `jkb` available everywhere (or use: node cli.js ...)
jkb status
jkb list safe --open
jkb add safegate seo "Submit sitemap to Google"
jkb done e6ypnr
jkb help
```

## Adding more connectors

Add them at project scope so they're saved in `.mcp.json`. Put keys in environment variables
(e.g. a `.env` you load in your shell, which is gitignored) — never paste keys into `.mcp.json`.
Use single quotes around `${VAR}` in `claude mcp add` so the variable name is saved, not the key itself.

| Connector | How |
|---|---|
| **Gmail** | Already on your Claude.ai account. Log in to Claude Code with the same account (`/login`) and check `/mcp`. |
| **Obsidian** | Install the *Local REST API* community plugin, copy its API key, then:<br>`claude mcp add --scope project --transport http obsidian https://127.0.0.1:27124/mcp/ --header 'Authorization: Bearer ${OBSIDIAN_API_KEY}'`<br>Obsidian must be open. |
| **Outlook** (personal outlook.com) | Register a free app in the Azure portal for a client id, then use a Microsoft Graph MCP server such as [systmworks/outlook-mcp-proxy](https://github.com/systmworks/outlook-mcp-proxy) or [kacase/mcp-outlook](https://github.com/kacase/mcp-outlook). |
| **MT5** | Windows only (runs next to your MT5 terminal). Start read-only with [Cloudmeru/MetaTrader-5-MCP-Server](https://github.com/Cloudmeru/MetaTrader-5-MCP-Server); move to [ariadng/metatrader-mcp-server](https://github.com/ariadng/metatrader-mcp-server) once you want trading, ideally on a demo account first. |

## Development

```bash
npm test             # unit tests for shared.js
```

All state changes go through `applyOp()` in `shared.js`. Add new operations there so the
browser, server, CLI and MCP connector stay in sync.
