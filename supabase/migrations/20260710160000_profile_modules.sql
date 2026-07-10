-- AI pre-fillable data modules (PLAN-ai-chatrooms P6 / §3.1). All fields optional;
-- each table is a per-chatroom permission category read by the assistant. RLS is
-- owner-only, written explicitly per table (statically visible).

-- basics: static-ish demographics & training background (one row per user)
create table if not exists public.basics (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  age            integer,
  sex            text,                 -- self-described
  biological_sex text,
  height_cm      double precision,
  training_years double precision,
  training_level text,                 -- e.g. beginner/intermediate/advanced
  work_type      text,                 -- sedentary/physical/shift/other
  sleep_hours    double precision,
  resting_hr     integer,              -- sensitive
  max_hr         integer,              -- sensitive
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);
create index if not exists basics_sync_idx on public.basics (user_id, updated_at);
alter table public.basics enable row level security;
drop policy if exists basics_owner on public.basics;
create policy basics_owner on public.basics
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- body_measurements: time series for trend (weight / body-fat / muscle / waist)
create table if not exists public.body_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date         date not null,
  weight_kg    double precision,
  body_fat_pct double precision,       -- sensitive
  muscle_kg    double precision,       -- sensitive
  waist_cm     double precision,       -- sensitive
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);
create index if not exists body_measurements_sync_idx on public.body_measurements (user_id, updated_at);
create index if not exists body_measurements_date_idx on public.body_measurements (user_id, date);
alter table public.body_measurements enable row level security;
drop policy if exists body_measurements_owner on public.body_measurements;
create policy body_measurements_owner on public.body_measurements
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notes: free-form background, optionally tagged (medical-tagged = sensitive)
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content     text not null,
  tag         text,                    -- training/injury/goal/habit/medical/equipment/other
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create index if not exists notes_sync_idx on public.notes (user_id, updated_at);
alter table public.notes enable row level security;
drop policy if exists notes_owner on public.notes;
create policy notes_owner on public.notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- supplements: what the user takes (still_using guards stale entries)
create table if not exists public.supplements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  brand       text,
  dose        text,
  timing      text,
  frequency   text,
  still_using boolean not null default true,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create index if not exists supplements_sync_idx on public.supplements (user_id, updated_at);
alter table public.supplements enable row level security;
drop policy if exists supplements_owner on public.supplements;
create policy supplements_owner on public.supplements
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- training_env: usual gym / equipment (one row per user)
create table if not exists public.training_env (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  gym            text,
  equipment      text,
  home_equipment text,
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);
create index if not exists training_env_sync_idx on public.training_env (user_id, updated_at);
alter table public.training_env enable row level security;
drop policy if exists training_env_owner on public.training_env;
create policy training_env_owner on public.training_env
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- medical_background: HIGH-SENSITIVITY (default off per room; AI uses it for
-- exercise safety). Free-text fields, one row per user.
create table if not exists public.medical_background (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  conditions     text,   -- cardiovascular / BP / diabetes / asthma / epilepsy / organ / osteoporosis / eating-disorder …
  surgeries      text,
  restrictions   text,   -- doctor-given exercise limits
  allergies      text,
  family_history text,
  recent_labs    text,   -- recent checkup / blood results
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);
create index if not exists medical_background_sync_idx on public.medical_background (user_id, updated_at);
alter table public.medical_background enable row level security;
drop policy if exists medical_background_owner on public.medical_background;
create policy medical_background_owner on public.medical_background
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
