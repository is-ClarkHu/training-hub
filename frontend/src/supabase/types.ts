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
  title: string         // e.g. 'Chest+Abs'
  body_parts: BodyPart[]
  exercise_ids?: string[] // specific exercises planned for this day (§6B)
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

// A text/link reference to an external artifact (exam report, imaging, photo,
// prescription). Phase 1 stores references only — no binary upload.
export interface InjuryAttachmentRef {
  label: string         // e.g. 'MRI report', '处方'
  url?: string          // optional external link
  note?: string
}

// ─── Tables (§4) ─────────────────────────────────────────────────────────────
export interface Exercise extends SyncFields {
  name_zh: string
  name_en: string
  body_part: BodyPart
  measure_type: MeasureType
  assisted: boolean      // lower weight = harder; UI flips the progression narrative
  is_custom: boolean
  name_locked: boolean   // user-edited translation; AI must never overwrite
  needs_translation: boolean
  default_per_side?: boolean // this movement is inherently per-side (prefills the toggle)
  is_warmup?: boolean        // classified as a warmup movement (own group in the picker)
}

export interface WorkoutEntry extends SyncFields {
  date: string                       // 'YYYY-MM-DD'
  exercise_id: string
  is_superset: boolean
  superset_group: string | null
  note_raw: string                   // preserved verbatim (§5.3, §14)
  note_tags: string[]                // canonical tag keys parsed from the note (§5.3)
  cycle_day_label: string | null     // A/B/C/D in the active cycle (§6B)
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
  body_area: string                  // free text, e.g. 'left hamstring'
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
}

export interface TrainingCycle extends SyncFields {
  name: string
  active: boolean                    // only one active per user
  days: CycleDay[]
}

export interface OptionalTracker extends SyncFields {
  tracker: TrackerType
  date: string
  count: number
  category?: IntimacyCategory | null
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
  optional_trackers: OptionalTracker
  translation_dictionary: TranslationDictionaryRow
  chat_messages: ChatMessage
  insights: Insight
}

export type TableName = keyof Database
