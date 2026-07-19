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
  EntryCycleAssignment,
  OptionalTracker,
  TranslationDictionaryRow,
  Chatroom,
  ChatroomSummary,
  ChatroomMemory,
  ChatroomMemoryAccess,
  ChatMessage,
  Insight,
  Basics,
  BodyMeasurement,
  Note,
  Supplement,
  TrainingEnv,
  MedicalBackground,
  FoodLog,
  PublicFile,
  ChatroomFileAccess,
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
  entry_cycle_assignments!: Table<EntryCycleAssignment, string>
  optional_trackers!: Table<OptionalTracker, string>
  translation_dictionary!: Table<TranslationDictionaryRow, string>
  chatrooms!: Table<Chatroom, string>
  chatroom_summaries!: Table<ChatroomSummary, string>
  chatroom_memories!: Table<ChatroomMemory, string>
  chatroom_memory_access!: Table<ChatroomMemoryAccess, string>
  basics!: Table<Basics, string>
  body_measurements!: Table<BodyMeasurement, string>
  notes!: Table<Note, string>
  supplements!: Table<Supplement, string>
  training_env!: Table<TrainingEnv, string>
  medical_background!: Table<MedicalBackground, string>
  food_log!: Table<FoodLog, string>
  public_files!: Table<PublicFile, string>
  chatroom_file_access!: Table<ChatroomFileAccess, string>
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
    // v7: room memory lifecycle (P4) — rolling summaries, memory units, cross-room grants.
    this.version(7).stores({
      chatroom_summaries: 'id, chatroom_id, updated_at',
      chatroom_memories: 'id, chatroom_id, updated_at',
      chatroom_memory_access: 'id, reader_room_id, source_room_id, updated_at',
    })
    // v8: AI pre-fillable data modules (P6).
    this.version(8).stores({
      basics: 'id, user_id, updated_at',
      body_measurements: 'id, date, updated_at',
      notes: 'id, tag, updated_at',
      supplements: 'id, updated_at',
      training_env: 'id, user_id, updated_at',
      medical_background: 'id, user_id, updated_at',
    })
    // v9: food log + public files (P6c / P5).
    this.version(9).stores({
      food_log: 'id, eaten_at, updated_at',
      public_files: 'id, updated_at',
      chatroom_file_access: 'id, chatroom_id, file_id, updated_at',
    })
    // v10: many-to-many cycle membership (§6B). New table only — existing stores
    // and their data are untouched. Backfill one assignment per already-assigned
    // entry, reusing the entry's id so this is idempotent and matches the server
    // backfill exactly (no duplicate rows after sync).
    this.version(10)
      .stores({
        entry_cycle_assignments: 'id, entry_id, cycle_id, cycle_round_id, updated_at',
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString()
        const rows: EntryCycleAssignment[] = []
        await tx.table('workout_entries').toCollection().each((e: Record<string, unknown>) => {
          if (e.deleted) return
          const cycleId = e.cycle_id as string | null | undefined
          const dayLabel = e.cycle_day_label as string | null | undefined
          if (!cycleId || !dayLabel) return // only entries actually assigned to a cycle
          rows.push({
            id: e.id as string, // deterministic: the primary assignment shares the entry id
            user_id: (e.user_id as string) ?? '',
            updated_at: now,
            deleted: false,
            entry_id: e.id as string,
            cycle_id: cycleId,
            cycle_round_id: (e.cycle_round_id as string | null) ?? null,
            cycle_day_label: dayLabel,
          })
        })
        if (rows.length) await tx.table('entry_cycle_assignments').bulkPut(rows)
      })
  }
}

export const db = new TrainingHubDB()

/** Wipe all local data — call on logout / account switch (SPEC §3). */
export async function clearLocalDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()))
}
