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
