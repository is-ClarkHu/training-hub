// Local-first source of truth (SPEC §3). Dexie/IndexedDB mirrors the Supabase
// tables; all reads/writes hit here instantly and the SyncEngine reconciles with
// Supabase in the background. On logout the whole DB is cleared (§3).
//
// Indexing note: IndexedDB keys cannot be booleans, so `deleted` / `active` /
// `is_default` are NOT indexed — filter them in queries (data volumes are personal).
// Dates are stored as 'YYYY-MM-DD' strings, which sort correctly as index keys.
import Dexie, { type Table } from 'dexie'
import type {
  Exercise,
  WorkoutEntry,
  ExerciseSet,
  Sport,
  SportSession,
  Profile,
  Injury,
  InjuryPhoto,
  TrainingCycle,
  CycleRound,
  OptionalTracker,
  TranslationDictionaryRow,
  Chatroom,
  ChatMessage,
  Insight,
} from '../supabase/types'

export class TrainingHubDB extends Dexie {
  exercises!: Table<Exercise, string>
  workout_entries!: Table<WorkoutEntry, string>
  sets!: Table<ExerciseSet, string>
  sports!: Table<Sport, string>
  sport_sessions!: Table<SportSession, string>
  profile!: Table<Profile, string>
  injuries!: Table<Injury, string>
  training_cycle!: Table<TrainingCycle, string>
  cycle_rounds!: Table<CycleRound, string>
  optional_trackers!: Table<OptionalTracker, string>
  translation_dictionary!: Table<TranslationDictionaryRow, string>
  chatrooms!: Table<Chatroom, string>
  chat_messages!: Table<ChatMessage, string>
  insights!: Table<Insight, string>
  // Local-only (never synced): compressed injury photos (§6A Phase 4).
  injury_photos!: Table<InjuryPhoto, string>

  constructor() {
    super('training-hub')
    this.version(1).stores({
      exercises: 'id, body_part, measure_type, updated_at', // v3 migrates body_part → *body_parts
      workout_entries: 'id, date, exercise_id, injury_id, cycle_day_label, updated_at',
      sets: 'id, entry_id, updated_at',
      sports: 'id, updated_at',
      sport_sessions: 'id, date, sport_id, tier, updated_at',
      profile: 'id, user_id, updated_at',
      injuries: 'id, status, body_part, updated_at',
      training_cycle: 'id, updated_at',
      optional_trackers: 'id, tracker, date, updated_at',
      translation_dictionary: 'id, domain, zh, [domain+zh], updated_at',
      chat_messages: 'id, created_at, updated_at',
      insights: 'id, kind, created_at, updated_at',
    })
    // v2: local-only injury photos table (not part of the sync engine).
    this.version(2).stores({
      injury_photos: 'id, injury_id, created_at',
    })
    // v3: an exercise can belong to multiple categories — single `body_part`
    // becomes a multiEntry `body_parts` array. Migrate each row in place.
    this.version(3)
      .stores({
        exercises: 'id, *body_parts, measure_type, updated_at',
      })
      .upgrade(async (tx) => {
        await tx.table('exercises').toCollection().modify((e: Record<string, unknown>) => {
          if (!Array.isArray(e.body_parts)) {
            e.body_parts = e.body_part != null ? [e.body_part] : []
          }
          delete e.body_part
        })
      })
    // v4: training-cycle rounds (§6B) — one pass through the cycle's days.
    this.version(4).stores({
      cycle_rounds: 'id, cycle_id, updated_at',
    })
    // v5: AI multi-chatroom (PLAN-ai-chatrooms) — rooms grouping chat by topic.
    this.version(5).stores({
      chatrooms: 'id, sort_order, updated_at',
    })
    // v6: messages are scoped to a room — index chatroom_id for per-room reads.
    this.version(6).stores({
      chat_messages: 'id, chatroom_id, created_at, updated_at',
    })
  }
}

export const db = new TrainingHubDB()

/** Wipe all local data — call on logout / account switch (SPEC §3). */
export async function clearLocalDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()))
}
