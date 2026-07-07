-- ─────────────────────── injuries v2 (§6A redesign) ───────────────────────
-- Treat an injury as an EVENT with a rich lifecycle, not a binary healed/not.
--   * status: 3-state → 7-state (new → observing → treating → rehab → returning
--     → recovered → relapsed). Middle stages are what the user manages.
--   * add laterality / injury_type / scenario, a bilingual note (note_zh/note_en),
--     stage-transition history (checkpoints) and text/link references (attachments).
-- Idempotent-ish: safe to run once on an existing project created by init_schema.

-- 1. widen the status check to the 7-state lifecycle (backfill legacy values first).
alter table public.injuries drop constraint if exists injuries_status_check;

update public.injuries set status = 'observing'      where status = 'acute';
update public.injuries set status = 'rehab_training' where status = 'rehab';
-- 'recovered' is unchanged.

alter table public.injuries
  add constraint injuries_status_check
  check (status in (
    'newly_occurred','observing','treating','rehab_training','returning','recovered','relapsed'
  ));

-- 2. new event columns.
alter table public.injuries
  add column if not exists laterality  text check (laterality in ('left','right','bilateral')),
  add column if not exists injury_type text check (injury_type in ('sprain','strain','contusion','overuse','fracture','other')),
  add column if not exists scenario    text check (scenario in ('running','strength','competition','daily','other')),
  add column if not exists note_zh     text not null default '',
  add column if not exists note_en     text not null default '',
  add column if not exists checkpoints jsonb not null default '[]'::jsonb,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 3. backfill bilingual note + an initial checkpoint from existing rows.
update public.injuries
  set note_zh = case when note_raw ~ '[一-鿿]' then note_raw else note_zh end,
      note_en = case when note_raw ~ '[一-鿿]' then note_en else note_raw end
  where note_raw <> '' and note_zh = '' and note_en = '';

update public.injuries
  set checkpoints = jsonb_build_array(jsonb_build_object('status', status, 'date', started_on))
  where checkpoints = '[]'::jsonb;
