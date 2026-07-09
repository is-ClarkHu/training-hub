-- History mode-2 grouping: per-occurrence override of which category "module" a
-- logged entry files under (e.g. dips → 下胸 one day, 三头 another). Null falls
-- back to the exercise's primary category at render time. Nullable, no backfill.
alter table public.workout_entries
  add column if not exists module_part text;
