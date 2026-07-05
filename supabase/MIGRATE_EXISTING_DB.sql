-- Run this in Supabase → SQL Editor if you ALREADY created the tables before these
-- schema changes. (A brand-new install just runs 20260624120000_init_schema.sql and
-- needs none of this.) All statements are idempotent — safe to run more than once.

-- Per-set note + exercise flags (warmup / per-side defaults)
alter table public.sets       add column if not exists note text;
alter table public.exercises  add column if not exists default_per_side boolean not null default false;
alter table public.exercises  add column if not exists is_warmup        boolean not null default false;

-- Sports redesign: per-sport custom fields (replaces fixed 4 tiers) + session attributes
alter table public.sports          add column if not exists fields      jsonb not null default '[]'::jsonb;
alter table public.sport_sessions  add column if not exists attributes  jsonb not null default '{}'::jsonb;

-- Drop the old tier constraints/columns so pushes with the new shape aren't rejected.
alter table public.sports          drop constraint if exists sports_tiers_check;
alter table public.sports          alter column tiers drop not null;
alter table public.sport_sessions  drop constraint if exists sport_sessions_tier_check;
alter table public.sport_sessions  alter column tier drop not null;
alter table public.sport_sessions  alter column estimated drop not null;
