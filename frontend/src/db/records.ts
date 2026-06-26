// Write helpers for the local-first store. Every new row gets sync fields stamped
// (client UUID, user_id from the session, updated_at, deleted=false) so the
// SyncEngine can later upsert it to Supabase unchanged (SPEC §3).
import { db } from './db'
import { newId, nowIso } from './helpers'
import { currentUserId } from '../supabase/client'
import type {
  BodyPart,
  Exercise,
  ExerciseSet,
  MeasureType,
  SetType,
  WorkoutEntry,
} from '../supabase/types'

function syncFields() {
  return { id: newId(), user_id: currentUserId() ?? '', updated_at: nowIso(), deleted: false }
}

// ── exercises ────────────────────────────────────────────────
export interface NewExerciseInput {
  name_zh: string
  name_en: string
  body_part: BodyPart
  measure_type: MeasureType
  assisted?: boolean
  is_custom?: boolean
  name_locked?: boolean
  needs_translation?: boolean
}

export async function createExercise(input: NewExerciseInput): Promise<Exercise> {
  const row: Exercise = {
    ...syncFields(),
    assisted: false,
    is_custom: true,
    name_locked: false,
    needs_translation: false,
    ...input,
  }
  await db.exercises.add(row)
  return row
}

export async function getExercises(): Promise<Exercise[]> {
  const all = await db.exercises.toArray()
  return all.filter((e) => !e.deleted)
}

// ── workout entry + its sets (one transaction) ───────────────
export interface NewSetInput {
  set_type?: SetType
  weight?: number | null
  reps?: number | null
  duration_sec?: number | null
  per_side?: boolean
}

export interface NewEntryInput {
  date: string
  exercise_id: string
  is_superset?: boolean
  note_raw?: string
  note_tags?: string[]
  cycle_day_label?: string | null
}

export async function createEntryWithSets(
  entryInput: NewEntryInput,
  setInputs: NewSetInput[],
): Promise<{ entry: WorkoutEntry; sets: ExerciseSet[] }> {
  const entry: WorkoutEntry = {
    ...syncFields(),
    is_superset: false,
    superset_group: null,
    note_raw: '',
    note_tags: [],
    cycle_day_label: null,
    injury_modified: null,
    injury_id: null,
    needs_review: false,
    needs_translation: false,
    ...entryInput,
  }
  const sets: ExerciseSet[] = setInputs.map((s, i) => ({
    ...syncFields(),
    entry_id: entry.id,
    set_index: i + 1,
    set_type: 'normal',
    weight: null,
    reps: null,
    duration_sec: null,
    per_side: false,
    ...s,
  }))
  await db.transaction('rw', db.workout_entries, db.sets, async () => {
    await db.workout_entries.add(entry)
    await db.sets.bulkAdd(sets)
  })
  return { entry, sets }
}
