-- training-hub — initial schema (SPEC §4)
-- Source of truth for every table. Mirrored locally by Dexie (frontend/src/db).
--
-- Global rules (SPEC §4 intro, §3 auth model) applied to EVERY user-data table:
--   • user_id uuid  — owner, FK -> auth.users, defaults to auth.uid() on insert
--   • updated_at    — ISO8601 timestamp, client-controlled (last-write-wins sync)
--   • deleted       — soft-delete flag (never hard-delete; sync needs the tombstone)
--   • RLS policy    — user_id = auth.uid() for select/insert/update/delete
--
-- IDs are client-generated UUIDs (SPEC §3); the gen_random_uuid() default is only a
-- fallback. updated_at is NOT auto-bumped by a trigger on purpose: the client owns it
-- so cross-device last-write-wins stays deterministic during sync.
--
-- Phase-2 tables (chat_messages, insights) are created empty now so the sync schema is
-- stable and Phase 2 needs no migration (SPEC §4.7, §12).

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ───────────────────────────── 4.2 exercises (the library) ─────────────────────────────
create table public.exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name_zh       text not null,
  name_en       text not null default '',
  body_part     text not null
                  check (body_part in ('chest','back','shoulders','legs','arms','core','frisbee')), -- §4.1 (FIXED 7)
  measure_type  text not null
                  check (measure_type in ('weight_reps','reps_only','duration')),                   -- §6
  assisted      boolean not null default false,  -- lower weight = harder; UI flips narrative
  is_custom     boolean not null default false,
  name_locked   boolean not null default false,  -- user-edited translation; AI must not overwrite
  needs_translation boolean not null default false,
  default_per_side boolean not null default false, -- movement is inherently per-side
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);
-- name_zh unique within a user's library (ignores soft-deleted rows)
create unique index exercises_user_name_zh_uniq
  on public.exercises (user_id, name_zh) where (not deleted);

-- ─────────────── 4.3 workout_entries (one exercise performed once in a session) ───────────────
create table public.workout_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date             date not null,
  exercise_id      uuid not null references public.exercises (id),
  is_superset      boolean not null default false,
  superset_group   text,                          -- groups entries done as one superset (optional v1)
  note_raw         text not null default '',      -- preserved verbatim (SPEC §5.3, §14)
  note_tags        jsonb not null default '[]'::jsonb, -- canonical tag keys parsed from the note (§5.3)
  cycle_day_label  text,                           -- A/B/C/D… in the active cycle (§6B)
  injury_modified  text check (injury_modified in ('paused','reduced')), -- §4.11/§6A
  injury_id        uuid,                           -- optional link to injuries.id; FK added after injuries (§4.11)
  needs_review     boolean not null default false, -- ambiguous import/parse (§10)
  needs_translation boolean not null default false,
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);
create index workout_entries_exercise_idx on public.workout_entries (exercise_id);
create index workout_entries_date_idx     on public.workout_entries (user_id, date);

-- ─────────────────────── 4.4 sets (one row per set — heart of the schema) ───────────────────────
create table public.sets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id      uuid not null references public.workout_entries (id) on delete cascade,
  set_index     integer not null,                 -- 1-based order
  set_type      text not null default 'normal'
                  check (set_type in ('normal','warmup','superset','dropset')),
  weight        double precision,                 -- weight_reps
  reps          integer,                          -- weight_reps / reps_only
  duration_sec  integer,                          -- duration
  per_side      boolean not null default false,   -- reps are per-side (e.g. Bulgarian split squat)
  note          text,                             -- per-set note (e.g. to-failure); §5.3
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);
create index sets_entry_idx on public.sets (entry_id);

-- ─────────────────── 4.5a sports (user-creatable activity library) ───────────────────
-- Frisbee is the default sport seeded for a new account, but the user can add others
-- (basketball, climbing, …). Per-user and bilingual like the exercise library (§5).
-- Each sport defines EXACTLY 4 intensity tiers (fixed 4-level scale; labels customizable
-- per sport — generalized from frisbee's toss/casual/club/major).
create table public.sports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name_zh      text not null,
  name_en      text not null default '',
  is_default   boolean not null default false,  -- the user's primary sport (frisbee by default)
  name_locked  boolean not null default false,  -- translation lock (like exercises)
  needs_translation boolean not null default false,
  -- ordered 4 tiers: [{level,key,zh,en}]. level 1 play → 2 casual → 3 club → 4 major.
  tiers        jsonb not null default
                 '[{"level":1,"key":"play","zh":"玩玩","en":"Play"},
                   {"level":2,"key":"casual","zh":"休闲","en":"Casual"},
                   {"level":3,"key":"club","zh":"训练/俱乐部","en":"Club"},
                   {"level":4,"key":"major","zh":"大赛","en":"Major"}]'::jsonb
                 check (jsonb_array_length(tiers) = 4),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);
create unique index sports_user_name_zh_uniq
  on public.sports (user_id, name_zh) where (not deleted);

-- ─────────────── 4.5b sport_sessions (replaces the old frisbee-only table) ───────────────
create table public.sport_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  sport_id    uuid not null references public.sports (id),
  tier        integer not null check (tier between 1 and 4), -- label resolved from sports.tiers
  hours       double precision not null,
  injury      boolean not null default false,
  estimated   boolean not null default false,     -- duration estimated (e.g. multi-day tournament)
  note_raw    text not null default '',
  note_tags   jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create index sport_sessions_sport_idx on public.sport_sessions (sport_id);
create index sport_sessions_date_idx  on public.sport_sessions (user_id, date);

-- ───────────────────── 4.6 profile (one row per user; feeds Phase-2 AI memory) ─────────────────────
create table public.profile (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  bodyweight_kg  double precision,
  goal           text,                             -- e.g. lean-bulk target & rate
  injuries       jsonb not null default '[]'::jsonb,
  split          jsonb,
  notes          text,
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);

-- ───────────────────────────────── 4.8 injuries (§6A) ─────────────────────────────────
create table public.injuries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body_area    text not null,                      -- free text, e.g. "left hamstring"
  body_part    text check (body_part in ('chest','back','shoulders','legs','arms','core','frisbee')), -- optional link
  started_on   date not null,
  status       text not null check (status in ('acute','rehab','recovered')),
  resolved_on  date,
  severity     integer check (severity between 1 and 5),
  note_raw     text not null default '',
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);
-- deferred FK from workout_entries.injury_id (declared before injuries existed)
alter table public.workout_entries
  add constraint workout_entries_injury_fk foreign key (injury_id) references public.injuries (id);
create index workout_entries_injury_idx on public.workout_entries (injury_id);

-- ─────────────────────── 4.9 training_cycle (the loop / N-day split — §6B) ───────────────────────
create table public.training_cycle (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,                       -- e.g. "A/B/C/D"
  active      boolean not null default false,
  days        jsonb not null default '[]'::jsonb,  -- [{label,title,body_parts:[...]}, ...]
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
-- only one active cycle per user at a time
create unique index training_cycle_one_active
  on public.training_cycle (user_id) where (active and not deleted);

-- ─────────────────── 4.10 optional_trackers (generic daily point-log — §6C) ───────────────────
create table public.optional_trackers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tracker     text not null check (tracker in ('intimacy')), -- v1: one type
  date        date not null,
  count       integer not null default 1,          -- frequency point-log only
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

-- ───────────────── 4.8(b) translation_dictionary (powers §5; self-learning cache) ─────────────────
create table public.translation_dictionary (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  domain      text not null check (domain in ('exercise','body_part','note_tag','sport')),
  zh          text not null,                        -- source Chinese term/fragment
  en          text not null,                        -- English term
  source      text not null check (source in ('seed','ai','user')),
  verified    boolean not null default false,       -- user-confirmed; protects from AI overwrite
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create unique index translation_dictionary_uniq
  on public.translation_dictionary (user_id, domain, zh) where (not deleted);

-- ───────────────────────── 4.7 Phase-2 tables (created empty now) ─────────────────────────
create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table public.insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null,
  content       text not null,                      -- AI summary
  created_at    timestamptz not null default now(),
  superseded_by uuid references public.insights (id), -- null = current
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);

-- ───────────────────────── Sync pull index on every table (updated_at) ─────────────────────────
-- SyncEngine pulls rows where updated_at > lastSyncedAt, scoped to the user (SPEC §3).
create index exercises_sync_idx              on public.exercises (user_id, updated_at);
create index workout_entries_sync_idx        on public.workout_entries (user_id, updated_at);
create index sets_sync_idx                   on public.sets (user_id, updated_at);
create index sports_sync_idx                 on public.sports (user_id, updated_at);
create index sport_sessions_sync_idx         on public.sport_sessions (user_id, updated_at);
create index injuries_sync_idx               on public.injuries (user_id, updated_at);
create index training_cycle_sync_idx         on public.training_cycle (user_id, updated_at);
create index optional_trackers_sync_idx      on public.optional_trackers (user_id, updated_at);
create index translation_dictionary_sync_idx on public.translation_dictionary (user_id, updated_at);
create index chat_messages_sync_idx          on public.chat_messages (user_id, updated_at);
create index insights_sync_idx               on public.insights (user_id, updated_at);

-- ───────────────────────────────── Row Level Security ─────────────────────────────────
-- One FOR-ALL policy per table: a row is readable/writable only by its owner.
-- WITH CHECK also stops a client from inserting/moving a row to another user_id.
do $$
declare t text;
begin
  foreach t in array array[
    'exercises','workout_entries','sets','sports','sport_sessions','profile','injuries',
    'training_cycle','optional_trackers','translation_dictionary','chat_messages','insights'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end $$;
