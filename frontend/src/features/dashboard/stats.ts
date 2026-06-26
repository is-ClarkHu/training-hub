// Pure analytics over the local store, shared by the Dashboard (§8) and the
// Cycle muscle-recovery panel (§6B).
import { BODY_PARTS, type BodyPart, type Exercise, type ExerciseSet, type SetType, type WorkoutEntry } from '../../supabase/types'

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
