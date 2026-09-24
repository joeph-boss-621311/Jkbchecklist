-- JKB Ops — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Single-row-per-user JSON store, mirroring the shape the app already uses
-- (state.projects / today / checkins / sessions / coach). Keeping it as one
-- jsonb blob means app.html's existing task logic barely has to change —
-- only how it's loaded and saved.

create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

-- Only the signed-in owner can ever see or touch their own row.
create policy "select own state" on app_state
  for select using (auth.uid() = user_id);
create policy "insert own state" on app_state
  for insert with check (auth.uid() = user_id);
create policy "update own state" on app_state
  for update using (auth.uid() = user_id);

-- Bumps updated_at automatically on every save.
create or replace function touch_app_state() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger app_state_touch
  before update on app_state
  for each row execute function touch_app_state();
