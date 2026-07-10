-- Optional sport-session metrics (e.g. from a watch): active calories + heart rate.
-- Both nullable — never required.
alter table public.sport_sessions
  add column if not exists calories numeric,
  add column if not exists bpm      numeric;
