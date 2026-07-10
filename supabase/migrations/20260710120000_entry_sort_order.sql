-- Performed-order of each entry within its day (set at log time = creation ms;
-- user-reorderable in History). Nullable; legacy rows fall back to updated_at.
alter table public.workout_entries
  add column if not exists sort_order bigint;
