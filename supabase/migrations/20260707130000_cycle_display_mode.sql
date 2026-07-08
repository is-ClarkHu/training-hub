-- Cycle display mode (§6B): each training-cycle framework chooses how its loop
-- progress is visualized. Day-to-body-region bindings live inside days jsonb.
alter table public.training_cycle
  add column if not exists display_mode text not null default 'circle'
  check (display_mode in ('body','circle'));
