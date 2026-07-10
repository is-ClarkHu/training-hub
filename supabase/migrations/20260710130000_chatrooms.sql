-- AI multi-chatroom (PLAN-ai-chatrooms §3): a chatroom groups a topic's messages,
-- carries its own concise memory, and holds a per-category read-permission matrix
-- (`perms`). Enforcement happens at data-read time in the backend, not here.
-- Mirrors the Dexie v5 table + the frontend Chatroom type. Synced like every
-- other owned table.
create table if not exists public.chatrooms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  topic       text not null default '',
  sort_order  integer not null default 0,
  perms       jsonb not null default '{}'::jsonb,   -- {category: bool}; empty = nothing granted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create index if not exists chatrooms_sync_idx on public.chatrooms (user_id, updated_at);

alter table public.chatrooms enable row level security;
drop policy if exists chatrooms_owner on public.chatrooms;
create policy chatrooms_owner on public.chatrooms
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
