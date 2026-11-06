-- Jude's Task Board: run this once in Supabase → SQL Editor → New query → Run

create table if not exists public.tasks (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  category    text not null default 'Personal',
  due         text,            -- YYYY-MM-DD
  time        text,            -- HH:MM
  priority    text not null default 'normal',
  repeat      text not null default 'none',
  notes       text default '',
  done        boolean not null default false,
  done_at     bigint,
  created_at  bigint,
  completions jsonb not null default '[]'::jsonb
);

create table if not exists public.lists (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  lists   jsonb not null default '[]'::jsonb
);

alter table public.tasks enable row level security;
alter table public.lists enable row level security;

-- Each signed-in person can only see and change their own rows
drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own lists" on public.lists;
create policy "own lists" on public.lists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates between your phone and computer
alter publication supabase_realtime add table public.tasks;
