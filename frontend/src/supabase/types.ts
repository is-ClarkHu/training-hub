// Shared domain types — hand-written to mirror supabase/migrations (SPEC §4).
// Both the Dexie local store (src/db) and supabase-js queries use these row types.
// When the Supabase project exists, generated types can replace/augment this file.

// ─── Fixed enums (CHECK-constrained in the DB) ───────────────────────────────
export type BodyPart =
  | 'chest' | 'back' | 'shoulders' | 'legs' | 'arms' | 'core' | 'frisbee' // §4.1 (FIXED 7)
export type MeasureType = 'weight_reps' | 'reps_only' | 'duration'        // §6
export type SetType = 'normal' | 'warmup' | 'superset' | 'dropset'
export type InjuryStatus = 'acute' | 'rehab' | 'recovered'
export type InjuryModified = 'paused' | 'reduced'
export type TrackerType = 'intimacy'                                       // v1: one type
export type TranslationDomain = 'exercise' | 'body_part' | 'note_tag' | 'sport'
export type TranslationSource = 'seed' | 'ai' | 'user'
export type ChatRole = 'user' | 'assistant'
export type TierLevel = 1 | 2 | 3 | 4

/** The fixed 7 body parts, in display order (§4.1). */
export const BODY_PARTS: readonly BodyPart[] = [
  'chest', 'back', 'shoulders', 'legs', 'arms', 'core', 'frisbee',
] as const

/** Bilingual labels for the fixed body-part keys (§4.1). */
export const BODY_PART_LABELS: Record<BodyPart, { zh: string; en: string }> = {
  chest: { zh: '胸', en: 'Chest' },
  back: { zh: '背', en: 'Back' },
  shoulders: { zh: '肩', en: 'Shoulders' },
  legs: { zh: '腿', en: 'Legs' },
  arms: { zh: '手臂', en: 'Arms' },
  core: { zh: '腹', en: 'Core' },
  frisbee: { zh: '飞盘', en: 'Frisbee' },
}

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
export interface SportTier {
  level: TierLevel
  key: string           // e.g. 'play' | 'casual' | 'club' | 'major'
  zh: string
  en: string
}

/** Default 4-tier template for a newly-added sport (§4.5). */
export const DEFAULT_SPORT_TIERS: SportTier[] = [
  { level: 1, key: 'play', zh: '玩玩', en: 'Play' },
  { level: 2, key: 'casual', zh: '休闲', en: 'Casual' },
  { level: 3, key: 'club', zh: '训练/俱乐部', en: 'Club' },
  { level: 4, key: 'major', zh: '大赛', en: 'Major' },
]

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

export interface ExerciseSet extends SyncFields {
  entry_id: string
  set_index: number                  // 1-based
  set_type: SetType
  weight: number | null
  reps: number | null
  duration_sec: number | null
  per_side: boolean
  note?: string                      // per-set note (e.g. to-failure); §5.3
}

export interface Sport extends SyncFields {
  name_zh: string
  name_en: string
  is_default: boolean                // the user's primary sport (frisbee by default)
  name_locked: boolean
  needs_translation: boolean
  tiers: SportTier[]                 // exactly 4 (§4.5)
}

export interface SportSession extends SyncFields {
  date: string
  sport_id: string
  tier: TierLevel                    // label resolved from the sport's tiers
  hours: number
  injury: boolean
  estimated: boolean
  note_raw: string
  note_tags: string[]
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
  body_part: BodyPart | null         // optional link to one of the 7
  started_on: string                 // ISO date
  status: InjuryStatus
  resolved_on: string | null
  severity: number | null            // 1–5
  note_raw: string
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
