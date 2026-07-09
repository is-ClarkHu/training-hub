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
  InjuryAssessment,
  InjuryAttachmentRef,
  InjuryLaterality,
  InjuryPhoto,
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
  CycleRound,
  WorkoutEntry,
} from '../supabase/types'

function syncFields() {
  return { id: newId(), user_id: currentUserId() ?? '', updated_at: nowIso(), deleted: false }
}

// ── exercises ────────────────────────────────────────────────
export interface NewExerciseInput {
  name_zh: string
  name_en: string
  body_parts: BodyPart[]
  measure_type: MeasureType
  assisted?: boolean
  is_custom?: boolean
  name_locked?: boolean
  needs_translation?: boolean
  default_per_side?: boolean
  duration_hm?: boolean
  bodyweight?: boolean
  is_rehab?: boolean
  rehab_purpose_zh?: string
  rehab_purpose_en?: string
  rehab_cues_zh?: string
  rehab_cues_en?: string
  rehab_dosage?: string
}

export async function createExercise(input: NewExerciseInput): Promise<Exercise> {
  const row: Exercise = {
    ...syncFields(),
    assisted: false,
    is_custom: true,
    name_locked: false,
    needs_translation: false,
    is_rehab: false,
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
  patch: Partial<Pick<Exercise, 'name_zh' | 'name_en' | 'body_parts' | 'measure_type' | 'assisted' | 'name_locked' | 'needs_translation' | 'default_per_side' | 'duration_hm' | 'bodyweight' | 'is_rehab' | 'rehab_purpose_zh' | 'rehab_purpose_en' | 'rehab_cues_zh' | 'rehab_cues_en' | 'rehab_dosage'>>,
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
  cycle_id?: string | null
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
    cycle_id: null,
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
  body_area?: string
  body_area_zh?: string
  body_area_en?: string
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
  const areaRaw = raw.body_area ?? ''
  const body_area_zh = raw.body_area_zh ?? (HAS_CJK.test(areaRaw) ? areaRaw : '')
  const body_area_en = raw.body_area_en ?? (HAS_CJK.test(areaRaw) ? '' : areaRaw)
  const checkpoints =
    raw.checkpoints && raw.checkpoints.length > 0
      ? raw.checkpoints
      : [{ status, date: raw.started_on }]
  return {
    ...raw,
    status,
    body_area: areaRaw || body_area_zh || body_area_en,
    body_area_zh,
    body_area_en,
    laterality: raw.laterality ?? null,
    injury_type: raw.injury_type ?? null,
    scenario: raw.scenario ?? null,
    note_raw: noteRaw,
    note_zh,
    note_en,
    checkpoints,
    attachments: raw.attachments ?? [],
    rehab_plan_exercise_ids: raw.rehab_plan_exercise_ids ?? [],
    assessments: raw.assessments ?? [],
  }
}

export async function createInjury(input: NewInjuryInput): Promise<Injury> {
  const base = {
    ...syncFields(),
    body_area: '',
    body_area_zh: '',
    body_area_en: '',
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
    rehab_plan_exercise_ids: [] as string[],
    assessments: [] as InjuryAssessment[],
    ...input,
  }
  const row: Injury = {
    ...base,
    body_area: base.body_area || base.body_area_zh || base.body_area_en,
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
  patch: Partial<Pick<Injury, 'body_area_zh' | 'body_area_en' | 'body_part' | 'laterality' | 'injury_type' | 'scenario' | 'started_on' | 'status' | 'resolved_on' | 'severity' | 'note_raw' | 'note_zh' | 'note_en' | 'attachments' | 'rehab_plan_exercise_ids' | 'assessments'>>,
): Promise<void> {
  const stored = await db.injuries.get(id)
  if (!stored) return
  const cur = normalizeInjury(stored)
  const next: Injury = { ...cur, ...patch, updated_at: nowIso() }
  // keep legacy body_area in step with the bilingual pair
  next.body_area = next.body_area_zh || next.body_area_en || next.body_area

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

/** Append a symptom check-in (pain 0–10) to an injury (§6A Phase 3). */
export async function addInjuryAssessment(id: string, pain: number, note = ''): Promise<void> {
  const stored = await db.injuries.get(id)
  if (!stored) return
  const cur = normalizeInjury(stored)
  const entry: InjuryAssessment = { date: today(), pain, note: note.trim() || undefined }
  await db.injuries.put({ ...cur, assessments: [...cur.assessments, entry], updated_at: nowIso() })
}

// ── injury photos (§6A Phase 4 — local-only, never synced) ───
/** Upsert a compressed injury photo (idempotent by id). */
export async function putInjuryPhoto(id: string, injuryId: string, data: string): Promise<void> {
  const existing = await db.injury_photos.get(id)
  const row: InjuryPhoto = { id, injury_id: injuryId, data, created_at: existing?.created_at ?? nowIso() }
  await db.injury_photos.put(row)
}

/** Map photo id → data URL for the given ids (skips missing). */
export async function getInjuryPhotosByIds(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const rows = await db.injury_photos.where('id').anyOf(ids).toArray()
  return Object.fromEntries(rows.map((r) => [r.id, r.data]))
}

export async function deleteInjuryPhoto(id: string): Promise<void> {
  await db.injury_photos.delete(id)
}

// ── injury photos in Supabase Storage (private bucket, per-user folder) ───
const PHOTO_BUCKET = 'injury-photos'

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

/** Upload a compressed photo to Storage. Path is scoped to the user (RLS). */
export async function uploadInjuryPhotoToStorage(injuryId: string, photoId: string, dataUrl: string): Promise<string | null> {
  const uid = currentUserId()
  if (!uid) return null
  const path = `${uid}/${injuryId}/${photoId}.jpg`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, dataUrlToBlob(dataUrl), {
    upsert: true,
    contentType: 'image/jpeg',
  })
  return error ? null : path
}

/** Signed URL (1h) for a stored photo, or null. */
export async function getInjuryPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600)
  return error || !data ? null : data.signedUrl
}

export async function removeInjuryPhotoFromStorage(path: string): Promise<void> {
  await supabase.storage.from(PHOTO_BUCKET).remove([path])
}

/** Resolve photo refs → displayable URLs: local cache first (offline/instant),
 *  falling back to a Storage signed URL. Skips refs that resolve to nothing. */
export async function resolveInjuryPhotoUrls(refs: InjuryAttachmentRef[]): Promise<Record<string, string>> {
  const photoRefs = refs.filter((a) => a.kind === 'photo' && a.photo_id)
  const out = await getInjuryPhotosByIds(photoRefs.map((a) => a.photo_id!))
  for (const a of photoRefs) {
    if (!out[a.photo_id!] && a.storage_path) {
      const url = await getInjuryPhotoUrl(a.storage_path)
      if (url) out[a.photo_id!] = url
    }
  }
  return out
}

// ── training cycle (§4.9, §6B) ───────────────────────────────
export interface NewCycleInput {
  name: string
  active?: boolean
  days?: CycleDay[]
  display_mode?: TrainingCycle['display_mode']
}

async function deactivateAllCycles(): Promise<void> {
  const all = await db.training_cycle.toArray()
  for (const c of all) {
    if (c.active && !c.deleted) await db.training_cycle.put({ ...c, active: false, updated_at: nowIso() })
  }
}

export async function createCycle(input: NewCycleInput): Promise<TrainingCycle> {
  const row: TrainingCycle = { ...syncFields(), active: false, display_mode: 'circle', days: [], ...input }
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
  patch: Partial<Pick<TrainingCycle, 'name' | 'days' | 'display_mode'>>,
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

// The classic 4-split template (§6B): A 胸+腹 / B 背+二头 / C 腿+腹 / D 肩+三头.
// Created active; body_parts reference the default categories (biceps/triceps
// were added for this split). Titles stay empty — the UI renders the parts.
export async function createDefaultSplitCycle(): Promise<TrainingCycle> {
  const days: CycleDay[] = [
    { label: 'A', title: '', body_parts: ['chest', 'core'], regions: ['chest', 'abs'], exercise_ids: [] },
    { label: 'B', title: '', body_parts: ['back', 'biceps'], regions: ['back', 'biceps', 'forearms'], exercise_ids: [] },
    { label: 'C', title: '', body_parts: ['legs', 'core'], regions: ['glutes', 'quads', 'hamstrings', 'calves', 'adductors', 'abs'], exercise_ids: [] },
    { label: 'D', title: '', body_parts: ['shoulders', 'triceps'], regions: ['shoulders', 'triceps'], exercise_ids: [] },
  ]
  return createCycle({ name: '4-Split · 四分化', days, active: true, display_mode: 'body' })
}

// ── cycle rounds (§6B) ───────────────────────────────
export async function getCycleRounds(cycleId: string): Promise<CycleRound[]> {
  const all = await db.cycle_rounds.where('cycle_id').equals(cycleId).toArray()
  return all.filter((r) => !r.deleted).sort((a, b) => a.index - b.index)
}

/** The open (in-progress) round for a cycle, or null. */
export async function getOpenRound(cycleId: string): Promise<CycleRound | null> {
  const rounds = await getCycleRounds(cycleId)
  return rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0] ?? null
}

/**
 * Record that a cycle day was logged: open a round if none is in progress, mark
 * the label done, and auto-close the round once every day label is covered.
 * Idempotent per (round, label) — logging the same day twice won't double-count.
 */
export async function recordCycleDay(cycle: TrainingCycle, label: string, date: string): Promise<void> {
  const labels = cycle.days.map((d) => d.label)
  if (!labels.includes(label)) return
  const rounds = await getCycleRounds(cycle.id)
  let open = rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0]
  if (!open) {
    const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
    open = {
      ...syncFields(),
      cycle_id: cycle.id,
      index: maxIdx + 1,
      started_on: date,
      ended_on: null,
      completed_labels: [],
      skipped: false,
    }
    await db.cycle_rounds.add(open)
  }
  if (open.completed_labels.includes(label)) return
  const completed = [...open.completed_labels, label]
  const done = labels.every((l) => completed.includes(l))
  await db.cycle_rounds.put({ ...open, completed_labels: completed, ended_on: done ? date : null, updated_at: nowIso() })
}

/** End the open round early (skip). Returns false when nothing is open. */
export async function skipCycleRound(cycleId: string): Promise<boolean> {
  const open = await getOpenRound(cycleId)
  if (!open) return false
  await db.cycle_rounds.put({ ...open, ended_on: today(), skipped: true, updated_at: nowIso() })
  return true
}

// ── optional trackers (§4.10, §6C) ───────────────────────────
export async function logTracker(
  tracker: TrackerType,
  date: string,
  count = 1,
  category: IntimacyCategory | null = null,
  note = '',
): Promise<OptionalTracker> {
  const row: OptionalTracker = { ...syncFields(), tracker, date, count, category, note: note.trim() || null }
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

/** Edit a tracker entry (category / count / note / date). */
export async function updateTrackerEntry(
  id: string,
  patch: Partial<Pick<OptionalTracker, 'count' | 'category' | 'note' | 'date'>>,
): Promise<void> {
  const t = await db.optional_trackers.get(id)
  if (t) await db.optional_trackers.put({ ...t, ...patch, updated_at: nowIso() })
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

/** Field-only patch of an entry (does NOT touch its sets). Used by the History
 *  review flow ("确认无误" clears the flags) and the mode-2 module chooser. */
export type EntryPatch = Partial<
  Pick<WorkoutEntry, 'exercise_id' | 'note_raw' | 'note_tags' | 'is_superset' | 'needs_review' | 'needs_translation' | 'injury_modified' | 'injury_id' | 'module_part'>
>

export async function patchEntry(entryId: string, patch: EntryPatch): Promise<void> {
  const ts = nowIso()
  const e = await db.workout_entries.get(entryId)
  if (!e) return
  await db.workout_entries.put({ ...e, ...patch, updated_at: ts })
}

/** Edit an entry: patch fields, soft-delete old sets, add the new ones. */
export async function updateEntry(
  entryId: string,
  patch: EntryPatch,
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
