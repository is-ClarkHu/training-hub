// Write helpers for the local-first store. Every new row gets sync fields stamped
// (client UUID, user_id from the session, updated_at, deleted=false) so the
// SyncEngine can later upsert it to Supabase unchanged (SPEC §3).
import { db } from './db'
import { newId, nowIso, today } from './helpers'
import { currentUserId, supabase } from '../supabase/client'
import { FRISBEE_FIELDS } from '../supabase/types'
import type {
  BodyPart,
  CycleDay,
  Exercise,
  ExerciseSet,
  Injury,
  InjuryModified,
  InjuryStatus,
  IntimacyCategory,
  MeasureType,
  OptionalTracker,
  SetType,
  Sport,
  SportSession,
  SportField,
  SubSet,
  TrackerType,
  TrainingCycle,
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
  default_per_side?: boolean
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

export async function updateExercise(
  id: string,
  patch: Partial<Pick<Exercise, 'name_zh' | 'name_en' | 'body_part' | 'measure_type' | 'assisted' | 'name_locked' | 'needs_translation' | 'default_per_side'>>,
): Promise<void> {
  const e = await db.exercises.get(id)
  if (e) await db.exercises.put({ ...e, ...patch, updated_at: nowIso() })
}

export async function softDeleteExercise(id: string): Promise<void> {
  const e = await db.exercises.get(id)
  if (e) await db.exercises.put({ ...e, deleted: true, updated_at: nowIso() })
}

/** Count live workout entries referencing an exercise (for merge/delete UX). */
export async function exerciseUsage(id: string): Promise<number> {
  const rows = await db.workout_entries.where('exercise_id').equals(id).toArray()
  return rows.filter((e) => !e.deleted).length
}

/** Merge `fromId` into `intoId`: reassign all its entries, then retire it (§ merge). */
export async function mergeExercises(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return
  const ts = nowIso()
  await db.transaction('rw', db.workout_entries, db.exercises, async () => {
    const ents = await db.workout_entries.where('exercise_id').equals(fromId).toArray()
    await db.workout_entries.bulkPut(ents.map((e) => ({ ...e, exercise_id: intoId, updated_at: ts })))
    const ex = await db.exercises.get(fromId)
    if (ex) await db.exercises.put({ ...ex, deleted: true, updated_at: ts })
  })
}

// ── workout entry + its sets (one transaction) ───────────────
export interface NewSetInput {
  set_type?: SetType
  weight?: number | null
  reps?: number | null
  duration_sec?: number | null
  per_side?: boolean
  sub_sets?: SubSet[]
  note?: string
}

export interface NewEntryInput {
  date: string
  exercise_id: string
  is_superset?: boolean
  note_raw?: string
  note_tags?: string[]
  cycle_day_label?: string | null
  injury_modified?: InjuryModified | null
  injury_id?: string | null
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
    sub_sets: [],
    note: '',
    ...s,
  }))
  await db.transaction('rw', db.workout_entries, db.sets, async () => {
    await db.workout_entries.add(entry)
    await db.sets.bulkAdd(sets)
  })
  return { entry, sets }
}

// ── sports library (§4.5, §7.4 — redesigned: per-sport custom fields) ─────────
export interface NewSportInput {
  name_zh: string
  name_en: string
  is_default?: boolean
  fields?: SportField[]
  name_locked?: boolean
  needs_translation?: boolean
}

export async function createSport(input: NewSportInput): Promise<Sport> {
  const row: Sport = {
    ...syncFields(),
    is_default: false,
    name_locked: false,
    needs_translation: false,
    fields: [],            // default: no custom fields (just duration)
    ...input,
  }
  await db.sports.add(row)
  return row
}

export async function getSports(): Promise<Sport[]> {
  const all = await db.sports.toArray()
  // Back-compat: older rows may lack `fields` — normalize so the UI never crashes.
  return all.filter((s) => !s.deleted).map((s) => ({ ...s, fields: s.fields ?? [] }))
}

export async function updateSport(
  id: string,
  patch: Partial<Pick<Sport, 'name_zh' | 'name_en' | 'fields' | 'is_default' | 'name_locked' | 'needs_translation'>>,
): Promise<void> {
  const s = await db.sports.get(id)
  if (s) await db.sports.put({ ...s, ...patch, updated_at: nowIso() })
}

export async function softDeleteSport(id: string): Promise<void> {
  const s = await db.sports.get(id)
  if (s) await db.sports.put({ ...s, deleted: true, updated_at: nowIso() })
}

/** Seed the default frisbee sport on first use; returns the live sport list. */
export async function ensureDefaultSport(): Promise<Sport[]> {
  const sports = await getSports()
  if (sports.length > 0) return sports
  const frisbee = await createSport({
    name_zh: '飞盘',
    name_en: 'Frisbee',
    is_default: true,
    fields: FRISBEE_FIELDS,
  })
  return [frisbee]
}

// ── sport sessions ───────────────────────────────────────────
export interface NewSportSessionInput {
  date: string
  sport_id: string
  hours: number
  attributes?: Record<string, string>
  injury?: boolean
  note_raw?: string
  note_tags?: string[]
}

export async function createSportSession(input: NewSportSessionInput): Promise<SportSession> {
  const row: SportSession = {
    ...syncFields(),
    attributes: {},
    injury: false,
    note_raw: '',
    note_tags: [],
    ...input,
  }
  await db.sport_sessions.add(row)
  return row
}

export async function getSportSessions(): Promise<SportSession[]> {
  const all = await db.sport_sessions.toArray()
  return all
    .filter((s) => !s.deleted)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export async function softDeleteSportSession(id: string): Promise<void> {
  const s = await db.sport_sessions.get(id)
  if (s) await db.sport_sessions.put({ ...s, deleted: true, updated_at: nowIso() })
}

export async function updateSportSession(
  id: string,
  patch: Partial<Pick<SportSession, 'date' | 'hours' | 'attributes' | 'injury' | 'note_raw'>>,
): Promise<void> {
  const s = await db.sport_sessions.get(id)
  if (s) await db.sport_sessions.put({ ...s, ...patch, updated_at: nowIso() })
}

// ── injuries (§4.8, §6A) ─────────────────────────────────────
export interface NewInjuryInput {
  body_area: string
  body_part?: BodyPart | null
  started_on: string
  status?: InjuryStatus
  resolved_on?: string | null
  severity?: number | null
  note_raw?: string
}

export async function createInjury(input: NewInjuryInput): Promise<Injury> {
  const row: Injury = {
    ...syncFields(),
    body_part: null,
    status: 'acute',
    resolved_on: null,
    severity: null,
    note_raw: '',
    ...input,
  }
  await db.injuries.add(row)
  return row
}

export async function getInjuries(): Promise<Injury[]> {
  const all = await db.injuries.toArray()
  const order: Record<InjuryStatus, number> = { acute: 0, rehab: 1, recovered: 2 }
  return all
    .filter((i) => !i.deleted)
    .sort((a, b) =>
      order[a.status] !== order[b.status]
        ? order[a.status] - order[b.status]
        : a.started_on < b.started_on
          ? 1
          : -1,
    )
}

export async function updateInjury(
  id: string,
  patch: Partial<Pick<Injury, 'body_area' | 'body_part' | 'started_on' | 'status' | 'resolved_on' | 'severity' | 'note_raw'>>,
): Promise<void> {
  const cur = await db.injuries.get(id)
  if (!cur) return
  const next: Injury = { ...cur, ...patch, updated_at: nowIso() }
  // Keep resolved_on consistent with status (§6A acute → rehab → recovered).
  if (next.status === 'recovered' && !next.resolved_on) next.resolved_on = today()
  if (next.status !== 'recovered') next.resolved_on = null
  await db.injuries.put(next)
}

export async function softDeleteInjury(id: string): Promise<void> {
  const i = await db.injuries.get(id)
  if (i) await db.injuries.put({ ...i, deleted: true, updated_at: nowIso() })
}

// ── training cycle (§4.9, §6B) ───────────────────────────────
export interface NewCycleInput {
  name: string
  active?: boolean
  days?: CycleDay[]
}

async function deactivateAllCycles(): Promise<void> {
  const all = await db.training_cycle.toArray()
  for (const c of all) {
    if (c.active && !c.deleted) await db.training_cycle.put({ ...c, active: false, updated_at: nowIso() })
  }
}

export async function createCycle(input: NewCycleInput): Promise<TrainingCycle> {
  const row: TrainingCycle = { ...syncFields(), active: false, days: [], ...input }
  await db.transaction('rw', db.training_cycle, async () => {
    if (row.active) await deactivateAllCycles()
    await db.training_cycle.add(row)
  })
  return row
}

export async function getCycles(): Promise<TrainingCycle[]> {
  const all = await db.training_cycle.toArray()
  return all.filter((c) => !c.deleted)
}

export async function getActiveCycle(): Promise<TrainingCycle | null> {
  const all = await db.training_cycle.toArray()
  return all.find((c) => c.active && !c.deleted) ?? null
}

export async function updateCycle(
  id: string,
  patch: Partial<Pick<TrainingCycle, 'name' | 'days'>>,
): Promise<void> {
  const c = await db.training_cycle.get(id)
  if (c) await db.training_cycle.put({ ...c, ...patch, updated_at: nowIso() })
}

export async function setActiveCycle(id: string): Promise<void> {
  await db.transaction('rw', db.training_cycle, async () => {
    await deactivateAllCycles()
    const c = await db.training_cycle.get(id)
    if (c) await db.training_cycle.put({ ...c, active: true, updated_at: nowIso() })
  })
}

export async function softDeleteCycle(id: string): Promise<void> {
  const c = await db.training_cycle.get(id)
  if (c) await db.training_cycle.put({ ...c, deleted: true, active: false, updated_at: nowIso() })
}

// ── optional trackers (§4.10, §6C) ───────────────────────────
export async function logTracker(
  tracker: TrackerType,
  date: string,
  count = 1,
  category: IntimacyCategory | null = null,
): Promise<OptionalTracker> {
  const row: OptionalTracker = { ...syncFields(), tracker, date, count, category }
  await db.optional_trackers.add(row)
  return row
}

export async function getTrackerEntries(tracker: TrackerType): Promise<OptionalTracker[]> {
  const all = await db.optional_trackers.toArray()
  return all
    .filter((t) => t.tracker === tracker && !t.deleted)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export async function deleteTrackerEntry(id: string): Promise<void> {
  await db.optional_trackers.delete(id)
  if (currentUserId()) {
    await supabase.from('optional_trackers').delete().eq('id', id)
  }
}

/** Easy off + delete (§6C): soft-delete every row for a tracker. */
export async function deleteAllTracker(tracker: TrackerType): Promise<void> {
  const ts = nowIso()
  const all = await db.optional_trackers.toArray()
  const rows = all.filter((t) => t.tracker === tracker && !t.deleted)
  await db.optional_trackers.bulkPut(rows.map((t) => ({ ...t, deleted: true, updated_at: ts })))
}

// ── History reads / edits (§7.2) ─────────────────────────────
/** Live workout entries, newest first (by date, then recency). */
export async function getEntries(): Promise<WorkoutEntry[]> {
  const all = await db.workout_entries.toArray()
  return all
    .filter((e) => !e.deleted)
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.updated_at < b.updated_at ? 1 : -1,
    )
}

/** Map entryId → its live sets (set_index order). */
export async function getSetsByEntryIds(ids: string[]): Promise<Record<string, ExerciseSet[]>> {
  if (ids.length === 0) return {}
  const rows = await db.sets.where('entry_id').anyOf(ids).toArray()
  const map: Record<string, ExerciseSet[]> = {}
  for (const s of rows) {
    if (s.deleted) continue
    ;(map[s.entry_id] ??= []).push(s)
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => a.set_index - b.set_index)
  return map
}

/** Soft-delete an entry and its sets (tombstones for sync, §3). */
export async function softDeleteEntry(entryId: string): Promise<void> {
  const ts = nowIso()
  await db.transaction('rw', db.workout_entries, db.sets, async () => {
    const e = await db.workout_entries.get(entryId)
    if (e) await db.workout_entries.put({ ...e, deleted: true, updated_at: ts })
    const rows = await db.sets.where('entry_id').equals(entryId).toArray()
    await db.sets.bulkPut(rows.map((s) => ({ ...s, deleted: true, updated_at: ts })))
  })
}

/** Edit an entry: patch fields, soft-delete old sets, add the new ones. */
export async function updateEntry(
  entryId: string,
  patch: Partial<Pick<WorkoutEntry, 'note_raw' | 'note_tags' | 'is_superset' | 'needs_review' | 'needs_translation' | 'injury_modified' | 'injury_id'>>,
  newSets: NewSetInput[],
): Promise<void> {
  const ts = nowIso()
  await db.transaction('rw', db.workout_entries, db.sets, async () => {
    const e = await db.workout_entries.get(entryId)
    if (!e) return
    await db.workout_entries.put({ ...e, ...patch, updated_at: ts })
    const existing = await db.sets.where('entry_id').equals(entryId).toArray()
    await db.sets.bulkPut(existing.map((s) => ({ ...s, deleted: true, updated_at: ts })))
    const fresh: ExerciseSet[] = newSets.map((s, i) => ({
      ...syncFields(),
      entry_id: entryId,
      set_index: i + 1,
      set_type: 'normal',
      weight: null,
      reps: null,
      duration_sec: null,
      per_side: false,
      sub_sets: [],
      note: '',
      ...s,
    }))
    await db.sets.bulkAdd(fresh)
  })
}
