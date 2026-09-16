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
import { entryModule, exerciseKind } from '../log/util'

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

export type ActivityKey = 'gym' | 'bodyweight' | 'sport'
export interface ActivityMonthly {
  months: string[]                       // 'YYYY-MM', oldest → newest
  count: Record<ActivityKey, number[]>   // sessions per month (one value per month)
  volume: Record<ActivityKey, number[]>  // gym/bodyweight = working sets; sport = hours
}

/**
 * Per-activity monthly breakdown for the activity chart: how many sessions (count) and
 * how much volume (working sets for lifting; HOURS for sport, which has no sets) each
 * of gym / bodyweight / sport got, split by calendar month. Feeds a stacked-by-month
 * horizontal bar — strictly more information than the old kind pie.
 */
export function activityByMonth(
  entries: WorkoutEntry[],
  sessions: { date: string; hours: number }[],
  exById: Record<string, Exercise>,
  setCountOf: (id: string) => number,
  monthsBack = 6,
): ActivityMonthly {
  const now = new Date()
  const months: string[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const idxOf = (date: string): number => months.indexOf(date.slice(0, 7))
  const zeros = (): number[] => new Array(monthsBack).fill(0)
  const count: Record<ActivityKey, number[]> = { gym: zeros(), bodyweight: zeros(), sport: zeros() }
  const volume: Record<ActivityKey, number[]> = { gym: zeros(), bodyweight: zeros(), sport: zeros() }
  for (const e of entries) {
    const ex = exById[e.exercise_id]
    if (!ex) continue
    const i = idxOf(e.date)
    if (i < 0) continue
    const k: ActivityKey = exerciseKind(ex) === 'gym' ? 'gym' : 'bodyweight'
    count[k][i] += 1
    volume[k][i] += setCountOf(e.id)
  }
  for (const s of sessions) {
    const i = idxOf(s.date)
    if (i < 0) continue
    count.sport[i] += 1
    volume.sport[i] += s.hours
  }
  return { months, count, volume }
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

// ── daily intensity calendar (§8 signature) ──────────────────

export interface CalendarSession {
  date: string
  sport_id: string
  hours: number
  attributes?: Record<string, string>
}

/** Load per hour of sport, by the session's declared level (frisbee: toss…major).
 *  Calibrated against lifting, where one working set scores 1: two hours of club
 *  play ≈ a 12-set gym session. Sports with no level field sit in the middle. */
const SPORT_LOAD_PER_HOUR: Record<string, number> = { toss: 2, casual: 4, club: 6, major: 8 }
const SPORT_LOAD_DEFAULT = 4

/** Load at or above which a day is unconditionally level 4 — roughly a very hard
 *  day: ~24 working sets, or 3h of major-level sport. Absolute on purpose: the
 *  1–3 cut points below are relative, but the top of the scale must never drift.
 *  Calibrated on the real backups (median day ≈ 12, p90 ≈ 17–21, max 48): at 24,
 *  5–9% of trained days earn a 4, so the top shade stays a genuine outlier. */
export const MAX_DAY_LOAD = 24

/** A day's training load: one point per working set, plus each sport session's
 *  hours weighted by its level. Continuous and ADDITIVE across sessions, so two
 *  casual games outrank one, and a lift after a game still moves the number.
 *  (The old score was `min(4, trainingTier + hardestSport)`, which pinned every
 *  hard day to the same 4 — no contrast left exactly where it mattered most.) */
export function dayLoad(daySets: number, sessions: Pick<CalendarSession, 'hours' | 'attributes'>[]): number {
  const sport = sessions.reduce((sum, s) => {
    const lvl = s.attributes?.level
    const perHour = (lvl && SPORT_LOAD_PER_HOUR[lvl]) || SPORT_LOAD_DEFAULT
    return sum + (s.hours ?? 0) * perHour
  }, 0)
  return daySets + sport
}

/** Cut points for levels 1|2 and 2|3: the 33rd/67th percentile of every ORDINARY
 *  training day in history (load > 0, below MAX_DAY_LOAD). Monster days are left
 *  out of the ranking rather than clamped into it — a handful of 40-set weekends
 *  would otherwise shift the distribution and re-shade months of past history.
 *  Too little history to rank meaningfully → thirds of the absolute scale. */
function levelCuts(loads: number[]): [number, number] {
  const ordinary = loads.filter((l) => l > 0 && l < MAX_DAY_LOAD).sort((a, b) => a - b)
  if (ordinary.length < 5) return [MAX_DAY_LOAD / 3, (MAX_DAY_LOAD * 2) / 3]
  const at = (p: number): number => ordinary[Math.min(ordinary.length - 1, Math.floor(p * ordinary.length))]
  return [at(1 / 3), at(2 / 3)]
}

function levelFor(load: number, [c1, c2]: [number, number]): number {
  if (load <= 0) return 0
  if (load >= MAX_DAY_LOAD) return 4
  return load <= c1 ? 1 : load <= c2 ? 2 : 3
}

export interface DayCell {
  date: string
  /** 0–4, or null for a date that hasn't happened yet — a future square is blank,
   *  not a rest day, which the old grid had no way to say. */
  level: number | null
  load: number
  strength: { part: BodyPart; sets: number }[] // one tag per body part, heaviest first
  sports: { sportId: string; hours: number }[]
  intimacy?: number                            // total count that day (undefined = none)
}

export interface CalendarMonth {
  month: string    // 'YYYY-MM'
  leading: number  // blank cells before day 1 (Monday = 0)
  days: DayCell[]
}

/** Every 'YYYY-MM' from the earliest date through `today`, oldest → newest. */
function monthSpan(dates: string[], today: string): string[] {
  const first = dates.length ? dates.reduce((a, b) => (a < b ? a : b)).slice(0, 7) : today.slice(0, 7)
  const out: string[] = []
  const [y, m] = first.split('-').map(Number)
  for (let d = new Date(y, m - 1, 1); ; d.setMonth(d.getMonth() + 1)) {
    const key = isoOf(d).slice(0, 7)
    out.push(key)
    if (key >= today.slice(0, 7)) return out
  }
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Calendar-month grids of daily load, each day carrying the tags that earned it.
 *  Returns EVERY month from the first logged day through today (oldest → newest);
 *  month navigation is a window onto this array. Computing the whole span at once
 *  is what keeps the cut points — and therefore the shading of any given day —
 *  identical no matter which months are on screen. `months` overrides the span. */
export function intensityCalendar({
  entries, exById, setCountOf, sessions, intimacy = [], include, months, today,
}: {
  entries: WorkoutEntry[]
  exById: Record<string, Exercise>
  setCountOf: (entryId: string) => number
  sessions: CalendarSession[]
  intimacy?: OptionalTracker[]
  include?: { strength?: boolean; sport?: boolean }
  months?: string[]
  today?: string
}): CalendarMonth[] {
  const todayIso = today ?? isoOf(new Date())

  const strength: Record<string, Record<BodyPart, number>> = {}
  if (include?.strength !== false) {
    for (const e of entries) {
      const part = entryModule(e, exById[e.exercise_id])
      const sets = setCountOf(e.id)
      if (!part || !sets) continue
      const day = (strength[e.date] ??= {})
      day[part] = (day[part] ?? 0) + sets
    }
  }
  const sportByDate: Record<string, CalendarSession[]> = {}
  if (include?.sport !== false) for (const s of sessions) (sportByDate[s.date] ??= []).push(s)
  const intimByDate: Record<string, number> = {}
  for (const r of intimacy) intimByDate[r.date] = (intimByDate[r.date] ?? 0) + (r.count ?? 0)

  const loadOf = (date: string): number =>
    dayLoad(Object.values(strength[date] ?? {}).reduce((a, b) => a + b, 0), sportByDate[date] ?? [])

  const trained = new Set([...Object.keys(strength), ...Object.keys(sportByDate)])
  const cuts = levelCuts([...trained].map(loadOf))

  // A filtered-out category still defines the span — hiding sport shouldn't make
  // whole months vanish from the pager, it should just empty their squares.
  const span = months ?? monthSpan(
    [...entries.map((e) => e.date), ...sessions.map((s) => s.date)].filter((d) => d <= todayIso),
    todayIso,
  )

  return span.map((month) => {
    const [y, m] = month.split('-').map(Number)
    const days: DayCell[] = []
    for (let d = 1, total = new Date(y, m, 0).getDate(); d <= total; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`
      const load = loadOf(date)
      days.push({
        date,
        level: date > todayIso ? null : levelFor(load, cuts),
        load,
        strength: Object.entries(strength[date] ?? {})
          .map(([part, sets]) => ({ part, sets }))
          .sort((a, b) => b.sets - a.sets || a.part.localeCompare(b.part)),
        sports: (sportByDate[date] ?? []).map((s) => ({ sportId: s.sport_id, hours: s.hours })),
        intimacy: intimByDate[date] || undefined,
      })
    }
    return { month, leading: (new Date(y, m - 1, 1).getDay() + 6) % 7, days }
  })
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
