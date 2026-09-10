# supabase/migrations — schema source of truth

SQL migrations define every table in the app. Apply them **in filename order**
(`YYYYMMDDHHMMSS_name.sql`) — Supabase dashboard → SQL editor, or `supabase db push`.
Filenames of already-applied migrations must never change, and neither must their
bodies: adding a column inside an applied file's `create table if not exists` is a
silent no-op against the live database. New column → new migration file.

> Not to be confused with `../../migration/` (root) + `frontend/src/migration/*` —
> that is the one-time **legacy CSV → app** data importer (historical workout data),
> unrelated to these schema files.

**Mandatory on every user-data table** (auth model §3):
- `user_id uuid` (FK → `auth.users`), set on insert from the session.
- `updated_at` (ISO8601) and `deleted` (soft-delete flag) for the SyncEngine.
- RLS policy `user_id = auth.uid()` for all of select / insert / update / delete.

Auth: email+password ON, public sign-ups CLOSED in v1 (single account). Opening to
more users later needs no schema change — RLS already isolates data.

## Migrations

### Core schema & training modules
| File | Adds |
|---|---|
| `20260624120000_init_schema` | Base §4 schema (exercises, workout_entries, sets, sports, sport_sessions, profile, injuries, training_cycle, optional_trackers, translation_dictionary) + empty `chat_messages`/`insights` (used later by the assistant). RLS via a per-table owner-policy loop. |
| `20260706120000_injury_v2` | Injuries as events (7-stage status, bilingual area/note, laterality/type/scenario, checkpoints, attachments). |
| `20260706130000_rehab_library` | Rehab-exercise fields on `exercises`. |
| `20260706140000_rehab_loop` | Per-injury rehab plan + symptom assessments. |
| `20260706150000_injury_photos_storage` | Private `injury-photos` Storage bucket + per-user folder RLS. |
| `20260706160000_exercise_multi_category` | `body_part` → `body_parts text[]` (multi-category). |
| `20260707120000_cycle_rounds` | Training-cycle rounds (one pass through the day sequence). |
| `20260707130000_cycle_display_mode` | Cycle display mode (body/circle). |
| `20260709120000_entry_module_part` | Per-occurrence module/part override on entries. |
| `20260709130000_set_cardio_metrics` | Cardio metrics on sets. |
| `20260709140000_sport_metrics` | Sport metrics. |
| `20260710120000_entry_sort_order` | Entry sort order. |

### AI multi-chatroom, permissions & memory (see `docs/PLAN-ai-chatrooms.md`)
| File | Adds |
|---|---|
| `20260710130000_chatrooms` | `chatrooms` (name/topic/sort_order/**perms** matrix). |
| `20260710140000_chat_messages_chatroom` | `chat_messages.chatroom_id` + backfill existing messages into a default room. |
| `20260710150000_chatroom_memory` | `chatroom_summaries` (rolling, `covered_through` watermark), `chatroom_memories` (shareable/pinned), `chatroom_memory_access` (cross-room read grants). |
| `20260710160000_profile_modules` | Pre-fillable data modules: `basics`, `body_measurements`, `notes`, `supplements`, `training_env`, `medical_background` (high-sensitivity). |
| `20260710170000_food_and_files` | `food_log` (+`ai_description`), `public_files` (`content`+`summary`), `chatroom_file_access`; private `food-photos` & `public-files` Storage buckets + folder RLS. |
| `20260711120000_chatroom_ai` | Per-room AI provider/model override (`chatrooms.provider`/`model`; NULL = global Settings default). |

### Cycle ↔ entry assignment
| File | Adds |
|---|---|
| `20260715180000_cycle_entry_assignment` | Assign a workout entry to a specific cycle round. |
| `20260718120000_entry_cycle_assignments` | Many-to-many entry↔cycle assignments (supersedes the single-column link). |
| `20260909120000_food_file_ai_columns` | Adds `food_log.ai_description` + `public_files.summary` — declared in `20260710170000` but never applied, because they were added inside an already-run `create table if not exists`. |

## Storage buckets
`injury-photos`, `food-photos`, `public-files` — all private, one folder per user
(`<uid>/…`), RLS on `storage.objects` scoping every op to the owner's folder.
