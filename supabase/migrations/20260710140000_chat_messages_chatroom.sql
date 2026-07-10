-- AI multi-chatroom (PLAN-ai-chatrooms §3, P1 step 2): scope chat messages to a
-- room. `chatroom_id` soft-links chatrooms.id (no FK, so sync push order is free).
-- Kept NULLABLE for now: the current /api/assistant still inserts room-less rows;
-- step 3 makes the backend always set it. Existing rows are backfilled into a
-- per-user default "General" room so no history is orphaned.
alter table public.chat_messages add column if not exists chatroom_id uuid;

-- Backfill: every user that already has messages gets a default room, and all
-- their room-less messages move into it. Runs as table owner (bypasses RLS).
do $$
declare u uuid; rid uuid;
begin
  for u in select distinct user_id from public.chat_messages where chatroom_id is null loop
    insert into public.chatrooms (user_id, name, topic, sort_order)
      values (u, 'General', 'Open chat', 0)
      returning id into rid;
    update public.chat_messages
      set chatroom_id = rid, updated_at = now()
      where user_id = u and chatroom_id is null;
  end loop;
end $$;

create index if not exists chat_messages_room_idx on public.chat_messages (user_id, chatroom_id);
