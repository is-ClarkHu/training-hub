// Pure helpers for round display (§6B). A round is one pass through the cycle's
// ordered day labels; these derive the current round number and what's left from
// the stored CycleRound rows.
import type { CycleRound, TrainingCycle, WorkoutEntry } from '../../supabase/types'

export interface RoundView {
  index: number             // current round number (the open one, or the next to open)
  labels: string[]          // all day labels, in cycle order
  completed: string[]       // labels done in the open round
  remaining: string[]       // labels not yet done this round
  open: boolean             // a round is in progress
  nextLabel: string | null  // the next day to train
}

/** The open (in-progress) round for a cycle, or null. */
export function openRound(rounds: CycleRound[]): CycleRound | null {
  return rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0] ?? null
}

export interface RoundRegionActivity {
  sets: number
  items: Array<{ exId: string; sets: number; day: string; date: string | null }>
}

/**
 * Sets logged during a cycle's open round, routed through each day's region
 * bindings (day.regions). `setCount(entryId)` returns that entry's working-set
 * count. Shared by the Cycle body view and the Dashboard round rings.
 */
export function roundRegionActivity(
  cycle: TrainingCycle,
  round: CycleRound | null,
  entries: WorkoutEntry[],
  setCount: (entryId: string) => number,
): Record<string, RoundRegionActivity> {
  const out: Record<string, RoundRegionActivity> = {}
  if (!round) return out
  const dayRegions = new Map(cycle.days.map((d) => [d.label, d.regions ?? []]))
  for (const e of entries) {
    if (e.date < round.started_on || (round.ended_on && e.date > round.ended_on) || !e.cycle_day_label) continue
    const regions = dayRegions.get(e.cycle_day_label)
    if (!regions || regions.length === 0) continue
    const n = setCount(e.id)
    if (n <= 0) continue
    for (const region of regions) {
      const a = (out[region] ??= { sets: 0, items: [] })
      a.sets += n
      a.items.push({ exId: e.exercise_id, sets: n, day: e.cycle_day_label, date: e.date })
    }
  }
  return out
}

export interface RoundMetrics {
  completedDays: number
  totalDays: number
  sets: number
  sessions: number   // distinct training dates in the round
}

/** Split-agnostic round metrics — meaningful for any split (or rehab). */
export function roundMetrics(
  cycle: TrainingCycle,
  round: CycleRound,
  entries: WorkoutEntry[],
  setCount: (entryId: string) => number,
): RoundMetrics {
  const labels = new Set(cycle.days.map((d) => d.label))
  const inRound = entries.filter(
    (e) => e.date >= round.started_on && (!round.ended_on || e.date <= round.ended_on) && e.cycle_day_label && labels.has(e.cycle_day_label),
  )
  return {
    completedDays: round.completed_labels.filter((l) => labels.has(l)).length,
    totalDays: cycle.days.length,
    sets: inRound.reduce((s, e) => s + setCount(e.id), 0),
    sessions: new Set(inRound.map((e) => e.date)).size,
  }
}

export function currentRound(cycle: TrainingCycle, rounds: CycleRound[]): RoundView {
  const labels = cycle.days.map((d) => d.label)
  const open = rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0] ?? null
  const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
  const completed = open ? open.completed_labels.filter((l) => labels.includes(l)) : []
  const remaining = labels.filter((l) => !completed.includes(l))
  return {
    index: open ? open.index : maxIdx + 1,
    labels,
    completed,
    remaining,
    open: !!open,
    nextLabel: remaining[0] ?? labels[0] ?? null,
  }
}
