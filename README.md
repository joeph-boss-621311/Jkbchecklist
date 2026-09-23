# JKB Ops

Your checklist, managed by Claude. It plans your day, updates your tasks when you tell it what happened, and calls you out when you're dodging the important stuff.

**Live app:** https://claude.ai/artifact/1puenyhWtJ8GhNQZvAcqm8 (private to your Claude account)
**Voice capture:** https://joeph-boss-621311.github.io/Jkbchecklist/voice.html (needs GitHub Pages on)

## Screens

- **Today** — Claude's note for the day, your 3–5 focus tasks, streak, and what's overdue or due soon.
- **Coach** — chat with Claude. Say "finished the login bug, add call Tunde Friday" and it updates the list. Every batch of changes shows up in the chat with an **Undo** button.
- **Projects** — the full list: priorities, due dates, sections. Tap a task to edit it.

## How it works

- `index.html` is the whole app. On claude.ai it uses Claude on your account (`sample`) and saves to the artifact database (`app/state`, `app/coach`), so your list follows you across devices. Opened anywhere else it still works as a plain checklist saved in the browser.
- `voice.html` is a small page for real speech-to-text. claude.ai blocks the mic for pages it hosts, so this page does the listening, copies what you said and opens the app. There you paste it into Coach.
