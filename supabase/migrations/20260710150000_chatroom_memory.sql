-- AI chatroom memory lifecycle (PLAN-ai-chatrooms P4). Three owned, synced tables:
--   chatroom_summaries     — one rolling summary per room (older turns compressed)
--   chatroom_memories      — concise memory units; `shareable` ones can be read by
--                            other rooms (source relationship, never copied)
--   chatroom_memory_access — grants: reader_room may read source_room's shareable
--                            memories. Permissions never inherit (req §6.4): this
--                            only exposes flagged memories, never the source's raw
--                            data or its full chat.
-- All soft-link chatrooms.id (no FK, so sync push order stays free).

create table if not exists public.chatroom_summaries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chatroom_id    uuid not null,
  content        text not null default '',
  covered_through timestamptz,   -- created_at of the newest message already folded in
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);
-- one live summary per room
create unique index if not exists chatroom_summaries_one_per_room
  on public.chatroom_summaries (user_id, chatroom_id) where (not deleted);
create index if not exists chatroom_summaries_sync_idx on public.chatroom_summaries (user_id, updated_at);

create table if not exists public.chatroom_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chatroom_id uuid not null,          -- origin room
  content     text not null,
  shareable   boolean not null default false,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create index if not exists chatroom_memories_room_idx on public.chatroom_memories (user_id, chatroom_id);
create index if not exists chatroom_memories_sync_idx on public.chatroom_memories (user_id, updated_at);

create table if not exists public.chatroom_memory_access (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reader_room_id uuid not null,
  source_room_id uuid not null,
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);
create unique index if not exists chatroom_memory_access_uniq
  on public.chatroom_memory_access (user_id, reader_room_id, source_room_id) where (not deleted);
create index if not exists chatroom_memory_access_sync_idx on public.chatroom_memory_access (user_id, updated_at);

-- RLS: owner-only. Explicit per-table statements (not a dynamic loop) so the
-- policy is statically visible — same shape as every other table.
alter table public.chatroom_summaries enable row level security;
drop policy if exists chatroom_summaries_owner on public.chatroom_summaries;
create policy chatroom_summaries_owner on public.chatroom_summaries
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.chatroom_memories enable row level security;
drop policy if exists chatroom_memories_owner on public.chatroom_memories;
create policy chatroom_memories_owner on public.chatroom_memories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.chatroom_memory_access enable row level security;
drop policy if exists chatroom_memory_access_owner on public.chatroom_memory_access;
create policy chatroom_memory_access_owner on public.chatroom_memory_access
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
