// Pure helpers for round display (§6B). A round is one pass through the cycle's
// ordered day labels; these derive the current round number and what's left from
// the stored CycleRound rows.
import type { CycleRound, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import { MUSCLE_CHAINS, type ChainId } from './anatomy'

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

/** Day labels a round actually covers RIGHT NOW, from live (non-deleted) entries —
 *  self-heals when an entry is deleted, unlike the stored `completed_labels`. */
export function liveCompletedLabels(cycle: TrainingCycle, round: CycleRound, entries: WorkoutEntry[]): string[] {
  const out = new Set<string>()
  for (const e of entries) {
    if (e.cycle_id && e.cycle_id !== cycle.id) continue
    if (!e.cycle_day_label) continue
    const inRound = e.cycle_round_id ? e.cycle_round_id === round.id : e.date >= round.started_on && (!round.ended_on || e.date <= round.ended_on)
    if (!inRound) continue
    out.add(e.cycle_day_label)
  }
  return cycle.days.map((d) => d.label).filter((l) => out.has(l)) // in day order
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
    if (e.cycle_id && e.cycle_id !== cycle.id) continue
    if (!e.cycle_day_label) continue
    const inRound = e.cycle_round_id ? e.cycle_round_id === round.id : e.date >= round.started_on && (!round.ended_on || e.date <= round.ended_on)
    if (!inRound) continue
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

/** Sets per push/pull/legs chain. A region feeding two chains counts in both —
 *  same convention the body model uses, so the two views agree. */
export function chainSums(activity: Record<string, RoundRegionActivity>): Record<ChainId, number> {
  const out = { push: 0, pull: 0, legs: 0 }
  for (const chain of MUSCLE_CHAINS) {
    for (const region of chain.regions) out[chain.id] += activity[region]?.sets ?? 0
  }
  return out
}

/** Sets in one chain that count it as fully covered for a round. Tunable. */
export const CHAIN_TARGET = 12

/**
 * Chains this cycle actually intends to train, from its days' region bindings.
 * A push/pull-only split shouldn't be marked down forever for never training
 * legs — but a split that HAS a legs day and skips it should be.
 */
export function plannedChains(cycle: TrainingCycle): ChainId[] {
  const regions = new Set<string>()
  for (const d of cycle.days) for (const r of d.regions ?? []) regions.add(r)
  return MUSCLE_CHAINS.filter((c) => c.regions.some((r) => regions.has(r))).map((c) => c.id)
}

/**
 * Chain coverage across the round, 0–100: each planned chain contributes its own
 * progress toward CHAIN_TARGET, capped at 1, averaged.
 *
 * NOT min/max evenness (the first attempt): that read 0 whenever any one chain
 * was untouched, i.e. for most of a round's life and permanently for anyone who
 * skips a day — a ring that sits at 0 then jumps to full teaches nothing. This
 * version accumulates as days land, and the cap means hammering push can never
 * paper over a skipped legs day: skip one chain of three and it stops at 67%.
 */
export function balancePct(sums: Record<ChainId, number>, planned: ChainId[]): number {
  const chains = planned.length > 0 ? planned : MUSCLE_CHAINS.map((c) => c.id)
  const covered = chains.reduce((s, id) => s + Math.min(1, sums[id] / CHAIN_TARGET), 0)
  return Math.round((covered / chains.length) * 100)
}

export interface RoundMetrics {
  completedDays: number
  totalDays: number
  sets: number
  sessions: number   // distinct training dates in the round
  balance: number    // 0–100, chain coverage across the planned push/pull/legs
  chains: Record<ChainId, number>
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
    (e) => {
      if (e.cycle_id && e.cycle_id !== cycle.id) return false
      if (!e.cycle_day_label || !labels.has(e.cycle_day_label)) return false
      return e.cycle_round_id ? e.cycle_round_id === round.id : e.date >= round.started_on && (!round.ended_on || e.date <= round.ended_on)
    },
  )
  // Derive completed days from LIVE entries (not the stored completed_labels) so
  // deleting a day's last entry rolls the count back. A label counts as done only
  // while some entry still carries it.
  const doneLabels = new Set(inRound.map((e) => e.cycle_day_label as string))
  const sums = chainSums(roundRegionActivity(cycle, round, entries, setCount))
  return {
    completedDays: doneLabels.size,
    totalDays: cycle.days.length,
    sets: inRound.reduce((s, e) => s + setCount(e.id), 0),
    sessions: new Set(inRound.map((e) => e.date)).size,
    balance: balancePct(sums, plannedChains(cycle)),
    chains: sums,
  }
}

// Pass `entries` to derive completion from live data (self-heals on delete);
// omit it to fall back to the round's stored completed_labels.
export function currentRound(cycle: TrainingCycle, rounds: CycleRound[], entries?: WorkoutEntry[]): RoundView {
  const labels = cycle.days.map((d) => d.label)
  const open = rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0] ?? null
  const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
  const completed = open
    ? entries
      ? liveCompletedLabels(cycle, open, entries).filter((l) => labels.includes(l))
      : open.completed_labels.filter((l) => labels.includes(l))
    : []
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
