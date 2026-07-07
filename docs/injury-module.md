# Injury & Rehab module

The injury module treats **each injury as an independent event** and follows it
through its whole lifecycle — onset → assessment → rehab → gradual return →
recovery — instead of a binary "healed / not healed". It spans four tabs
(**Injuries**, **Log**, **Cycle**, **Dashboard**) and is fully bilingual: every
free-text field is stored in both Chinese and English so switching the UI
language never shows the wrong language.

Built module-by-module in four phases; all shipped. See `SETUP.md` §1 for the
migrations that must be applied (in order) before use.

---

## 1. Injury profile (Injuries tab)

Register and manage an injury as an event. Fields:

- **Body area** — free text, stored bilingually (中文 / English) with a
  one-tap AI **Translate** that fills the other language.
- **Body part** — optional category link (knee, shoulder, …).
- **Side** — left / right / bilateral.
- **Type** — sprain / strain / contusion / overuse / fracture / other.
- **Scenario** — running / strength / competition / daily / other.
- **Onset date**, **severity** (1–5).
- **Status** — a 7-stage lifecycle (below).
- **Note** — bilingual, AI-translatable.
- **References** — text/URL links (e.g. report names).
- **Photos** — see §5.

### Status lifecycle (7 stages)

```
新发生 → 观察中 → 治疗中 → 康复训练中 → 逐步复训 → 已康复
newly_occurred → observing → treating → rehab_training → returning → recovered
                                                              ↘ 复发 / relapsed
```

`relapsed` re-opens a recovered injury. Every status change **auto-records a
checkpoint** (the stage + the date it was entered), so each injury keeps its own
transition history, drawn as a timeline on the card. An **active-injury banner**
surfaces any non-recovered injury; recovered injuries stay in the list as
history (sorted last).

Legacy rows using the old 3-state `acute / rehab / recovered` are migrated
forward automatically (`acute→observing`, `rehab→rehab_training`).

## 2. Rehab exercise library (inside the Injuries tab)

A collapsible **Rehab library** section. Rehab moves reuse the `exercises` table
with an `is_rehab` flag (orthogonal to body part — a rehab move still belongs to
an anatomical part), plus knowledge fields:

- **Purpose** (bilingual) — what it trains / helps.
- **Cues / precautions** (bilingual).
- **Dosage** — e.g. `3×15, daily`.

Name, purpose, and cues each have an AI Translate button. Rehab moves are kept
out of the strength library, the Log body-part groups, and cycle-day planning so
the two libraries never mix.

## 3. Log linkage (Log tab)

- **One-step injury creation:** the injury-impact area has a **+ New injury**
  button that opens the injury dialog inline; on save it auto-links to the item
  being logged. No need to switch to the Injuries tab.
- **Strength lifts** can be marked `reduced` / `paused` and linked to an active
  injury (`injury_modified` + `injury_id`).
- **Rehab moves** appear as their own **Rehab** group in the activity picker.
  Selecting one shows a read-only knowledge card (purpose / cues / dosage) and a
  **"for which injury"** dropdown that links the log entry straight to the
  injury (`injury_id`), which feeds the loop's "training response" count.
- Sport sessions with an active injury are auto-flagged as injured.

## 4. Rehab loop (top of the Cycle tab)

Closes the loop for each **active** injury as a card:

- **Stage strip** with the current stage highlighted + a **→ next stage** button
  (advancing records a checkpoint).
- **Rehab plan** — assign rehab-library moves to this injury (edit = inline
  multi-select). Stored on the injury (`rehab_plan_exercise_ids`).
- **Symptoms** — a pain **0–10** check-in with an optional note; shows the latest
  reading, a ↑/↓ trend, and the recent history. Stored on the injury
  (`assessments`).
- **Training response** — count of rehab moves logged against this injury in the
  last 14 days + the last logged date. (Actual logging happens in the Log tab.)

Recovered injuries drop out of the loop (archived to the Injuries history).

## 5. Photos (attachments)

- Captured photos are **compressed client-side** (≤1600px, JPEG) — medical
  imaging is intentionally unsupported (too large).
- Stored in a **private Supabase Storage bucket** (`injury-photos`), one folder
  per user (`<uid>/<injury>/<photo>.jpg`), RLS-isolated so only you can read
  them. A **local IndexedDB copy** is kept as an offline cache; display prefers
  the cache and falls back to a signed Storage URL.
- Survive logout / device change (the canonical copy is in Storage). Deleting a
  photo removes both the cache and the Storage object.
- Shown as thumbnails on the injury card; click to enlarge (lightbox).

Requires migration `20260706150000_injury_photos_storage.sql` (creates the
bucket + RLS).

## 6. Dashboard

- **All-clear banner** — when there are no active injuries, a positive green
  banner ("Injury-free · all clear"); otherwise the red active-injury banner.
- **Injury & rehab section** — a compact card per active injury (stage, days,
  latest pain, plan size, rehab logs in 14 days) plus recovered count and average
  days-to-recover.
- **Daily-intensity heatmap** carries **month labels** and rings injury-related
  days in red.

---

## Data model reference

Types live in `frontend/src/supabase/types.ts`; write helpers in
`frontend/src/db/records.ts`.

**`Injury`** (table `injuries`)
- `body_area` (legacy raw) + `body_area_zh` / `body_area_en`
- `body_part`, `laterality`, `injury_type`, `scenario`
- `started_on`, `status` (7-stage), `resolved_on`, `severity`
- `note_raw` (legacy) + `note_zh` / `note_en`
- `checkpoints: {status, date, note?}[]`
- `attachments: {label, url?, note?, kind:'link'|'photo', photo_id?, storage_path?}[]`
- `rehab_plan_exercise_ids: string[]`
- `assessments: {date, pain, note?}[]`

`normalizeInjury()` (db/records.ts) backfills every read so legacy/partial rows
render safely.

**`Exercise`** (table `exercises`) — rehab additions: `is_rehab`,
`rehab_purpose_zh/en`, `rehab_cues_zh/en`, `rehab_dosage`.

**Photos** — canonical bytes in Supabase Storage (`injury-photos` bucket); local
cache in the Dexie `injury_photos` table (not part of the sync engine).

### Migrations (apply in order — see `SETUP.md` §1)
| # | file | adds |
|---|------|------|
| 2 | `20260706120000_injury_v2.sql` | 7-stage status, bilingual area/note, laterality/type/scenario, checkpoints, attachments |
| 3 | `20260706130000_rehab_library.sql` | rehab fields on `exercises` |
| 4 | `20260706140000_rehab_loop.sql` | `rehab_plan_exercise_ids`, `assessments` |
| 5 | `20260706150000_injury_photos_storage.sql` | private `injury-photos` bucket + RLS |

Sync: rows upsert whole-row (`select('*')`), so added columns sync with no code
change. The Dexie `injury_photos` cache is local-only and never synced.
