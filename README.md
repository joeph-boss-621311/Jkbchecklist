# JKB Checklist

Your ops checklist, now with voice. Tap 🎙, talk, and it turns your rambling into clean tasks filed under the right project.

## Run it

```bash
npm start            # → http://localhost:3000
```

No installs needed, just Node. Open it in **Chrome, Edge or Safari**, since those have built-in speech-to-text.

## How the filtering works

1. **Speech → text**: the browser's free built-in speech recognition. It works on `localhost` or https.
2. **Text → tasks**:
   - **With Claude (default when `server.js` is running):** the server runs `claude -p` (the Claude Code CLI) on your transcript. It drops filler, writes each task as a short action, and picks the project + section. It runs on your Claude login, so no API key needed. You need to have run `claude` once to sign in.
   - **Without Claude** (opening `index.html` directly, or the CLI isn't installed): a built-in filter keeps phrases like "I need to…", "remember to…" or anything starting with an action verb, and throws out the chatter.
3. You review the list, fix anything, and hit **Add**. Anything that doesn't fit a section goes to an **Inbox** section.

## Options

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to serve on |
| `HOST` | `127.0.0.1` | Set `0.0.0.0` to open it from your phone on the same Wi-Fi (the mic needs https there; use your keyboard's dictation button instead) |
| `CLAUDE_MODEL` | `haiku` | `sonnet` sorts smarter but uses more of your limits |
| `CLAUDE_BIN` | `claude` | Path to the CLI if it isn't on your PATH |
