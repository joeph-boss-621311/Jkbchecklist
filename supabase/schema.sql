-- JKB Ops — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- (This file mirrors what's actually live — re-running it is safe, everything is
-- "if not exists" / "or replace".)

-- One row per user holding the checklist state and the Atlas chat log as two
-- jsonb blobs, each with its own "savedAt" so the two can sync independently
-- (mirrors the two-document shape the app used on the claude.ai artifact).
create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb,
  state_saved_at bigint not null default 0,
  coach jsonb,
  coach_saved_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

-- Only the signed-in owner can ever see or touch their own row.
drop policy if exists "select own state" on app_state;
create policy "select own state" on app_state
  for select using (auth.uid() = user_id);
drop policy if exists "insert own state" on app_state;
create policy "insert own state" on app_state
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own state" on app_state;
create policy "update own state" on app_state
  for update using (auth.uid() = user_id);

-- Realtime, so a second device sees changes without polling.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table app_state;
  end if;
end $$;

-- Bumps updated_at automatically on every save.
create or replace function touch_app_state() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_state_touch on app_state;
create trigger app_state_touch
  before update on app_state
  for each row execute function touch_app_state();

-- One row per browser/device that's opted into push notifications for the
-- daily briefing. A user can have more than one (phone + desktop).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "select own subscriptions" on push_subscriptions;
create policy "select own subscriptions" on push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "insert own subscriptions" on push_subscriptions;
create policy "insert own subscriptions" on push_subscriptions
  for insert with check (auth.uid() = user_id);
drop policy if exists "delete own subscriptions" on push_subscriptions;
create policy "delete own subscriptions" on push_subscriptions
  for delete using (auth.uid() = user_id);
