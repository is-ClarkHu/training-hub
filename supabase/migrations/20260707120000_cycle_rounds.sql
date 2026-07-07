-- Cycle rounds (§6B): one pass through a training cycle's day sequence. Opened
-- when the first cycle-tagged workout of the pass is logged; closes when all day
-- labels are covered, or early via "skip". Mirrors the Dexie v4 table + the
-- frontend CycleRound type. Synced like every other owned table.
create table if not exists public.cycle_rounds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_id         uuid not null,   -- references training_cycle.id (soft-linked; no FK so sync order is free)
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
