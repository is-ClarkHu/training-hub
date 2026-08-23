// Round resolution (§6B). These guard the "silent new round" bug: logging a lift
// under a day the round had already covered closed that round, and the next lift of
// the same session opened a fresh one — which then became the "current" round
// everywhere (empty body model, empty rings) even after the entries were moved back.
import { describe, it, expect } from 'vitest'
import { nextRoundIndex, openRound, roundForDate } from './rounds'
import { dayMatchScore, suggestCycleDay } from './day'
import type { CycleDay, CycleRound, Exercise, TrainingCycle } from '../../supabase/types'

const round = (index: number, started: string, ended: string | null, extra: Partial<CycleRound> = {}): CycleRound => ({
  id: `r${index}`, user_id: 'u', updated_at: '', deleted: false,
  cycle_id: 'c', index, started_on: started, ended_on: ended, completed_labels: [], skipped: false,
  ...extra,
})

const day = (label: string, parts: string[], regions: string[] = []): CycleDay =>
  ({ label, title: '', body_parts: parts, regions, exercise_ids: [] } as unknown as CycleDay)

const cycle = (days: CycleDay[]): TrainingCycle =>
  ({ id: 'c', user_id: 'u', updated_at: '', deleted: false, name: '4-split', days, active: true } as unknown as TrainingCycle)

const ex = (parts: string[]): Exercise =>
  ({ id: 'e', name_zh: '', name_en: '', body_parts: parts, measure_type: 'weight_reps' } as unknown as Exercise)

const SPLIT = cycle([
  day('A', ['chest', 'core'], ['chest', 'abs']),
  day('B', ['back', 'biceps'], ['back', 'biceps']),
  day('C', ['legs'], ['quads', 'hamstrings']),
  day('D', ['shoulders', 'triceps'], ['shoulders', 'triceps']),
])

describe('roundForDate — which round a workout belongs to', () => {
  const closed = round(4, '2026-08-01', '2026-08-10')
  const open = round(5, '2026-08-12', null)

  it('uses the round whose span covers the date (back-dated logs)', () => {
    expect(roundForDate([closed, open], '2026-08-05')?.index).toBe(4)
  })
  it('uses the open round for a date past every closed span', () => {
    expect(roundForDate([closed, open], '2026-08-20')?.index).toBe(5)
  })
  it('prefers the latest round when spans overlap', () => {
    const overlapping = round(5, '2026-08-05', null)
    expect(roundForDate([closed, overlapping], '2026-08-07')?.index).toBe(5)
  })
  it('returns null — a NEW round is needed — when the last round is finished', () => {
    expect(roundForDate([closed], '2026-08-20')).toBeNull()
  })
  it('ignores soft-deleted rounds', () => {
    expect(roundForDate([round(1, '2026-08-01', null, { deleted: true })], '2026-08-02')).toBeNull()
    expect(openRound([round(1, '2026-08-01', null, { deleted: true })])).toBeNull()
  })
})

describe('nextRoundIndex — the round a "new round" pick would create', () => {
  it('is one past the highest index', () => {
    expect(nextRoundIndex([round(1, '2026-01-01', '2026-01-05'), round(2, '2026-01-06', null)])).toBe(3)
  })
  it('is R1 for a cycle with no rounds', () => {
    expect(nextRoundIndex([])).toBe(1)
  })
})

describe('suggestCycleDay — aim the split day at the exercise being logged', () => {
  it('files a back lift under the back day, not whatever day is next', () => {
    expect(suggestCycleDay(SPLIT, ex(['back']), ['A'])).toBe('B')
  })
  it('returns null when the cycle trains none of the exercise’s parts (free training)', () => {
    expect(suggestCycleDay(SPLIT, ex(['cardio']))).toBeNull()
  })
  it('breaks ties toward a day the round still owes', () => {
    expect(suggestCycleDay(SPLIT, ex(['core']), ['C'])).toBe('A') // only A lists core
    const twoWay = cycle([day('A', ['core']), day('B', ['core'])])
    expect(suggestCycleDay(twoWay, ex(['core']), ['B'])).toBe('B')
  })
  it('scores a shared category above a merely shared region', () => {
    expect(dayMatchScore(day('A', ['chest'], ['chest']), ex(['chest']))).toBeGreaterThan(
      dayMatchScore(day('B', ['shoulders'], ['chest']), ex(['chest'])),
    )
  })
  it('flags no match for a day that trains nothing the exercise does', () => {
    expect(dayMatchScore(day('C', ['legs'], ['quads']), ex(['back']))).toBe(0)
  })
})
