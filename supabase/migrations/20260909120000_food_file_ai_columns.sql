-- Backfill two columns that only ever existed on paper. `20260710170000_food_and_files`
-- created food_log/public_files, and two later commits added `ai_description` /
-- `summary` INSIDE that file's `create table if not exists` block — which is a no-op
-- once the tables exist, so the live database never got them. The app writes both
-- (src/db/records.ts, assistant file summaries), so every push carrying them failed.
alter table public.food_log     add column if not exists ai_description text; -- AI vision result (P6c)
alter table public.public_files add column if not exists summary        text; -- LLM summary (§5.4)
