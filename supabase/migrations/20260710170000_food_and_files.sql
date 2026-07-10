-- AI food log + public files (PLAN-ai-chatrooms P6c / P5). Owner-RLS, explicit.

-- food_log: photo + text description + time. The assistant reads the description
-- (§4.5); the image is only shown in the UI, not re-analyzed every turn.
create table if not exists public.food_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  description    text not null default '',   -- the user's own text
  ai_description text,                        -- AI vision recognition result (P6c)
  photo_path     text,                        -- storage path in the food-photos bucket
  eaten_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);
create index if not exists food_log_sync_idx on public.food_log (user_id, updated_at);
alter table public.food_log enable row level security;
drop policy if exists food_log_owner on public.food_log;
create policy food_log_owner on public.food_log
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- public_files: small user-uploaded reference files. `content` holds extracted text
-- (for text files) so the assistant can read a capped excerpt without the binary.
create table if not exists public.public_files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null,
  storage_path text,                -- original file in the public-files bucket
  content      text,                -- extracted text (text files); capped excerpt used in context
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);
create index if not exists public_files_sync_idx on public.public_files (user_id, updated_at);
alter table public.public_files enable row level security;
drop policy if exists public_files_owner on public.public_files;
create policy public_files_owner on public.public_files
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- chatroom_file_access: which files a room may read (per-file, per-room).
create table if not exists public.chatroom_file_access (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chatroom_id uuid not null,
  file_id     uuid not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create unique index if not exists chatroom_file_access_uniq
  on public.chatroom_file_access (user_id, chatroom_id, file_id) where (not deleted);
create index if not exists chatroom_file_access_sync_idx on public.chatroom_file_access (user_id, updated_at);
alter table public.chatroom_file_access enable row level security;
drop policy if exists chatroom_file_access_owner on public.chatroom_file_access;
create policy chatroom_file_access_owner on public.chatroom_file_access
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private storage buckets, one folder per user (path: <uid>/...), same shape as
-- injury-photos.
insert into storage.buckets (id, name, public) values
  ('food-photos', 'food-photos', false),
  ('public-files', 'public-files', false)
on conflict (id) do nothing;

do $$
declare b text;
begin
  foreach b in array array['food-photos','public-files'] loop
    execute format('drop policy if exists %I on storage.objects', b || ' - own read');
    execute format('drop policy if exists %I on storage.objects', b || ' - own insert');
    execute format('drop policy if exists %I on storage.objects', b || ' - own update');
    execute format('drop policy if exists %I on storage.objects', b || ' - own delete');
    execute format($f$create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$f$,
      b || ' - own read', b);
    execute format($f$create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$f$,
      b || ' - own insert', b);
    execute format($f$create policy %I on storage.objects for update to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$f$,
      b || ' - own update', b);
    execute format($f$create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$f$,
      b || ' - own delete', b);
  end loop;
end $$;
