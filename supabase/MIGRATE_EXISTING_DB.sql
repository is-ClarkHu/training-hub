-- Run this in Supabase → SQL Editor if you ALREADY created the tables before these
-- schema changes. (A brand-new install just runs 20260624120000_init_schema.sql and
-- needs none of this.) All statements are idempotent — safe to run more than once.

-- Per-set note + sub-sets (superset/dropset) + exercise flags (warmup / per-side)
alter table public.sets       add column if not exists note text;
alter table public.sets       add column if not exists sub_sets jsonb not null default '[]'::jsonb;
alter table public.exercises  add column if not exists default_per_side boolean not null default false;
alter table public.exercises  add column if not exists is_warmup        boolean not null default false;
alter table public.exercises
  add column if not exists is_rehab         boolean not null default false,
  add column if not exists rehab_purpose_zh text not null default '',
  add column if not exists rehab_purpose_en text not null default '',
  add column if not exists rehab_cues_zh    text not null default '',
  add column if not exists rehab_cues_en    text not null default '',
  add column if not exists rehab_dosage     text not null default '';

-- body_part is now a user-editable category key — drop the fixed 7-value check.
alter table public.exercises  drop constraint if exists exercises_body_part_check;
alter table public.injuries   drop constraint if exists injuries_body_part_check;

-- An exercise can belong to multiple categories — body_part → body_parts text[].
alter table public.exercises  add column if not exists body_parts text[] not null default '{}';
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exercises' and column_name = 'body_part'
  ) then
    update public.exercises set body_parts = array[body_part]
      where body_part is not null and body_parts = '{}';
  end if;
end $$;
alter table public.exercises  drop column if exists body_part;

-- Sports redesign: per-sport custom fields (replaces fixed 4 tiers) + session attributes
alter table public.sports          add column if not exists fields      jsonb not null default '[]'::jsonb;
alter table public.sport_sessions  add column if not exists attributes  jsonb not null default '{}'::jsonb;

-- Drop the old tier constraints/columns so pushes with the new shape aren't rejected.
alter table public.sports          drop constraint if exists sports_tiers_check;
alter table public.sports          alter column tiers drop not null;
alter table public.sport_sessions  drop constraint if exists sport_sessions_tier_check;
alter table public.sport_sessions  alter column tier drop not null;
alter table public.sport_sessions  alter column estimated drop not null;

-- Private adult wellness tracker categories
alter table public.optional_trackers add column if not exists category text;
alter table public.optional_trackers drop constraint if exists optional_trackers_category_check;
alter table public.optional_trackers
  add constraint optional_trackers_category_check
  check (category is null or category in ('solo','partner_low','partner_active'));

-- Cycle rounds (§6B) — one pass through a cycle's day sequence (see the matching
-- migration 20260707120000_cycle_rounds.sql for the canonical definition).
create table if not exists public.cycle_rounds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_id         uuid not null,
  index            integer not null,
  started_on       date not null,
  ended_on         date,
  completed_labels jsonb not null default '[]'::jsonb,
  skipped          boolean not null default false,
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);
create index if not exists cycle_rounds_cycle_idx on public.cycle_rounds (cycle_id);
create index if not exists cycle_rounds_sync_idx  on public.cycle_rounds (user_id, updated_at);
alter table public.cycle_rounds enable row level security;
drop policy if exists cycle_rounds_owner on public.cycle_rounds;
create policy cycle_rounds_owner on public.cycle_rounds
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Cycle framework display mode: circle chips or body model. Day-to-region
-- bindings are stored in training_cycle.days jsonb.
alter table public.training_cycle
  add column if not exists display_mode text not null default 'circle'
  check (display_mode in ('body','circle'));

-- Duration format (mm:ss vs hh:mm); which cycle a logged day belongs to (multiple
-- splits per day); optional note on a private/intimacy tracker entry.
alter table public.exercises        add column if not exists duration_hm boolean not null default false;
alter table public.workout_entries  add column if not exists cycle_id uuid;
alter table public.optional_trackers add column if not exists note text;
