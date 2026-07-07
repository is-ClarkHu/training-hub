-- ─────────────────────── rehab library (§6A Phase 2) ───────────────────────
-- Rehab exercises reuse the exercises table (is_rehab=true) — orthogonal to
-- body_part — and carry knowledge: purpose, cues/precautions (both bilingual)
-- and a dosage string. Existing rows default to is_rehab=false (strength moves).
alter table public.exercises
  add column if not exists is_rehab        boolean not null default false,
  add column if not exists rehab_purpose_zh text not null default '',
  add column if not exists rehab_purpose_en text not null default '',
  add column if not exists rehab_cues_zh    text not null default '',
  add column if not exists rehab_cues_en    text not null default '',
  add column if not exists rehab_dosage     text not null default '';
