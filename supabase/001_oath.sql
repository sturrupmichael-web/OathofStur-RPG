-- Oath of Stur: one private cloud save per account (2026-10-27).
-- Lives in the same Supabase project as Helpdesk Survivors, with the same Google
-- sign-in, and leaves every table of those games alone.
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run. Safe to run again.

-- One row per account. 256 KB at most; a well-played character is about 10 KB.
create table if not exists public.saves_oath (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null check (pg_column_size(data) < 262144),
  updated_at timestamptz not null default now()
);
alter table public.saves_oath enable row level security;
revoke all on table public.saves_oath from anon, authenticated;
grant select, delete on table public.saves_oath to authenticated;
grant insert (data), update (data) on table public.saves_oath to authenticated;
drop policy if exists "own save" on public.saves_oath;
create policy "own save" on public.saves_oath for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The server sets the time of every write: the game uses it to tell whether another
-- device saved in between.
create or replace function public.saves_oath_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists saves_oath_touch on public.saves_oath;
create trigger saves_oath_touch before insert or update on public.saves_oath
  for each row execute function public.saves_oath_touch();
