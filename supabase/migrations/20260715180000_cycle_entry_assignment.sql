-- Explicit cycle-round assignment for workout entries.
-- A same-date training day can contain multiple split days (e.g. chest + leg rehab),
-- so entries need to point at the exact cycle round instead of relying only on
-- date ranges.
alter table public.workout_entries
  add column if not exists cycle_round_id uuid;

create index if not exists workout_entries_cycle_round_idx
  on public.workout_entries (cycle_round_id);
