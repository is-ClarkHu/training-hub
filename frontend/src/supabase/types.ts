// Shared domain types — hand-written to mirror supabase/migrations (SPEC §4).
// Both the Dexie local store (src/db) and supabase-js queries use these row types.
// When the Supabase project exists, generated types can replace/augment this file.

// body_part is now a free string — the category set is user-editable (see
// ../categories). No longer a fixed enum; the DB check constraint was dropped.
export type BodyPart = string
export type MeasureType = 'weight_reps' | 'reps_only' | 'duration'        // §6
export type SetType = 'normal' | 'warmup' | 'superset' | 'dropset'
// Injury lifecycle as an EVENT (§6A, redesigned): the middle stages are what the
// user manages, not a binary healed/not. Legacy rows may still carry the old
// 'acute' | 'rehab' | 'recovered' — normalizeInjury() (src/db) maps those forward.
export type InjuryStatus =
  | 'newly_occurred'   // 新发生
  | 'observing'        // 观察中
  | 'treating'         // 治疗中
  | 'rehab_training'   // 康复训练中
  | 'returning'        // 逐步复训
  | 'recovered'        // 已康复
  | 'relapsed'         // 复发
export type InjuryLaterality = 'left' | 'right' | 'bilateral'
export type InjuryType = 'sprain' | 'strain' | 'contusion' | 'overuse' | 'fracture' | 'other'
export type InjuryScenario = 'running' | 'strength' | 'competition' | 'daily' | 'other'
export type InjuryModified = 'paused' | 'reduced'
export type TrackerType = 'intimacy'                                       // private adult wellness tracker
export type IntimacyCategory = 'solo' | 'partner_low' | 'partner_active'
export type TranslationDomain = 'exercise' | 'body_part' | 'note_tag' | 'sport'
export type TranslationSource = 'seed' | 'ai' | 'user'
export type ChatRole = 'user' | 'assistant'
export type TierLevel = 1 | 2 | 3 | 4

/** Bilingual labels for measure types (§6). */
export const MEASURE_TYPE_LABELS: Record<MeasureType, { zh: string; en: string }> = {
  weight_reps: { zh: '重量 × 次数', en: 'Weight × reps' },
  reps_only: { zh: '次数', en: 'Reps' },
  duration: { zh: '时长', en: 'Duration' },
}

// ─── Sync fields present on every user-data row (§3, §4) ─────────────────────
export interface SyncFields {
  id: string            // client-generated UUID
  user_id: string       // owner; set from the session (RLS: user_id = auth.uid())
  updated_at: string    // ISO8601; client-controlled (last-write-wins)
  deleted: boolean      // soft-delete tombstone
}

// ─── Embedded JSON shapes ────────────────────────────────────────────────────
// Sports no longer force a fixed 4-tier scale. Each sport declares its OWN custom
// fields (frisbee: a "level" select; basketball: none — just duration). Sessions
// store the field values in `attributes`. (§4.5, redesigned per user feedback.)
export type SportFieldType = 'select' | 'text' | 'number'

export interface SportFieldOption {
  value: string          // stable key, e.g. 'club'
  zh: string             // '俱乐部'
  en: string             // 'Club'
}

export interface SportField {
  key: string            // stable key, e.g. 'level'
  label_zh: string       // '等级'
  label_en: string       // 'Level'
  type: SportFieldType
  options?: SportFieldOption[] // only for type='select'
}

/** Frisbee's optional "level" field — organizational labels, not tier numbers. */
export const FRISBEE_FIELDS: SportField[] = [
  {
    key: 'level',
    label_zh: '等级',
    label_en: 'Level',
    type: 'select',
    options: [
      { value: 'toss', zh: '抛接', en: 'Toss' },
      { value: 'casual', zh: '休闲', en: 'Casual' },
      { value: 'club', zh: '俱乐部', en: 'Club' },
      { value: 'major', zh: '大赛', en: 'Major' },
    ],
  },
]

// Legacy — kept for back-compat with older exports. New sports use SportField.
export interface SportTier {
  level: TierLevel
  key: string
  zh: string
  en: string
}

export interface CycleDay {
  label: string         // 'A' | 'B' | ...
  title: string         // legacy/fallback display title
  title_zh?: string     // localized title, e.g. 胸 + 核心
  title_en?: string     // localized title, e.g. Chest + Core
  body_parts: BodyPart[]
  exercise_ids?: string[] // specific exercises planned for this day (§6B)
  regions?: string[]      // body-model regions this cycle day lights during the current loop
}

export interface ProfileInjury {
  area: string
  since: string         // ISO date
  status: string
}

// A stage transition in an injury's history (§6A). Auto-recorded when status
// changes; an optional note lets the user annotate the checkpoint.
export interface InjuryCheckpoint {
  status: InjuryStatus
  date: string          // ISO date the injury entered this stage
  note?: string
}

// A reference to an external artifact (exam report, photo, prescription).
// kind 'link' = a text/URL reference. kind 'photo' = a compressed photo uploaded
// to private Supabase Storage (storage_path), with a LOCAL Dexie copy (photo_id)
// kept as an offline cache. Medical imaging is intentionally unsupported (too large).
export interface InjuryAttachmentRef {
  label: string         // e.g. 'MRI report', '处方'
  url?: string          // optional external link (kind 'link')
  note?: string
  kind?: 'link' | 'photo'
  photo_id?: string     // local injury_photos cache row id (kind 'photo')
  storage_path?: string // Supabase Storage object path (kind 'photo')
}

// Local offline cache of a compressed photo (§6A Phase 4). The canonical copy
// lives in Supabase Storage; this Dexie row is a cache, cleared on logout and
// re-fetched from Storage on demand. Referenced by InjuryAttachmentRef.photo_id.
export interface InjuryPhoto {
  id: string
  injury_id: string
  data: string          // compressed JPEG data URL
  created_at: string
}

// A symptom check-in during rehab (§6A Phase 3): pain 0–10 + optional note.
export interface InjuryAssessment {
  date: string          // ISO date of the check-in
  pain: number          // 0 (none) – 10 (worst)
  note?: string
}

// ─── Tables (§4) ─────────────────────────────────────────────────────────────
export interface Exercise extends SyncFields {
  name_zh: string
  name_en: string
  body_parts: BodyPart[]  // an exercise can belong to multiple categories (§6B)
  measure_type: MeasureType
  assisted: boolean      // lower weight = harder; UI flips the progression narrative
  is_custom: boolean
  name_locked: boolean   // user-edited translation; AI must never overwrite
  needs_translation: boolean
  default_per_side?: boolean // this movement is inherently per-side (prefills the toggle)
  duration_hm?: boolean      // duration entered/shown as hh:mm instead of mm:ss (long cardio)
  bodyweight?: boolean       // 徒手 (home/calisthenics) vs 健身房 (gym/weighted). See exerciseKind()
  // ── strength kind: from raw_data's 类型 (健身房 vs 健身/徒手). Drives the History dot colour. ──
  is_warmup?: boolean        // classified as a warmup movement (own group in the picker)
  // ── rehab library (§6A Phase 2). is_rehab is orthogonal to body_part — a rehab
  //    move still belongs to an anatomical part (e.g. knee) but carries knowledge. ──
  is_rehab?: boolean
  rehab_purpose_zh?: string  // what it helps / trains (bilingual)
  rehab_purpose_en?: string
  rehab_cues_zh?: string     // how to perform / precautions (bilingual)
  rehab_cues_en?: string
  rehab_dosage?: string      // dosage guidance, e.g. '3×15 / daily'
}

export interface WorkoutEntry extends SyncFields {
  date: string                       // 'YYYY-MM-DD'
  exercise_id: string
  is_superset: boolean
  superset_group: string | null
  note_raw: string                   // preserved verbatim (§5.3, §14)
  note_tags: string[]                // canonical tag keys parsed from the note (§5.3)
  cycle_day_label: string | null     // A/B/C/D within cycle_id's split (§6B)
  cycle_id?: string | null           // which cycle the day label belongs to (multiple cycles/day)
  module_part?: BodyPart | null      // History mode-2: user override of which category module
                                     // this occurrence files under (null = exercise's primary)
  sort_order?: number                // performed order within the day (set at log time =
                                     // creation ms; user can reorder). Lower = done earlier.
  injury_modified: InjuryModified | null
  injury_id: string | null
  needs_review: boolean
  needs_translation: boolean
}

// A sub-set is one weight×reps (or duration) pair inside a set. A normal set has
// just its primary values; a superset/dropset set carries extra sub-sets here.
export interface SubSet {
  weight: number | null
  reps: number | null
  duration_sec: number | null
}

export interface ExerciseSet extends SyncFields {
  entry_id: string
  set_index: number                  // 1-based order of the SET (not the sub-set)
  set_type: SetType
  weight: number | null              // primary (first) sub-set's weight
  reps: number | null                // primary sub-set's reps
  duration_sec: number | null        // primary sub-set's duration
  per_side: boolean
  sub_sets?: SubSet[]                // ADDITIONAL sub-sets (superset/dropset); empty = single
  note?: string                      // per-set note (e.g. to-failure); §5.3
  // Optional cardio metrics (treadmill / stair climber / …), all nullable — shown
  // for duration exercises alongside the time; never required.
  distance?: number | null           // km
  calories?: number | null           // active kcal
  bpm?: number | null                // average heart rate
}

export interface Sport extends SyncFields {
  name_zh: string
  name_en: string
  is_default: boolean                // the user's primary sport (frisbee by default)
  name_locked: boolean
  needs_translation: boolean
  fields: SportField[]               // per-sport custom attributes (may be empty)
  tiers?: SportTier[]                // legacy — ignored; kept so old rows parse
}

export interface SportSession extends SyncFields {
  date: string
  sport_id: string
  hours: number                      // universal: every sport tracks duration
  attributes: Record<string, string> // values for this sport's custom fields
  injury: boolean
  note_raw: string
  note_tags: string[]
  calories?: number | null           // optional active kcal (e.g. from a watch)
  bpm?: number | null                // optional average heart rate
  tier?: number                      // legacy — ignored; kept so old rows parse
}

export interface Profile extends SyncFields {
  bodyweight_kg: number | null
  goal: string | null
  injuries: ProfileInjury[]
  split: unknown | null              // training split definition
  notes: string | null
}

export interface Injury extends SyncFields {
  body_area: string                  // legacy raw free text, e.g. 'left hamstring'
  body_area_zh: string               // bilingual body area — resolved by UI language (§14)
  body_area_en: string
  body_part: BodyPart | null         // optional category link
  laterality: InjuryLaterality | null // left / right / bilateral
  injury_type: InjuryType | null     // sprain / strain / contusion / overuse / fracture
  scenario: InjuryScenario | null    // where it happened: running / strength / competition / daily
  started_on: string                 // ISO date (onset)
  status: InjuryStatus
  resolved_on: string | null
  severity: number | null            // 1–5
  note_raw: string                   // legacy raw note (pre-bilingual rows)
  note_zh: string                    // bilingual note — AI-translated pair (§5)
  note_en: string
  checkpoints: InjuryCheckpoint[]    // stage-transition history (§6A)
  attachments: InjuryAttachmentRef[] // text/link references only (Phase 1)
  rehab_plan_exercise_ids: string[]  // rehab-library exercises assigned to this injury (§6A Phase 3)
  assessments: InjuryAssessment[]    // symptom check-ins (pain 0–10) over time
}

export interface TrainingCycle extends SyncFields {
  name: string
  active: boolean                    // only one active per user
  display_mode?: 'body' | 'circle'   // how the loop progress is visualized
  days: CycleDay[]
}

// One pass through a cycle's day sequence (§6B rounds). Opened when the first
// cycle-tagged workout of the pass is logged; auto-closes when every day label is
// covered, or early via "skip". Recorded in History and linked to Log.
export interface CycleRound extends SyncFields {
  cycle_id: string
  index: number                      // 1-based round number within the cycle
  started_on: string                 // ISO date of the first day logged this round
  ended_on: string | null            // ISO date it closed; null = in progress
  completed_labels: string[]         // day labels done this round, in log order
  skipped: boolean                   // closed early (not all days done)
}

export interface OptionalTracker extends SyncFields {
  tracker: TrackerType
  date: string
  count: number
  category?: IntimacyCategory | null
  note?: string | null
}

export interface TranslationDictionaryRow extends SyncFields {
  domain: TranslationDomain
  zh: string
  en: string
  source: TranslationSource
  verified: boolean                  // user-confirmed; protects from AI overwrite
}

// Phase-2 tables (created empty now; §4.7)
export interface ChatMessage extends SyncFields {
  role: ChatRole
  content: string
  created_at: string
}

export interface Insight extends SyncFields {
  kind: string
  content: string
  created_at: string
  superseded_by: string | null       // null = current
}

// ─── Table registry (table name → row type) ─────────────────────────────────
export interface Database {
  exercises: Exercise
  workout_entries: WorkoutEntry
  sets: ExerciseSet
  sports: Sport
  sport_sessions: SportSession
  profile: Profile
  injuries: Injury
  training_cycle: TrainingCycle
  cycle_rounds: CycleRound
  optional_trackers: OptionalTracker
  translation_dictionary: TranslationDictionaryRow
  chat_messages: ChatMessage
  insights: Insight
}

export type TableName = keyof Database
