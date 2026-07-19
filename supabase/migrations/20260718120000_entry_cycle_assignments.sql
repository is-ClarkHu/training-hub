-- Many-to-many cycle membership (§6B). A workout entry can belong to several
-- (cycle, round, day) targets at once — e.g. one bench press counting toward both
-- a 4-split's chest day and a push/pull split's push day. This table is the source
-- of truth for cycle membership going forward; the single cycle_id / cycle_round_id
-- / cycle_day_label columns on workout_entries are KEPT (untouched) for backfill and
-- fallback. Purely additive — no existing column or row is altered or dropped.
create table if not exists public.entry_cycle_assignments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id         uuid not null,   -- references workout_entries.id (soft-linked; no FK so sync order is free)
  cycle_id         uuid not null,   -- references training_cycle.id
  cycle_round_id   uuid,            -- references cycle_rounds.id (null = unrounded)
  cycle_day_label  text not null,
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);

create index if not exists eca_entry_idx on public.entry_cycle_assignments (entry_id);
create index if not exists eca_cycle_idx on public.entry_cycle_assignments (cycle_id);
create index if not exists eca_round_idx on public.entry_cycle_assignments (cycle_round_id);
create index if not exists eca_sync_idx  on public.entry_cycle_assignments (user_id, updated_at);

alter table public.entry_cycle_assignments enable row level security;
drop policy if exists eca_owner on public.entry_cycle_assignments;
create policy eca_owner on public.entry_cycle_assignments
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Ensure the legacy assignment columns exist on workout_entries before the backfill
-- reads them. cycle_round_id was added by an earlier migration that may not have been
-- applied on this database; add it (and the others, no-op if present) defensively so
-- this migration is self-contained and order-independent. Additive only.
alter table public.workout_entries add column if not exists cycle_id        uuid;
alter table public.workout_entries add column if not exists cycle_round_id  uuid;
alter table public.workout_entries add column if not exists cycle_day_label text;

-- One-time backfill: one "primary" assignment per already-assigned entry. The row
-- REUSES the entry's id, exactly like the client-side (Dexie v10) backfill, so the
-- two produce identical rows and sync upserts them without duplicates. Idempotent
-- via the primary-key conflict guard — safe to run more than once, and it never
-- touches workout_entries.
insert into public.entry_cycle_assignments
  (id, user_id, entry_id, cycle_id, cycle_round_id, cycle_day_label, updated_at, deleted)
select
  e.id, e.user_id, e.id, e.cycle_id, e.cycle_round_id, e.cycle_day_label, now(), false
from public.workout_entries e
where e.deleted = false
  and e.cycle_id is not null
  and e.cycle_day_label is not null
on conflict (id) do nothing;
