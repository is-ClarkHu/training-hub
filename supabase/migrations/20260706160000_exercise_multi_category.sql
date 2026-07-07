-- An exercise can belong to multiple categories (§6B). The single `body_part`
-- text column becomes a `body_parts` text[] array; the frontend now syncs the
-- array. Existing rows are backfilled as a one-element array, then the old
-- column is dropped. (Mirrors the Dexie v3 upgrade in frontend/src/db/db.ts.)
alter table public.exercises
  add column if not exists body_parts text[] not null default '{}';

update public.exercises
  set body_parts = array[body_part]
  where body_part is not null and body_parts = '{}';

alter table public.exercises drop column if exists body_part;
