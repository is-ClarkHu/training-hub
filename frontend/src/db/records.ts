// Write helpers for the local-first store. Every new row gets sync fields stamped
// (client UUID, user_id from the session, updated_at, deleted=false) so the
// SyncEngine can later upsert it to Supabase unchanged (SPEC §3).
import { db } from './db'
import { currentStage } from '../features/injuries/util'
import { nextRoundIndex, roundForDate, roundMembers, targetRoundFor } from '../features/cycle/rounds'
import { newId, nowIso, today } from './helpers'
import { currentUserId, supabase } from '../supabase/client'
import { FRISBEE_FIELDS } from '../supabase/types'
import type {
  Basics,
  BodyMeasurement,
  BodyPart,
  Chatroom,
  ChatroomPerms,
  ChatroomMemory,
  ChatroomSummary,
  CycleDay,
  Exercise,
  FoodLog,
  MedicalBackground,
  Note,
  PublicFile,
  Supplement,
  TrainingEnv,
  ExerciseSet,
  Injury,
  InjuryAssessment,
  InjuryAttachmentRef,
  InjuryCheckpoint,
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
  EntryCycleAssignment,
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
  distance?: number | null
  calories?: number | null
  bpm?: number | null
}

export interface NewEntryInput {
  date: string
  exercise_id: string
  is_superset?: boolean
  note_raw?: string
  note_tags?: string[]
  cycle_day_label?: string | null
  cycle_id?: string | null
  cycle_round_id?: string | null
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
    cycle_round_id: null,
    injury_modified: null,
    injury_id: null,
    needs_review: false,
    needs_translation: false,
    sort_order: Date.now(), // performed order within the day (log order); reorderable
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
    distance: null,
    calories: null,
    bpm: null,
    ...s,
  }))
  await db.transaction('rw', db.workout_entries, db.sets, db.entry_cycle_assignments, async () => {
    await db.workout_entries.add(entry)
    await db.sets.bulkAdd(sets)
    // A cycle-tagged log gets its primary assignment row immediately, so the M2M
    // read layer + the assign dialog see it without relying on the legacy fallback.
    await syncPrimaryAssignment(entry)
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
  calories?: number | null
  bpm?: number | null
}

export async function createSportSession(input: NewSportSessionInput): Promise<SportSession> {
  const row: SportSession = {
    ...syncFields(),
    attributes: {},
    injury: false,
    note_raw: '',
    note_tags: [],
    calories: null,
    bpm: null,
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
  patch: Partial<Pick<SportSession, 'date' | 'hours' | 'attributes' | 'injury' | 'note_raw' | 'calories' | 'bpm'>>,
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
  checkpoints?: InjuryCheckpoint[]
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
  const legacyStatus = LEGACY_STATUS[raw.status as string] ?? raw.status
  const noteRaw = raw.note_raw ?? ''
  const note_zh = raw.note_zh ?? (HAS_CJK.test(noteRaw) ? noteRaw : '')
  const note_en = raw.note_en ?? (HAS_CJK.test(noteRaw) ? '' : noteRaw)
  const areaRaw = raw.body_area ?? ''
  const body_area_zh = raw.body_area_zh ?? (HAS_CJK.test(areaRaw) ? areaRaw : '')
  const body_area_en = raw.body_area_en ?? (HAS_CJK.test(areaRaw) ? '' : areaRaw)
  const checkpoints =
    raw.checkpoints && raw.checkpoints.length > 0
      ? raw.checkpoints
      : [{ status: legacyStatus, date: raw.started_on }]
  // Current status is DERIVED from the checkpoints: the furthest-along stage in
  // the locked recovery flow (§6A), not the latest-dated one. Backfilling an
  // earlier stage never re-opens the injury. resolved_on tracks the recovered
  // checkpoint's date when recovered.
  const current = currentStage(checkpoints)
  const status = current?.status ?? legacyStatus
  const resolved_on = status === 'recovered' ? current?.date ?? raw.resolved_on ?? null : null
  return {
    ...raw,
    status,
    resolved_on,
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
  // Honour any stage history the editor supplied (backfilled middle stages);
  // otherwise seed a single checkpoint at onset. Kept sorted by date.
  const checkpoints =
    base.checkpoints && base.checkpoints.length > 0
      ? [...base.checkpoints].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      : [{ status: base.status, date: base.started_on }]
  // Current status is derived from the latest-dated checkpoint (see currentStage).
  const current = currentStage(checkpoints)
  const status = current?.status ?? base.status
  const row: Injury = {
    ...base,
    status,
    body_area: base.body_area || base.body_area_zh || base.body_area_en,
    checkpoints,
    resolved_on: status === 'recovered' ? current?.date ?? null : null,
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
  patch: Partial<Pick<Injury, 'body_area_zh' | 'body_area_en' | 'body_part' | 'laterality' | 'injury_type' | 'scenario' | 'started_on' | 'status' | 'resolved_on' | 'severity' | 'note_raw' | 'note_zh' | 'note_en' | 'attachments' | 'rehab_plan_exercise_ids' | 'assessments' | 'checkpoints'>>,
): Promise<void> {
  const stored = await db.injuries.get(id)
  if (!stored) return
  const cur = normalizeInjury(stored)
  const next: Injury = { ...cur, ...patch, updated_at: nowIso() }
  // keep legacy body_area in step with the bilingual pair
  next.body_area = next.body_area_zh || next.body_area_en || next.body_area

  // A quick status change (e.g. the inline status switch on the injury card, which
  // sends `status` but no `checkpoints`) is recorded as a checkpoint dated today —
  // so it becomes the latest-dated stage and thus the new current status. The full
  // editor owns the stage history and sends an explicit `checkpoints` array (so it
  // can backfill earlier-dated middle stages WITHOUT re-opening the injury), so the
  // auto-append is skipped in that case.
  if (patch.status && patch.status !== cur.status && patch.checkpoints === undefined) {
    const last = next.checkpoints[next.checkpoints.length - 1]
    if (!last || last.status !== patch.status) {
      next.checkpoints = [...next.checkpoints, { status: patch.status, date: today() }]
    }
  }

  // Derive current status + resolved_on from the checkpoints (latest date wins).
  // The `status` field is a cached projection of the stage history, never the
  // source of truth. Checkpoints stay sorted by date.
  next.checkpoints = [...next.checkpoints].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const current = currentStage(next.checkpoints)
  next.status = current?.status ?? next.status
  next.resolved_on = next.status === 'recovered' ? current?.date ?? null : null
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

/** All live entry↔cycle assignments (M2M membership, §6B). Source of truth for
 *  cycle membership. The "primary" row for an entry reuses the entry's id. */
export async function getEntryCycleAssignments(): Promise<EntryCycleAssignment[]> {
  return (await db.entry_cycle_assignments.toArray()).filter((a) => !a.deleted)
}

async function getCycleById(id: string): Promise<TrainingCycle | null> {
  const c = await db.training_cycle.get(id)
  return c && !c.deleted ? c : null
}

/**
 * Bring a cycle's stored round scalars (started_on / ended_on / completed_labels) back
 * in line with LIVE memberships — the same view the rings and body model compute from
 * (via `roundMembers`) — so the stored values can't drift when a member entry is later
 * edited, deleted, or reassigned to another round. Run after any mutation that can
 * change a round's membership.
 *
 * - completed_labels = the day labels the round's live members currently cover.
 * - started_on / ended_on = earliest / latest member workout date. Only the LATEST
 *   round may sit open (ended_on = null) while incomplete; a past round is always
 *   pinned to its last real workout so it can't greedily reclaim later dates.
 * - `skipped` rounds keep their explicit closed state untouched.
 * - GHOST rounds are dropped: a trailing round with no live members left is a
 *   leftover from a mis-tagged log (or one whose entries were all moved elsewhere).
 *   Left in place it becomes "the current round" everywhere — an empty body model,
 *   empty rings — while the real, still-unfinished round sits closed behind it.
 *   Deleting it promotes that round back to open (it is then the latest, and
 *   incomplete). Explicitly skipped rounds are kept (deliberate history), and a
 *   cycle always keeps at least one round.
 *
 * Idempotent and change-guarded — a round whose derived values already match is not
 * rewritten, so this won't churn updated_at or generate needless sync traffic.
 */
export async function reconcileCycleRounds(cycleOrId: TrainingCycle | string): Promise<void> {
  const cycle = typeof cycleOrId === 'string' ? await getCycleById(cycleOrId) : cycleOrId
  if (!cycle) return
  let rounds = await getCycleRounds(cycle.id)   // index ascending
  if (rounds.length === 0) return
  const entries = (await db.workout_entries.toArray()).filter((e) => !e.deleted)
  const assignments = (await db.entry_cycle_assignments.toArray()).filter((a) => !a.deleted)
  const labels = cycle.days.map((d) => d.label)
  const ts = nowIso()

  const membersOf = new Map<string, ReturnType<typeof roundMembers>>()
  for (const r of rounds) membersOf.set(r.id, roundMembers(cycle, r, entries, assignments))

  const empty = (r: CycleRound) => (membersOf.get(r.id)?.length ?? 0) === 0 && !r.skipped
  const ghosts: CycleRound[] = []
  if (rounds.some(empty)) {
    const kept = rounds.filter((r) => !empty(r))
    // Keep the newest round if that would wipe the cycle's history entirely, so a
    // freshly-created (still empty) cycle doesn't lose its R1.
    const survivors = kept.length > 0 ? kept : rounds.slice(-1)
    for (const r of rounds) if (!survivors.includes(r)) ghosts.push({ ...r, deleted: true, updated_at: ts })
    // Renumber what's left contiguously: with the ghosts gone, R1, R2, R4 would be
    // a lie about how many passes you actually made.
    rounds = survivors.map((r, i) => (r.index === i + 1 ? r : { ...r, index: i + 1, updated_at: ts }))
    if (ghosts.length > 0) await db.cycle_rounds.bulkPut(ghosts)
  }

  const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
  const updates: CycleRound[] = []
  for (const round of rounds) {
    const members = membersOf.get(round.id) ?? []
    const completed = labels.filter((l) => members.some((m) => m.dayLabel === l))
    const dates = members.map((m) => m.date).filter(Boolean).sort()
    const allDone = completed.length === labels.length && labels.length > 0
    const started_on = dates[0] ?? round.started_on
    const ended_on = round.skipped
      ? round.ended_on
      : round.index === maxIdx
        ? (allDone ? (dates[dates.length - 1] ?? started_on) : null)
        : (dates[dates.length - 1] ?? round.ended_on ?? started_on)
    const stored = await db.cycle_rounds.get(round.id)
    const changed =
      round.index !== stored?.index ||
      started_on !== round.started_on ||
      ended_on !== round.ended_on ||
      completed.length !== round.completed_labels.length ||
      completed.some((l, i) => l !== round.completed_labels[i])
    if (changed) updates.push({ ...round, started_on, ended_on, completed_labels: completed, updated_at: ts })
  }
  if (updates.length > 0) await db.cycle_rounds.bulkPut(updates)
}

/** Reconcile every cycle a set of entries touches (via cycle_id column or M2M rows).
 *  Cheap at this app's scale (a handful of cycles) and covers cross-cycle edits. */
async function reconcileRoundsForEntries(entryIds: string[]): Promise<void> {
  const cids = new Set<string>()
  for (const id of entryIds) {
    const e = await db.workout_entries.get(id)
    if (e?.cycle_id) cids.add(e.cycle_id)
    const assigns = await db.entry_cycle_assignments.where('entry_id').equals(id).toArray()
    for (const a of assigns) if (!a.deleted && a.cycle_id) cids.add(a.cycle_id)
  }
  for (const cid of cids) await reconcileCycleRounds(cid)
}

/** Reconcile all cycles — for edits (date moves, label/cycle changes) where an entry
 *  may leave one cycle's rounds and its old cycle still needs re-deriving. */
async function reconcileAllCycles(): Promise<void> {
  for (const c of await getCycles()) await reconcileCycleRounds(c)
}

/**
 * Keep an entry's PRIMARY assignment row (id = entry id) in step with its legacy
 * cycle_* columns. Called by every write that changes an entry's cycle target, so
 * the M2M read layer (which prefers assignments over the legacy columns) never sees
 * a stale primary. Additional memberships (other cycles) live in their own rows and
 * are managed separately. Runs inside the caller's transaction when given `tx`.
 */
async function syncPrimaryAssignment(entry: WorkoutEntry): Promise<void> {
  const table = db.entry_cycle_assignments
  const ts = nowIso()
  if (entry.cycle_id && entry.cycle_day_label) {
    const existing = await table.get(entry.id)
    await table.put({
      id: entry.id,
      user_id: entry.user_id || currentUserId() || existing?.user_id || '',
      updated_at: ts,
      deleted: false,
      entry_id: entry.id,
      cycle_id: entry.cycle_id,
      cycle_round_id: entry.cycle_round_id ?? null,
      cycle_day_label: entry.cycle_day_label,
    })
  } else {
    const existing = await table.get(entry.id)
    if (existing && !existing.deleted) await table.put({ ...existing, deleted: true, updated_at: ts })
  }
}

/** The open (in-progress) round for a cycle, or null. */
export async function getOpenRound(cycleId: string): Promise<CycleRound | null> {
  const rounds = await getCycleRounds(cycleId)
  return rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0] ?? null
}

/**
 * The round a workout on `date` belongs to, creating one only when there is nothing
 * to put it in. Resolution (shared with the UI via the pure `roundForDate`): the
 * round whose span covers the date — so a back-dated log lands in the round it was
 * actually performed in — else the open round, else a brand-new round.
 *
 * Callers log the entry with `round.id` in `cycle_round_id` instead of leaving round
 * membership to be re-guessed from date ranges later, and `isNew` lets the UI say
 * "this starts R5" BEFORE the user commits to it.
 */
export async function ensureCycleRound(
  cycle: TrainingCycle,
  date: string,
): Promise<{ round: CycleRound; isNew: boolean }> {
  let rounds = await getCycleRounds(cycle.id)
  const covering = roundForDate(rounds, date)
  if (covering) return { round: covering, isNew: false }

  // Nothing covers the date. Before conjuring a round, re-derive the cycle so the
  // decision is made on live data (a round that only LOOKS finished because its last
  // entry was deleted must not push the workout into a new one), then hand the
  // workout to the latest unfinished round — reopening it if something closed it.
  await reconcileCycleRounds(cycle)
  rounds = await getCycleRounds(cycle.id)
  const unfinished = targetRoundFor(cycle, rounds, date)
  if (unfinished) {
    if (unfinished.ended_on) {
      const reopened = { ...unfinished, ended_on: null, updated_at: nowIso() }
      await db.cycle_rounds.put(reopened)
      return { round: reopened, isNew: false }
    }
    return { round: unfinished, isNew: false }
  }

  const round: CycleRound = {
    ...syncFields(),
    cycle_id: cycle.id,
    index: nextRoundIndex(rounds),
    started_on: date,
    ended_on: null,
    completed_labels: [],
    skipped: false,
  }
  await db.cycle_rounds.add(round)
  return { round, isNew: true }
}

/**
 * Record that a cycle day was logged: resolve (or open) the round for that date, mark
 * the label done, and auto-close the round once every day label is covered.
 * Idempotent per (round, label) — logging the same day twice won't double-count.
 */
export async function recordCycleDay(cycle: TrainingCycle, label: string, date: string): Promise<CycleRound | null> {
  const labels = cycle.days.map((d) => d.label)
  if (!labels.includes(label)) return null
  const { round } = await ensureCycleRound(cycle, date)
  if (!round.completed_labels.includes(label)) {
    const completed = [...round.completed_labels, label]
    const done = labels.every((l) => completed.includes(l))
    // Days can be logged out of chronological order (back-dated entries), so clamp the
    // round span: start = earliest date seen, end (when done) = the later of start/date.
    // Prevents a reversed "2026-07-09 → 2026-06-15" range. A round that was already
    // closed (back-dated log) keeps its close date.
    const started = date < round.started_on ? date : round.started_on
    const ended = done ? (date > started ? date : started) : round.ended_on ?? null
    await db.cycle_rounds.put({ ...round, started_on: started, completed_labels: completed, ended_on: ended, updated_at: nowIso() })
  }
  // Re-derive from live memberships so the stored span/labels match what the UI shows
  // (and self-correct if this log's round attribution differs from the date-range view).
  await reconcileCycleRounds(cycle)
  return round
}

/** End the open round early (skip). Returns false when nothing is open. */
export async function skipCycleRound(cycleId: string): Promise<boolean> {
  const open = await getOpenRound(cycleId)
  if (!open) return false
  await db.cycle_rounds.put({ ...open, ended_on: today(), skipped: true, updated_at: nowIso() })
  await reconcileCycleRounds(cycleId)
  return true
}

/** Re-open a closed/skipped round (undo an accidental skip or early close). */
export async function reopenCycleRound(id: string): Promise<void> {
  const r = await db.cycle_rounds.get(id)
  if (!r) return
  await db.cycle_rounds.put({ ...r, skipped: false, ended_on: null, updated_at: nowIso() })
  await reconcileCycleRounds(r.cycle_id)
}

/** Soft-delete a round entirely (e.g. a bogus round from bad dates). */
export async function deleteCycleRound(id: string): Promise<void> {
  const r = await db.cycle_rounds.get(id)
  if (!r) return
  await db.cycle_rounds.put({ ...r, deleted: true, updated_at: nowIso() })
  // Deleting the latest round promotes the previous one to "latest" — re-derive so its
  // open/closed state and any orphaned members settle correctly.
  await reconcileCycleRounds(r.cycle_id)
}

/** Re-derive every round of a cycle from live memberships. Kept as a named export for
 *  History's post-edit refresh; delegates to the shared reconcile. */
export async function refreshCycleRoundsForAssignments(cycle: TrainingCycle): Promise<void> {
  await reconcileCycleRounds(cycle)
}

export interface CycleEntryAssignment {
  entryId: string
  modulePart?: BodyPart | null
}

export async function assignEntriesToCycleRound(
  cycle: TrainingCycle,
  input: {
    date: string
    dayLabel: string
    roundId: string | null
    entries: CycleEntryAssignment[]
  },
): Promise<CycleRound | null> {
  if (input.entries.length === 0 || !cycle.days.some((d) => d.label === input.dayLabel)) return null
  let round = input.roundId ? await db.cycle_rounds.get(input.roundId) : null
  await db.transaction('rw', db.workout_entries, db.cycle_rounds, async () => {
    if (!round || round.deleted || round.cycle_id !== cycle.id) {
      const rounds = await getCycleRounds(cycle.id)
      const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
      round = {
        ...syncFields(),
        cycle_id: cycle.id,
        index: maxIdx + 1,
        started_on: input.date,
        ended_on: null,
        completed_labels: [],
        skipped: false,
      }
      await db.cycle_rounds.add(round)
    }
    const ts = nowIso()
    for (const a of input.entries) {
      const e = await db.workout_entries.get(a.entryId)
      if (!e || e.deleted) continue
      await db.workout_entries.put({
        ...e,
        cycle_id: cycle.id,
        cycle_round_id: round.id,
        cycle_day_label: input.dayLabel,
        module_part: a.modulePart === undefined ? e.module_part : a.modulePart,
        updated_at: ts,
      })
    }
  })
  if (round) await reconcileCycleRounds(cycle)
  return round ?? null
}

export interface CycleTargetAssignment {
  entryId: string
  roundId: string | null   // null = assign to a freshly-created round
  dayLabel: string         // '' = leave this entry unassigned (skipped)
  modulePart?: BodyPart | null
}

/**
 * Assign a day's entries to PER-ENTRY (round, day-label) targets in one save, so a
 * single date can be split across rounds/days — e.g. two leg lifts → R2's leg day,
 * three chest lifts → R3's chest day. (assignEntriesToCycleRound only does one
 * target for the whole batch, which forced the whole day onto one round/day.)
 * Entries with an empty dayLabel are left untouched. All null-round entries share
 * ONE new round.
 */
export async function assignEntriesToCycleTargets(
  cycle: TrainingCycle,
  date: string,
  assignments: CycleTargetAssignment[],
): Promise<void> {
  const validLabels = new Set(cycle.days.map((d) => d.label))
  const valid = assignments.filter((a) => validLabels.has(a.dayLabel))
  if (valid.length === 0) return
  const touched = new Set<string>()
  await db.transaction('rw', db.workout_entries, db.cycle_rounds, db.entry_cycle_assignments, async () => {
    let newRoundId: string | null = null
    if (valid.some((a) => !a.roundId)) {
      const rounds = await getCycleRounds(cycle.id)
      const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
      const round: CycleRound = {
        ...syncFields(),
        cycle_id: cycle.id,
        index: maxIdx + 1,
        started_on: date,
        ended_on: null,
        completed_labels: [],
        skipped: false,
      }
      await db.cycle_rounds.add(round)
      newRoundId = round.id
    }
    const ts = nowIso()
    for (const a of valid) {
      const e = await db.workout_entries.get(a.entryId)
      if (!e || e.deleted) continue
      const rid = a.roundId ?? newRoundId
      if (!rid) continue
      const r = await db.cycle_rounds.get(rid)
      if (!r || r.deleted || r.cycle_id !== cycle.id) continue
      touched.add(rid)
      const updated = {
        ...e,
        cycle_id: cycle.id,
        cycle_round_id: rid,
        cycle_day_label: a.dayLabel,
        module_part: a.modulePart === undefined ? e.module_part : a.modulePart,
        updated_at: ts,
      }
      await db.workout_entries.put(updated)
      await syncPrimaryAssignment(updated)
    }
  })
  if (touched.size > 0) await reconcileCycleRounds(cycle)
}

// One (cycle, round, day) target for an entry. roundId null = a new round in that
// cycle. dayLabel '' filters the target out.
export interface EntryTarget { cycleId: string; roundId: string | null; dayLabel: string }

/**
 * Replace each entry's FULL set of cycle memberships (M2M, §6B) — this is what lets
 * one entry belong to several splits/rounds at once, and different entries of a day
 * go to different splits. `byEntry` maps entry id → its desired targets across ANY
 * cycles. `moduleByEntry` optionally sets each entry's History module override.
 *
 * The primary assignment row (id = entry id) mirrors the FIRST target and keeps the
 * entry's legacy cycle_* columns in step (fallback/rollback); extra targets get
 * fresh rows. Null-round targets share ONE freshly-created round per cycle for this
 * save. An entry with no targets is fully un-assigned.
 */
export async function applyEntryCycleAssignments(
  date: string,
  cycles: TrainingCycle[],
  byEntry: Record<string, EntryTarget[]>,
  moduleByEntry: Record<string, BodyPart | null> = {},
): Promise<void> {
  const cycleById = new Map(cycles.map((c) => [c.id, c]))
  const touched = new Set<string>()
  await db.transaction('rw', db.workout_entries, db.cycle_rounds, db.entry_cycle_assignments, async () => {
    const ts = nowIso()
    const newRoundByCycle = new Map<string, string>()
    const ensureNewRound = async (cycleId: string): Promise<string | null> => {
      if (newRoundByCycle.has(cycleId)) return newRoundByCycle.get(cycleId)!
      const rounds = await getCycleRounds(cycleId)
      const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
      const round: CycleRound = { ...syncFields(), cycle_id: cycleId, index: maxIdx + 1, started_on: date, ended_on: null, completed_labels: [], skipped: false }
      await db.cycle_rounds.add(round)
      newRoundByCycle.set(cycleId, round.id)
      return round.id
    }

    for (const [entryId, rawTargets] of Object.entries(byEntry)) {
      const e = await db.workout_entries.get(entryId)
      if (!e || e.deleted) continue

      // Resolve valid targets (cycle exists, day label belongs to it, round resolved).
      const resolved: Array<{ cycleId: string; roundId: string; dayLabel: string }> = []
      for (const t of rawTargets) {
        const cyc = cycleById.get(t.cycleId)
        if (!cyc || !t.dayLabel || !cyc.days.some((d) => d.label === t.dayLabel)) continue
        const rid = t.roundId ?? (await ensureNewRound(t.cycleId))
        if (!rid) continue
        resolved.push({ cycleId: t.cycleId, roundId: rid, dayLabel: t.dayLabel })
        touched.add(rid)
      }

      // Soft-delete this entry's existing assignment rows; we re-create what we keep.
      const existing = await db.entry_cycle_assignments.where('entry_id').equals(entryId).toArray()
      for (const a of existing) {
        if (!a.deleted) await db.entry_cycle_assignments.put({ ...a, deleted: true, updated_at: ts })
        if (a.cycle_round_id) touched.add(a.cycle_round_id)
      }

      const modulePart = entryId in moduleByEntry ? moduleByEntry[entryId] : e.module_part ?? null
      if (resolved.length === 0) {
        await db.workout_entries.put({ ...e, cycle_id: null, cycle_round_id: null, cycle_day_label: null, module_part: modulePart, updated_at: ts })
        continue
      }
      const primary = resolved[0]
      // Primary row reuses the entry id; entry legacy columns mirror it.
      await db.entry_cycle_assignments.put({
        id: entryId, user_id: e.user_id || currentUserId() || '', updated_at: ts, deleted: false,
        entry_id: entryId, cycle_id: primary.cycleId, cycle_round_id: primary.roundId, cycle_day_label: primary.dayLabel,
      })
      await db.workout_entries.put({ ...e, cycle_id: primary.cycleId, cycle_round_id: primary.roundId, cycle_day_label: primary.dayLabel, module_part: modulePart, updated_at: ts })
      for (const t of resolved.slice(1)) {
        await db.entry_cycle_assignments.put({
          id: newId(), user_id: e.user_id || currentUserId() || '', updated_at: ts, deleted: false,
          entry_id: entryId, cycle_id: t.cycleId, cycle_round_id: t.roundId, cycle_day_label: t.dayLabel,
        })
      }
    }
  })
  // Re-derive every cycle that gained or lost a member from live memberships.
  const touchedCycles = new Set<string>()
  for (const rid of touched) {
    const r = await db.cycle_rounds.get(rid)
    if (r) touchedCycles.add(r.cycle_id)
  }
  for (const cid of touchedCycles) {
    const cyc = cycleById.get(cid)
    if (cyc) await reconcileCycleRounds(cyc)
  }
}

/** Rebuild a cycle's rounds from dated entry labels. This is used after History
 *  relabels older days, where there may be no open round to append to. */
export async function rebuildCycleRounds(cycle: TrainingCycle): Promise<void> {
  const labels = cycle.days.map((d) => d.label)
  const labelSet = new Set(labels)
  const ts = nowIso()
  const entries = (await db.workout_entries.toArray())
    .filter((e) => !e.deleted && e.cycle_day_label && labelSet.has(e.cycle_day_label) && (!e.cycle_id || e.cycle_id === cycle.id))

  const byDate = new Map<string, Set<string>>()
  for (const e of entries) {
    const set = byDate.get(e.date) ?? new Set<string>()
    set.add(e.cycle_day_label as string)
    byDate.set(e.date, set)
  }

  const nextRounds: CycleRound[] = []
  let current: { started_on: string; last_on: string; completed: string[] } | null = null
  for (const date of [...byDate.keys()].sort()) {
    const dateLabels = labels.filter((l) => byDate.get(date)?.has(l))
    for (const label of dateLabels) {
      if (!current) current = { started_on: date, last_on: date, completed: [] }
      if (current.completed.includes(label)) {
        nextRounds.push({
          ...syncFields(),
          cycle_id: cycle.id,
          index: nextRounds.length + 1,
          started_on: current.started_on,
          ended_on: current.last_on,
          completed_labels: current.completed,
          skipped: true,
        })
        current = { started_on: date, last_on: date, completed: [] }
      }
      current.completed.push(label)
      current.last_on = date
      if (labels.every((l) => current!.completed.includes(l))) {
        nextRounds.push({
          ...syncFields(),
          cycle_id: cycle.id,
          index: nextRounds.length + 1,
          started_on: current.started_on,
          ended_on: date,
          completed_labels: current.completed,
          skipped: false,
        })
        current = null
      }
    }
  }
  if (current) {
    nextRounds.push({
      ...syncFields(),
      cycle_id: cycle.id,
      index: nextRounds.length + 1,
      started_on: current.started_on,
      ended_on: null,
      completed_labels: current.completed,
      skipped: false,
    })
  }

  await db.transaction('rw', db.cycle_rounds, async () => {
    const existing = await db.cycle_rounds.where('cycle_id').equals(cycle.id).toArray()
    await db.cycle_rounds.bulkPut(existing.filter((r) => !r.deleted).map((r) => ({ ...r, deleted: true, updated_at: ts })))
    if (nextRounds.length > 0) await db.cycle_rounds.bulkAdd(nextRounds)
  })
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

// ── chatrooms (AI multi-chatroom; PLAN-ai-chatrooms) ─────────
/** Create a room, appended to the end of the list. `perms` starts empty (nothing
 *  granted — the AI reads no personal data until the user opts a category in). */
export async function createChatroom(name: string, topic = ''): Promise<Chatroom> {
  const rooms = await db.chatrooms.toArray()
  const maxSort = rooms.filter((r) => !r.deleted).reduce((m, r) => Math.max(m, r.sort_order), -1)
  const row: Chatroom = {
    ...syncFields(),
    name: name.trim(),
    topic: topic.trim(),
    sort_order: maxSort + 1,
    perms: {},
    provider: null,
    model: null,
    created_at: nowIso(),
  }
  await db.chatrooms.add(row)
  return row
}

/** Rooms, creating a default "General" room the first time the user opens chat. */
export async function ensureDefaultChatroom(): Promise<Chatroom[]> {
  const rooms = await getChatrooms()
  if (rooms.length > 0) return rooms
  const room = await createChatroom('General', 'Open chat')
  return [room]
}

/** Live rooms, ordered by sort_order then creation time. */
export async function getChatrooms(): Promise<Chatroom[]> {
  const all = await db.chatrooms.toArray()
  return all
    .filter((r) => !r.deleted)
    .sort((a, b) => a.sort_order - b.sort_order || (a.created_at < b.created_at ? -1 : 1))
}

/** Rename a room (and optionally its topic blurb). */
export async function renameChatroom(id: string, name: string, topic?: string): Promise<void> {
  const r = await db.chatrooms.get(id)
  if (!r) return
  const next: Chatroom = { ...r, name: name.trim(), updated_at: nowIso() }
  if (topic !== undefined) next.topic = topic.trim()
  await db.chatrooms.put(next)
}

/** Soft-delete a room and cascade all its chat artefacts (req §7.4): messages,
 *  the rolling summary, memory units, and both directions of its cross-room memory
 *  grants. Everything is tombstoned so the delete syncs across devices. Raw
 *  training/injury/profile records are NEVER touched. */
export async function deleteChatroom(id: string): Promise<void> {
  const ts = nowIso()
  await db.transaction(
    'rw',
    db.chatrooms,
    db.chat_messages,
    db.chatroom_summaries,
    db.chatroom_memories,
    db.chatroom_memory_access,
    async () => {
      const room = await db.chatrooms.get(id)
      if (room) await db.chatrooms.put({ ...room, deleted: true, updated_at: ts })

      const tombstone = <T extends { deleted: boolean; updated_at: string }>(rows: T[]) =>
        rows.map((r) => ({ ...r, deleted: true, updated_at: ts }))

      const msgs = await db.chat_messages.where('chatroom_id').equals(id).toArray()
      await db.chat_messages.bulkPut(tombstone(msgs))

      const summaries = await db.chatroom_summaries.where('chatroom_id').equals(id).toArray()
      await db.chatroom_summaries.bulkPut(tombstone(summaries))

      const memories = await db.chatroom_memories.where('chatroom_id').equals(id).toArray()
      await db.chatroom_memories.bulkPut(tombstone(memories))

      // both directions: grants where this room reads, and where it is the source
      const asReader = await db.chatroom_memory_access.where('reader_room_id').equals(id).toArray()
      const asSource = await db.chatroom_memory_access.where('source_room_id').equals(id).toArray()
      const links = new Map(([...asReader, ...asSource]).map((l) => [l.id, l]))
      await db.chatroom_memory_access.bulkPut(tombstone([...links.values()]))
    },
  )
}

/** Set a room's data-read permission matrix. The backend re-reads this column at
 *  answer time (never trusts the client), so this write is what actually gates
 *  what the AI may read for this room. */
export async function updateChatroomPerms(id: string, perms: ChatroomPerms): Promise<void> {
  const r = await db.chatrooms.get(id)
  if (r) await db.chatrooms.put({ ...r, perms, updated_at: nowIso() })
}

// ── chatroom memory units + rolling summary (P4) ─────────────
export async function getChatroomMemories(chatroomId: string): Promise<ChatroomMemory[]> {
  const all = await db.chatroom_memories.where('chatroom_id').equals(chatroomId).toArray()
  return all
    .filter((m) => !m.deleted)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.created_at < b.created_at ? 1 : -1))
}

export async function createChatroomMemory(
  chatroomId: string,
  content: string,
  shareable = false,
): Promise<ChatroomMemory> {
  const row: ChatroomMemory = {
    ...syncFields(),
    chatroom_id: chatroomId,
    content: content.trim(),
    shareable,
    pinned: false,
    created_at: nowIso(),
  }
  await db.chatroom_memories.add(row)
  return row
}

export async function updateChatroomMemory(
  id: string,
  patch: Partial<Pick<ChatroomMemory, 'content' | 'shareable' | 'pinned'>>,
): Promise<void> {
  const m = await db.chatroom_memories.get(id)
  if (m) await db.chatroom_memories.put({ ...m, ...patch, updated_at: nowIso() })
}

export async function deleteChatroomMemory(id: string): Promise<void> {
  const m = await db.chatroom_memories.get(id)
  if (m) await db.chatroom_memories.put({ ...m, deleted: true, updated_at: nowIso() })
}

/** The room's rolling summary (read-only in the UI; the backend maintains it). */
export async function getChatroomSummary(chatroomId: string): Promise<ChatroomSummary | null> {
  const all = await db.chatroom_summaries.where('chatroom_id').equals(chatroomId).toArray()
  return all.find((s) => !s.deleted) ?? null
}

// ── cross-room memory access grants (P4) ─────────────────────
/** Source-room ids whose shareable memories the reader room may read. */
export async function getMemoryAccess(readerRoomId: string): Promise<string[]> {
  const all = await db.chatroom_memory_access.where('reader_room_id').equals(readerRoomId).toArray()
  return all.filter((a) => !a.deleted).map((a) => a.source_room_id)
}

/** Grant or revoke reader→source shared-memory access (revoke = tombstone). */
export async function setMemoryAccess(readerRoomId: string, sourceRoomId: string, on: boolean): Promise<void> {
  const all = await db.chatroom_memory_access.where('reader_room_id').equals(readerRoomId).toArray()
  const existing = all.find((a) => a.source_room_id === sourceRoomId)
  if (on) {
    if (existing) await db.chatroom_memory_access.put({ ...existing, deleted: false, updated_at: nowIso() })
    else
      await db.chatroom_memory_access.add({
        ...syncFields(),
        reader_room_id: readerRoomId,
        source_room_id: sourceRoomId,
      })
  } else if (existing && !existing.deleted) {
    await db.chatroom_memory_access.put({ ...existing, deleted: true, updated_at: nowIso() })
  }
}

/** Pin a room's AI provider/model (null,null = use the global assistant default). */
export async function updateChatroomAi(id: string, provider: string | null, model: string | null): Promise<void> {
  const r = await db.chatrooms.get(id)
  if (r) await db.chatrooms.put({ ...r, provider, model, updated_at: nowIso() })
}

/** Persist a new room order (array of ids in display order → sort_order 0..n). */
export async function reorderChatrooms(orderedIds: string[]): Promise<void> {
  const ts = nowIso()
  for (let i = 0; i < orderedIds.length; i++) {
    const r = await db.chatrooms.get(orderedIds[i])
    if (r && r.sort_order !== i) await db.chatrooms.put({ ...r, sort_order: i, updated_at: ts })
  }
}

// ── AI pre-fillable data modules (P6) ────────────────────────
// Single-row modules: one row per user, upserted.
export async function getBasics(): Promise<Basics | null> {
  return (await db.basics.toArray()).find((r) => !r.deleted) ?? null
}
export async function saveBasics(patch: Partial<Basics>): Promise<Basics> {
  const existing = await getBasics()
  const base: Basics = existing ?? {
    ...syncFields(),
    age: null, sex: null, biological_sex: null, height_cm: null,
    training_years: null, training_level: null, work_type: null,
    sleep_hours: null, resting_hr: null, max_hr: null,
  }
  const row: Basics = { ...base, ...patch, updated_at: nowIso() }
  await db.basics.put(row)
  return row
}

export async function getTrainingEnv(): Promise<TrainingEnv | null> {
  return (await db.training_env.toArray()).find((r) => !r.deleted) ?? null
}
export async function saveTrainingEnv(patch: Partial<TrainingEnv>): Promise<TrainingEnv> {
  const existing = await getTrainingEnv()
  const base: TrainingEnv = existing ?? { ...syncFields(), gym: null, equipment: null, home_equipment: null }
  const row: TrainingEnv = { ...base, ...patch, updated_at: nowIso() }
  await db.training_env.put(row)
  return row
}

export async function getMedicalBackground(): Promise<MedicalBackground | null> {
  return (await db.medical_background.toArray()).find((r) => !r.deleted) ?? null
}
export async function saveMedicalBackground(patch: Partial<MedicalBackground>): Promise<MedicalBackground> {
  const existing = await getMedicalBackground()
  const base: MedicalBackground = existing ?? {
    ...syncFields(),
    conditions: null, surgeries: null, restrictions: null,
    allergies: null, family_history: null, recent_labs: null,
  }
  const row: MedicalBackground = { ...base, ...patch, updated_at: nowIso() }
  await db.medical_background.put(row)
  return row
}

// List modules: many rows per user.
export async function getBodyMeasurements(): Promise<BodyMeasurement[]> {
  const all = await db.body_measurements.toArray()
  return all.filter((m) => !m.deleted).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
export async function addBodyMeasurement(m: Omit<BodyMeasurement, keyof ReturnType<typeof syncFields>>): Promise<BodyMeasurement> {
  const row: BodyMeasurement = { ...syncFields(), ...m }
  await db.body_measurements.add(row)
  return row
}
export async function updateBodyMeasurement(id: string, patch: Partial<Omit<BodyMeasurement, keyof ReturnType<typeof syncFields>>>): Promise<void> {
  const m = await db.body_measurements.get(id)
  if (m) await db.body_measurements.put({ ...m, ...patch, updated_at: nowIso() })
}
export async function deleteBodyMeasurement(id: string): Promise<void> {
  const m = await db.body_measurements.get(id)
  if (m) await db.body_measurements.put({ ...m, deleted: true, updated_at: nowIso() })
}

export async function getNotes(): Promise<Note[]> {
  const all = await db.notes.toArray()
  return all.filter((n) => !n.deleted).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}
export async function createNote(content: string, tag: Note['tag'] = null): Promise<Note> {
  const row: Note = { ...syncFields(), content: content.trim(), tag, created_at: nowIso() }
  await db.notes.add(row)
  return row
}
export async function updateNote(id: string, patch: Partial<Pick<Note, 'content' | 'tag'>>): Promise<void> {
  const n = await db.notes.get(id)
  if (n) await db.notes.put({ ...n, ...patch, updated_at: nowIso() })
}
export async function deleteNote(id: string): Promise<void> {
  const n = await db.notes.get(id)
  if (n) await db.notes.put({ ...n, deleted: true, updated_at: nowIso() })
}

export async function getSupplements(): Promise<Supplement[]> {
  const all = await db.supplements.toArray()
  return all.filter((s) => !s.deleted).sort((a, b) => Number(b.still_using) - Number(a.still_using))
}
export async function createSupplement(s: Pick<Supplement, 'name' | 'brand' | 'dose' | 'timing' | 'frequency'>): Promise<Supplement> {
  const row: Supplement = { ...syncFields(), still_using: true, ...s }
  await db.supplements.add(row)
  return row
}
export async function updateSupplement(id: string, patch: Partial<Omit<Supplement, keyof ReturnType<typeof syncFields>>>): Promise<void> {
  const s = await db.supplements.get(id)
  if (s) await db.supplements.put({ ...s, ...patch, updated_at: nowIso() })
}
export async function deleteSupplement(id: string): Promise<void> {
  const s = await db.supplements.get(id)
  if (s) await db.supplements.put({ ...s, deleted: true, updated_at: nowIso() })
}

// ── food log (P6c) ───────────────────────────────────────────
const FOOD_BUCKET = 'food-photos'
const FILE_BUCKET = 'public-files'

export async function getFoodLog(): Promise<FoodLog[]> {
  const all = await db.food_log.toArray()
  return all.filter((f) => !f.deleted).sort((a, b) => (a.eaten_at < b.eaten_at ? 1 : -1))
}
export async function createFoodLog(
  description: string,
  eatenAt: string,
  photoDataUrl?: string,
  aiDescription?: string | null,
): Promise<FoodLog> {
  const base = syncFields()
  let photo_path: string | null = null
  if (photoDataUrl && currentUserId()) {
    const path = `${currentUserId()}/${base.id}.jpg`
    const { error } = await supabase.storage.from(FOOD_BUCKET).upload(path, dataUrlToBlob(photoDataUrl), {
      upsert: true,
      contentType: 'image/jpeg',
    })
    if (!error) photo_path = path
  }
  const row: FoodLog = {
    ...base,
    description: description.trim(),
    ai_description: aiDescription?.trim() || null,
    photo_path,
    eaten_at: eatenAt,
  }
  await db.food_log.add(row)
  return row
}
export async function updateFoodLog(
  id: string,
  patch: Partial<Pick<FoodLog, 'description' | 'ai_description' | 'eaten_at'>>,
): Promise<void> {
  const f = await db.food_log.get(id)
  if (f) await db.food_log.put({ ...f, ...patch, updated_at: nowIso() })
}
export async function getFoodPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FOOD_BUCKET).createSignedUrl(path, 3600)
  return error || !data ? null : data.signedUrl
}
export async function deleteFoodLog(id: string): Promise<void> {
  const f = await db.food_log.get(id)
  if (f) {
    if (f.photo_path) await supabase.storage.from(FOOD_BUCKET).remove([f.photo_path])
    await db.food_log.put({ ...f, deleted: true, updated_at: nowIso() })
  }
}

// ── public files (P5) ────────────────────────────────────────
export async function getPublicFiles(): Promise<PublicFile[]> {
  const all = await db.public_files.toArray()
  return all.filter((f) => !f.deleted).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}
/** Upload a file: text is extracted into `content` (for the assistant); the raw
 *  file is also stored in the private bucket. */
export async function createPublicFile(file: File): Promise<PublicFile> {
  const base = syncFields()
  let storage_path: string | null = null
  let content: string | null = null
  if (currentUserId()) {
    const path = `${currentUserId()}/${base.id}-${file.name}`
    const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, { upsert: true })
    if (!error) storage_path = path
  }
  if (file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name)) {
    content = (await file.text()).slice(0, 20000)
  }
  const row: PublicFile = { ...base, name: file.name, storage_path, content, summary: null, created_at: nowIso() }
  await db.public_files.add(row)
  return row
}
/** Store an LLM summary for a file (generated after upload). */
export async function setPublicFileSummary(id: string, summary: string): Promise<void> {
  const f = await db.public_files.get(id)
  if (f) await db.public_files.put({ ...f, summary: summary.trim() || null, updated_at: nowIso() })
}
export async function deletePublicFile(id: string): Promise<void> {
  const f = await db.public_files.get(id)
  if (f) {
    if (f.storage_path) await supabase.storage.from(FILE_BUCKET).remove([f.storage_path])
    await db.public_files.put({ ...f, deleted: true, updated_at: nowIso() })
  }
}

/** File ids the given room may read. */
export async function getFileAccess(chatroomId: string): Promise<string[]> {
  const all = await db.chatroom_file_access.where('chatroom_id').equals(chatroomId).toArray()
  return all.filter((a) => !a.deleted).map((a) => a.file_id)
}
export async function setFileAccess(chatroomId: string, fileId: string, on: boolean): Promise<void> {
  const all = await db.chatroom_file_access.where('chatroom_id').equals(chatroomId).toArray()
  const existing = all.find((a) => a.file_id === fileId)
  if (on) {
    if (existing) await db.chatroom_file_access.put({ ...existing, deleted: false, updated_at: nowIso() })
    else await db.chatroom_file_access.add({ ...syncFields(), chatroom_id: chatroomId, file_id: fileId })
  } else if (existing && !existing.deleted) {
    await db.chatroom_file_access.put({ ...existing, deleted: true, updated_at: nowIso() })
  }
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

/** Per-day logged history for one exercise (newest handling is up to the caller) —
 *  used by the Log dialog's PR + last-session line. Skips days with no live sets. */
export async function getExerciseHistory(exerciseId: string): Promise<{ date: string; sets: ExerciseSet[] }[]> {
  const entries = (await db.workout_entries.where('exercise_id').equals(exerciseId).toArray()).filter((e) => !e.deleted)
  if (entries.length === 0) return []
  const setsMap = await getSetsByEntryIds(entries.map((e) => e.id))
  return entries
    .map((e) => ({ date: e.date, sets: setsMap[e.id] ?? [] }))
    .filter((d) => d.sets.length > 0)
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
  // The removed entry may have been a round's last cover for a day label — re-derive so
  // completed_labels and the span roll back.
  await reconcileRoundsForEntries([entryId])
}

/** EntryPatch keys that can change which round an entry belongs to. */
function patchTouchesCycle(patch: EntryPatch): boolean {
  return 'date' in patch || 'cycle_id' in patch || 'cycle_round_id' in patch || 'cycle_day_label' in patch
}

/** Field-only patch of an entry (does NOT touch its sets). Used by the History
 *  review flow ("确认无误" clears the flags) and the mode-2 module chooser. */
export type EntryPatch = Partial<
  Pick<WorkoutEntry, 'date' | 'exercise_id' | 'note_raw' | 'note_tags' | 'is_superset' | 'needs_review' | 'needs_translation' | 'injury_modified' | 'injury_id' | 'cycle_id' | 'cycle_round_id' | 'cycle_day_label' | 'module_part' | 'superset_group'>
>

export async function patchEntry(entryId: string, patch: EntryPatch): Promise<void> {
  const ts = nowIso()
  const e = await db.workout_entries.get(entryId)
  if (!e) return
  await db.workout_entries.put({ ...e, ...patch, updated_at: ts })
  // A date/label/round change can move the entry between rounds (or in/out of a cycle),
  // so re-derive all cycles — the old one loses it, the new one gains it.
  if (patchTouchesCycle(patch)) await reconcileAllCycles()
}

/** Move every workout entry logged on `fromDate` to `toDate` (fix a mis-dated day).
 *  Returns how many entries moved. Sport sessions/trackers are untouched. */
export async function moveDayEntries(fromDate: string, toDate: string): Promise<number> {
  if (fromDate === toDate) return 0
  const ts = nowIso()
  const rows = (await db.workout_entries.where('date').equals(fromDate).toArray()).filter((e) => !e.deleted)
  await db.workout_entries.bulkPut(rows.map((e) => ({ ...e, date: toDate, updated_at: ts })))
  await reconcileRoundsForEntries(rows.map((e) => e.id))
  return rows.length
}

/** Set (or clear, with null) the cycle split-day label for every workout entry on
 *  `date` — fixes a mis-labeled or un-labeled training day. Returns rows changed. */
export async function setDayCycleLabel(date: string, label: string | null, cycleId: string | null = null): Promise<number> {
  const ts = nowIso()
  const rows = (await db.workout_entries.where('date').equals(date).toArray()).filter((e) => !e.deleted)
  const updated = rows.map((e) => ({ ...e, cycle_day_label: label, cycle_id: label ? cycleId : null, updated_at: ts }))
  await db.transaction('rw', db.workout_entries, db.entry_cycle_assignments, async () => {
    await db.workout_entries.bulkPut(updated)
    for (const e of updated) await syncPrimaryAssignment(e)
  })
  // Labels/cycle just changed for a whole day — re-derive all cycles (a cleared label
  // pulls entries out of their old cycle's rounds).
  await reconcileAllCycles()
  return rows.length
}

/** Order key for sorting entries within a day (performed order). Falls back to the
 *  updated_at timestamp for legacy rows that predate sort_order. */
export function entrySortKey(e: WorkoutEntry): number {
  if (e.sort_order != null) return e.sort_order
  const t = Date.parse(e.updated_at)
  return Number.isNaN(t) ? 0 : t
}

/** Reorder a set of entries (e.g. one History module) into `orderedIds`. They keep
 *  their existing sort slots (so other entries stay put), just permuted among
 *  themselves — the first id gets the earliest slot. */
export async function reorderEntries(orderedIds: string[]): Promise<void> {
  const ts = nowIso()
  await db.transaction('rw', db.workout_entries, async () => {
    const rows = await Promise.all(orderedIds.map((id) => db.workout_entries.get(id)))
    const slots = rows.filter((r): r is WorkoutEntry => !!r).map(entrySortKey).sort((a, b) => a - b)
    let i = 0
    for (const r of rows) {
      if (!r) continue
      await db.workout_entries.put({ ...r, sort_order: slots[i], updated_at: ts })
      i++
    }
  })
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
      distance: null,
      calories: null,
      bpm: null,
      ...s,
    }))
    await db.sets.bulkAdd(fresh)
  })
  // Sets changed don't move an entry, but a date/label/round edit does — re-derive then.
  if (patchTouchesCycle(patch)) await reconcileAllCycles()
}
