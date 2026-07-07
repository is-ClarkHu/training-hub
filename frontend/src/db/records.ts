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
  InjuryAttachmentRef,
  InjuryLaterality,
  InjuryModified,
  InjuryScenario,
  InjuryStatus,
  InjuryType,
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
  laterality?: InjuryLaterality | null
  injury_type?: InjuryType | null
  scenario?: InjuryScenario | null
  started_on: string
  status?: InjuryStatus
  resolved_on?: string | null
  severity?: number | null
  note_raw?: string
  note_zh?: string
  note_en?: string
  attachments?: InjuryAttachmentRef[]
}

const HAS_CJK = /[一-鿿]/

// Legacy 3-state → 7-state (§6A redesign). Old exports/rows still parse.
const LEGACY_STATUS: Record<string, InjuryStatus> = {
  acute: 'observing',
  rehab: 'rehab_training',
  recovered: 'recovered',
}

// Rank for list ordering: active stages first, recovered last. relapsed is active.
const STATUS_RANK: Record<InjuryStatus, number> = {
  newly_occurred: 0,
  relapsed: 1,
  observing: 2,
  treating: 3,
  rehab_training: 4,
  returning: 5,
  recovered: 9,
}

/** Backfill old/partial rows so every read yields a full current-shape Injury. */
function normalizeInjury(raw: Injury): Injury {
  const status = LEGACY_STATUS[raw.status as string] ?? raw.status
  const noteRaw = raw.note_raw ?? ''
  const note_zh = raw.note_zh ?? (HAS_CJK.test(noteRaw) ? noteRaw : '')
  const note_en = raw.note_en ?? (HAS_CJK.test(noteRaw) ? '' : noteRaw)
  const checkpoints =
    raw.checkpoints && raw.checkpoints.length > 0
      ? raw.checkpoints
      : [{ status, date: raw.started_on }]
  return {
    ...raw,
    status,
    laterality: raw.laterality ?? null,
    injury_type: raw.injury_type ?? null,
    scenario: raw.scenario ?? null,
    note_raw: noteRaw,
    note_zh,
    note_en,
    checkpoints,
    attachments: raw.attachments ?? [],
  }
}

export async function createInjury(input: NewInjuryInput): Promise<Injury> {
  const base = {
    ...syncFields(),
    body_part: null,
    laterality: null,
    injury_type: null,
    scenario: null,
    status: 'newly_occurred' as InjuryStatus,
    resolved_on: null,
    severity: null,
    note_raw: '',
    note_zh: '',
    note_en: '',
    attachments: [] as InjuryAttachmentRef[],
    ...input,
  }
  const row: Injury = {
    ...base,
    checkpoints: [{ status: base.status, date: base.started_on }],
  }
  await db.injuries.add(row)
  return row
}

export async function getInjuries(): Promise<Injury[]> {
  const all = await db.injuries.toArray()
  return all
    .filter((i) => !i.deleted)
    .map(normalizeInjury)
    .sort((a, b) =>
      STATUS_RANK[a.status] !== STATUS_RANK[b.status]
        ? STATUS_RANK[a.status] - STATUS_RANK[b.status]
        : a.started_on < b.started_on
          ? 1
          : -1,
    )
}

export async function updateInjury(
  id: string,
  patch: Partial<Pick<Injury, 'body_area' | 'body_part' | 'laterality' | 'injury_type' | 'scenario' | 'started_on' | 'status' | 'resolved_on' | 'severity' | 'note_raw' | 'note_zh' | 'note_en' | 'attachments'>>,
): Promise<void> {
  const stored = await db.injuries.get(id)
  if (!stored) return
  const cur = normalizeInjury(stored)
  const next: Injury = { ...cur, ...patch, updated_at: nowIso() }

  // Record a checkpoint whenever the stage changes (§6A) — the middle stages are
  // what the user manages, so the transition history is the point.
  if (patch.status && patch.status !== cur.status) {
    const last = next.checkpoints[next.checkpoints.length - 1]
    if (!last || last.status !== next.status) {
      next.checkpoints = [...next.checkpoints, { status: next.status, date: today() }]
    }
  }

  // Keep resolved_on consistent with status. relapsed re-opens the injury.
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
