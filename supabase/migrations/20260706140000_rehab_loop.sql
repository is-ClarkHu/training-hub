-- ─────────────────────── rehab loop (§6A Phase 3) ───────────────────────
-- Closes the injury loop: each injury carries a rehab PLAN (assigned rehab-library
-- exercise ids) and a series of symptom ASSESSMENTS (pain 0–10 + note).
alter table public.injuries
  add column if not exists rehab_plan_exercise_ids jsonb not null default '[]'::jsonb,
  add column if not exists assessments             jsonb not null default '[]'::jsonb;
