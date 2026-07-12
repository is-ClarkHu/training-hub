-- Per-chatroom AI model (PLAN-ai-chatrooms). A room can pin its own provider/model
-- so different rooms can run different AIs at the same time. NULL = use the global
-- Settings → AI assistant default. History/memory/context are provider-agnostic, so
-- switching a room's model still reads all its prior data.
alter table public.chatrooms add column if not exists provider text;
alter table public.chatrooms add column if not exists model text;
