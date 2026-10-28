-- Oath of Stur online world: characters the game server keeps (2026-10-28).
-- Players can't read or write this table at all: only the game server can, with
-- the project's secret key. That's what stops anyone editing their own character.
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run. Safe to run again.

create table if not exists public.saves_oath_online (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null check (pg_column_size(data) < 262144),
  updated_at timestamptz not null default now()
);
alter table public.saves_oath_online enable row level security;
-- No policies and no grants: signed-in players and visitors get nothing.
revoke all on table public.saves_oath_online from anon, authenticated;
grant all on table public.saves_oath_online to service_role;
