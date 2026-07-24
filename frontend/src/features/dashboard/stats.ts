// Pure analytics over the local store, shared by the Dashboard (§8) and the
// Cycle muscle-recovery panel (§6B).
import {
  type BodyPart,
  type Exercise,
  type ExerciseSet,
  type OptionalTracker,
  type SetType,
  type WorkoutEntry,
} from '../../supabase/types'
import { categoryKeys, isMuscleCategory } from '../../categories'
import { entryModule } from '../log/util'

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
    for (const bp of ex.body_parts) {
      const cur = last[bp]
      if (!cur || e.date > cur) last[bp] = e.date
    }
  }
  return categoryKeys().filter(isMuscleCategory).map((bp) => {
    const d = last[bp] ?? null
    return { bodyPart: bp, lastDate: d, daysAgo: d ? daysSince(d) : null }
  })
}

/** Entry counts across body parts — each entry counts ONCE, toward its assigned
 *  module (module_part) or the exercise's primary category, so a multi-category
 *  movement (e.g. deadlift = back+legs) doesn't inflate two slices. */
export function bodyPartCounts(entries: WorkoutEntry[], exById: Record<string, Exercise>): number[] {
  const keys = categoryKeys()
  const counts = keys.map(() => 0)
  for (const e of entries) {
    const ex = exById[e.exercise_id]
    if (!ex) continue
    const part = entryModule(e, ex)
    const i = part ? keys.indexOf(part) : -1
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
type DaySession = { attributes?: Record<string, string>; hours?: number }

// Sport intensity from its level (frisbee: toss/casual/club/major); sports without a
// level field fall back to a rough duration estimate.
const LEVEL_INTENSITY: Record<string, number> = { toss: 1, casual: 2, club: 3, major: 4 }
function sportIntensity(s: DaySession): number {
  const lvl = s.attributes?.level
  if (lvl && lvl in LEVEL_INTENSITY) return LEVEL_INTENSITY[lvl]
  const h = s.hours ?? 0
  return h >= 3 ? 4 : h >= 1.5 ? 2 : 1
}

/** Daily intensity 0–4, ADDITIVE and capped at 4: training from set count
 *  (<6 → 1 · 6–16 → 2 · >16 → 3) PLUS the day's hardest sport (toss→1 … major→4).
 *  So a casual frisbee (2) + a light bodyweight session (<6 sets → 1) = 3. Intimacy
 *  is NOT training and is marked separately (HeatCell.intimacy). */
export function dayIntensity(daySets: number, sessions: DaySession[]): number {
  if (daySets === 0 && sessions.length === 0) return 0
  const training = daySets === 0 ? 0 : daySets < 6 ? 1 : daySets <= 16 ? 2 : 3
  const sport = sessions.length ? Math.max(...sessions.map(sportIntensity)) : 0
  return Math.min(4, training + sport)
}

export interface HeatCell { date: string; level: number; intimacy?: number } // total intimacy count that day (undefined = none)

/** Weekday(row) × week(col) grid of daily intensity, most recent `weeks` weeks. */
export function intensityHeatmap(
  entries: WorkoutEntry[],
  sessions: (DaySession & { date: string })[],
  setCountOf: (entryId: string) => number,
  intimacy: OptionalTracker[] = [],
  weeks = 18,
): HeatCell[][] {
  const eByDate: Record<string, WorkoutEntry[]> = {}
  for (const e of entries) (eByDate[e.date] ??= []).push(e)
  const sByDate: Record<string, DaySession[]> = {}
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
      const intimCount = (iByDate[iso] ?? []).reduce((s, r) => s + (r.count ?? 0), 0)
      const daySets = (eByDate[iso] ?? []).reduce((sum, e) => sum + setCountOf(e.id), 0)
      col.push({ date: iso, level: dayIntensity(daySets, sByDate[iso] ?? []), intimacy: intimCount || undefined })
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
    const reps = (setsByEntry[e.id] ?? []).filter((s) => s.set_type !== 'warmup').reduce((sum, s) => sum + (s.reps ?? 0), 0)
    byDate[e.date] = (byDate[e.date] ?? 0) + reps
  }
  const labels = Object.keys(byDate).sort()
  return { labels, data: labels.map((d) => byDate[d]) }
}

/** Total reps across all reps_only sets (bodyweight volume KPI, e.g. push-ups). */
export function totalBodyweightReps(sets: ExerciseSet[], entries: WorkoutEntry[], exById: Record<string, Exercise>): number {
  const repsOnly = new Set(entries.filter((e) => exById[e.exercise_id]?.measure_type === 'reps_only').map((e) => e.id))
  return sets.filter((s) => repsOnly.has(s.entry_id) && s.set_type !== 'warmup').reduce((sum, s) => sum + (s.reps ?? 0), 0)
}
