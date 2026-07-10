-- Optional cardio metrics per set (treadmill / stair climber / …): distance (km),
-- active calories (kcal), average heart rate (bpm). All nullable — never required.
alter table public.sets
  add column if not exists distance numeric,
  add column if not exists calories numeric,
  add column if not exists bpm      numeric;
