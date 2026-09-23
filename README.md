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
