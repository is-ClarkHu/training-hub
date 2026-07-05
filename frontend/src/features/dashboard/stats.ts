// Pure analytics over the local store, shared by the Dashboard (§8) and the
// Cycle muscle-recovery panel (§6B).
import {
  BODY_PARTS,
  type BodyPart,
  type Exercise,
  type ExerciseSet,
  type OptionalTracker,
  type SetType,
  type WorkoutEntry,
} from '../../supabase/types'
import { intimacyCategory } from '../intimacy'

export function daysSince(date: string): number {
  const start = new Date(`${date}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((now.getTime() - start.getTime()) / 86_400_000))
}

function mondayOf(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export interface Recovery {
  bodyPart: BodyPart
  lastDate: string | null
  daysAgo: number | null
}

/** Days since each body part was last trained (§6B). */
export function muscleRecovery(entries: WorkoutEntry[], exById: Record<string, Exercise>): Recovery[] {
  const last: Partial<Record<BodyPart, string>> = {}
  for (const e of entries) {
    const ex = exById[e.exercise_id]
    if (!ex) continue
    const cur = last[ex.body_part]
    if (!cur || e.date > cur) last[ex.body_part] = e.date
  }
  return BODY_PARTS.map((bp) => {
    const d = last[bp] ?? null
    return { bodyPart: bp, lastDate: d, daysAgo: d ? daysSince(d) : null }
  })
}

/** Entry counts across the 7 body parts (BODY_PARTS order). */
export function bodyPartCounts(entries: WorkoutEntry[], exById: Record<string, Exercise>): number[] {
  const counts = BODY_PARTS.map(() => 0)
  for (const e of entries) {
    const ex = exById[e.exercise_id]
    if (!ex) continue
    const i = BODY_PARTS.indexOf(ex.body_part)
    if (i >= 0) counts[i] += 1
  }
  return counts
}

const SET_TYPES: SetType[] = ['normal', 'warmup', 'superset', 'dropset']
export function setTypeCounts(sets: ExerciseSet[]): { labels: SetType[]; data: number[] } {
  return { labels: SET_TYPES, data: SET_TYPES.map((t) => sets.filter((s) => s.set_type === t).length) }
}

/** Entries per week for the last `weeks` weeks (oldest → newest). */
export function weeklyEntryVolume(entries: WorkoutEntry[], weeks = 8): { labels: string[]; data: number[] } {
  const thisMon = mondayOf(new Date())
  const data = new Array<number>(weeks).fill(0)
  const labels: string[] = []
  for (let i = 0; i < weeks; i++) {
    const d = new Date(thisMon)
    d.setDate(thisMon.getDate() - (weeks - 1 - i) * 7)
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`)
  }
  for (const e of entries) {
    const sm = mondayOf(new Date(`${e.date}T00:00:00`))
    const idx = weeks - 1 - Math.round((thisMon.getTime() - sm.getTime()) / (7 * 86_400_000))
    if (idx >= 0 && idx < weeks) data[idx] += 1
  }
  return { labels, data }
}

/** Estimated 1RM, Epley formula (§8). */
export function e1RM(weight: number, reps: number): number {
  return Math.round(weight * (1 + reps / 30))
}

// ── intensity heatmap (§8 signature) ─────────────────────────
const RECOVERY_TAGS = new Set(['rehab', 'activation', 'skipped_stretch', 'warmup'])

/** Daily intensity 0–4: 0 rest · 1 recovery · 2 normal · 3 high · 4 competition/double.
 *  Sport intensity now comes from duration (hours), not a tier. */
export function dayIntensity(
  entries: WorkoutEntry[],
  sessions: { hours: number }[],
  intimacy: OptionalTracker[] = [],
): number {
  if (entries.length === 0 && sessions.length === 0 && intimacy.length === 0) return 0
  let lvl = 0
  if (intimacy.length > 0) {
    const active = intimacy.some((r) => intimacyCategory(r) === 'partner_active')
    lvl = Math.max(lvl, active ? 2 : 1)
  }
  if (entries.length > 0) lvl = 2
  if (sessions.length > 0) {
    const maxH = Math.max(...sessions.map((s) => s.hours ?? 0))
    lvl = Math.max(lvl, maxH >= 3 ? 4 : maxH >= 2 ? 3 : 2)
  }
  if ((entries.length > 0 || sessions.length > 0) && intimacy.length > 0) lvl = Math.max(lvl, 3)
  if (entries.length > 0 && sessions.length > 0) lvl = 4 // double session
  if (entries.length >= 6) lvl = Math.max(lvl, 3)
  if (entries.length > 0 && sessions.length === 0) {
    const allRecovery = entries.every((e) => (e.note_tags ?? []).some((t) => RECOVERY_TAGS.has(t)))
    if (allRecovery) lvl = 1
  }
  return lvl
}

export interface HeatCell { date: string; level: number }

/** Weekday(row) × week(col) grid of daily intensity, most recent `weeks` weeks. */
export function intensityHeatmap(
  entries: WorkoutEntry[],
  sessions: { date: string; hours: number }[],
  intimacy: OptionalTracker[] = [],
  weeks = 18,
): HeatCell[][] {
  const eByDate: Record<string, WorkoutEntry[]> = {}
  for (const e of entries) (eByDate[e.date] ??= []).push(e)
  const sByDate: Record<string, { hours: number }[]> = {}
  for (const s of sessions) (sByDate[s.date] ??= []).push(s)
  const iByDate: Record<string, OptionalTracker[]> = {}
  for (const r of intimacy) (iByDate[r.date] ??= []).push(r)

  const thisMon = mondayOf(new Date())
  const cols: HeatCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const monday = new Date(thisMon)
    monday.setDate(thisMon.getDate() - (weeks - 1 - w) * 7)
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(monday)
      day.setDate(monday.getDate() + d)
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      col.push({ date: iso, level: dayIntensity(eByDate[iso] ?? [], sByDate[iso] ?? [], iByDate[iso] ?? []) })
    }
    cols.push(col)
  }
  return cols
}

/** Bodyweight-volume trend: total reps_only reps per session date (oldest → newest). */
export function bodyweightVolume(
  entries: WorkoutEntry[],
  setsByEntry: Record<string, ExerciseSet[]>,
  exById: Record<string, Exercise>,
): { labels: string[]; data: number[] } {
  const byDate: Record<string, number> = {}
  for (const e of entries) {
    const ex = exById[e.exercise_id]
    if (!ex || ex.measure_type !== 'reps_only') continue
    const reps = (setsByEntry[e.id] ?? []).reduce((sum, s) => sum + (s.reps ?? 0), 0)
    byDate[e.date] = (byDate[e.date] ?? 0) + reps
  }
  const labels = Object.keys(byDate).sort()
  return { labels, data: labels.map((d) => byDate[d]) }
}

/** Total reps across all reps_only sets (bodyweight volume KPI, e.g. push-ups). */
export function totalBodyweightReps(sets: ExerciseSet[], entries: WorkoutEntry[], exById: Record<string, Exercise>): number {
  const repsOnly = new Set(entries.filter((e) => exById[e.exercise_id]?.measure_type === 'reps_only').map((e) => e.id))
  return sets.filter((s) => repsOnly.has(s.entry_id)).reduce((sum, s) => sum + (s.reps ?? 0), 0)
}
