// Pure helpers for round display (§6B). A round is one pass through the cycle's
// ordered day labels; these derive the current round number and what's left from
// the stored CycleRound rows.
import type { CycleRound, EntryCycleAssignment, TrainingCycle, WorkoutEntry } from '../../supabase/types'
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

// One entry's membership in a cycle: (round, day) it belongs to. An entry can have
// SEVERAL of these (many-to-many, §6B). Carries the entry's date + exercise so the
// round functions don't need to re-join.
export interface CycleMembership { entryId: string; exId: string; date: string; roundId: string | null; dayLabel: string }

/**
 * Flatten entries into their memberships in ONE cycle. Uses assignment rows when an
 * entry has them; falls back to the entry's legacy cycle_* columns when it has NONE
 * — so display works before the migration/backfill populates assignments, and for
 * any entry that predates them. Pass `assignments = []` (the default) and every
 * entry falls back to legacy, i.e. the exact pre-M2M behaviour.
 */
export function cycleMemberships(
  cycle: TrainingCycle,
  entries: WorkoutEntry[],
  assignments: EntryCycleAssignment[] = [],
): CycleMembership[] {
  const cycleAssigns = assignments.filter((a) => !a.deleted && a.cycle_id === cycle.id)
  const hasAssign = new Set(cycleAssigns.map((a) => a.entry_id))
  const entryById = new Map(entries.map((e) => [e.id, e]))
  const out: CycleMembership[] = []
  for (const a of cycleAssigns) {
    const e = entryById.get(a.entry_id)
    if (!e || e.deleted) continue
    out.push({ entryId: e.id, exId: e.exercise_id, date: e.date, roundId: a.cycle_round_id, dayLabel: a.cycle_day_label })
  }
  // Legacy fallback: entries with no assignment row in this cycle. Mirrors the old
  // filter — an entry counts here if its cycle_id matches (or is null, pre-cycle_id
  // data) and it carries a day label.
  for (const e of entries) {
    if (e.deleted || hasAssign.has(e.id)) continue
    if (!e.cycle_day_label) continue
    if (e.cycle_id && e.cycle_id !== cycle.id) continue
    out.push({ entryId: e.id, exId: e.exercise_id, date: e.date, roundId: e.cycle_round_id ?? null, dayLabel: e.cycle_day_label })
  }
  return out
}

/** Whether a membership belongs to `round`: by explicit round id, else by date range. */
function memberInRound(m: CycleMembership, round: CycleRound): boolean {
  return m.roundId ? m.roundId === round.id : m.date >= round.started_on && (!round.ended_on || m.date <= round.ended_on)
}

/** Day labels a round actually covers RIGHT NOW, from live memberships —
 *  self-heals when an entry is deleted, unlike the stored `completed_labels`. */
export function liveCompletedLabels(
  cycle: TrainingCycle,
  round: CycleRound,
  entries: WorkoutEntry[],
  assignments: EntryCycleAssignment[] = [],
): string[] {
  const out = new Set<string>()
  for (const m of cycleMemberships(cycle, entries, assignments)) {
    if (memberInRound(m, round)) out.add(m.dayLabel)
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
  assignments: EntryCycleAssignment[] = [],
): Record<string, RoundRegionActivity> {
  const out: Record<string, RoundRegionActivity> = {}
  if (!round) return out
  const dayRegions = new Map(cycle.days.map((d) => [d.label, d.regions ?? []]))
  for (const m of cycleMemberships(cycle, entries, assignments)) {
    if (!memberInRound(m, round)) continue
    const regions = dayRegions.get(m.dayLabel)
    if (!regions || regions.length === 0) continue
    const n = setCount(m.entryId)
    if (n <= 0) continue
    for (const region of regions) {
      const a = (out[region] ??= { sets: 0, items: [] })
      a.sets += n
      a.items.push({ exId: m.exId, sets: n, day: m.dayLabel, date: m.date })
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
  assignments: EntryCycleAssignment[] = [],
): RoundMetrics {
  const labels = new Set(cycle.days.map((d) => d.label))
  const inRound = cycleMemberships(cycle, entries, assignments).filter(
    (m) => labels.has(m.dayLabel) && memberInRound(m, round),
  )
  // Derive completed days from LIVE memberships (not the stored completed_labels) so
  // deleting a day's last entry rolls the count back.
  const doneLabels = new Set(inRound.map((m) => m.dayLabel))
  // Volume/sessions dedupe by entry — an entry counts once in the round even if it
  // has several day memberships here (its sets aren't done twice).
  const roundEntries = new Map(inRound.map((m) => [m.entryId, m.date]))
  const sums = chainSums(roundRegionActivity(cycle, round, entries, setCount, assignments))
  return {
    completedDays: doneLabels.size,
    totalDays: cycle.days.length,
    sets: [...roundEntries.keys()].reduce((s, id) => s + setCount(id), 0),
    sessions: new Set(roundEntries.values()).size,
    balance: balancePct(sums, plannedChains(cycle)),
    chains: sums,
  }
}

// Pass `entries` to derive completion from live data (self-heals on delete);
// omit it to fall back to the round's stored completed_labels.
export function currentRound(cycle: TrainingCycle, rounds: CycleRound[], entries?: WorkoutEntry[], assignments: EntryCycleAssignment[] = []): RoundView {
  const labels = cycle.days.map((d) => d.label)
  const open = rounds.filter((r) => r.ended_on == null).sort((a, b) => b.index - a.index)[0] ?? null
  const maxIdx = rounds.reduce((m, r) => Math.max(m, r.index), 0)
  const completed = open
    ? entries
      ? liveCompletedLabels(cycle, open, entries, assignments).filter((l) => labels.includes(l))
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
