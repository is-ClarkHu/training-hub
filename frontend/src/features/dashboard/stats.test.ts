// Daily-intensity calendar (§8 signature panel). These guard two things the old
// GitHub-style heatmap got wrong: the additive `min(4, training + sport)` score
// collapsed every hard day into the same red, and future days in the current
// month rendered identically to rest days.
import { describe, it, expect } from 'vitest'
import { MAX_DAY_LOAD, dayLoad, intensityCalendar, type CalendarSession } from './stats'
import type { Exercise, WorkoutEntry } from '../../supabase/types'

const ex = (id: string, parts: string[]): Exercise =>
  ({ id, name_zh: '', name_en: '', body_parts: parts, measure_type: 'weight_reps' } as unknown as Exercise)

const EX: Record<string, Exercise> = {
  bench: ex('bench', ['chest']),
  row: ex('row', ['back']),
  squat: ex('squat', ['legs']),
}

let n = 0
const entry = (date: string, exercise_id: string): WorkoutEntry =>
  ({ id: `e${n++}`, user_id: 'u', updated_at: '', deleted: false, date, exercise_id } as unknown as WorkoutEntry)

const sess = (date: string, hours: number, level?: string, sport_id = 'frisbee'): CalendarSession =>
  ({ date, sport_id, hours, attributes: level ? { level } : {} })

/** Build `entries` + a matching setCountOf for a day → {exercise: sets} spec. */
function build(spec: Record<string, Record<string, number>>) {
  const entries: WorkoutEntry[] = []
  const sets: Record<string, number> = {}
  for (const [date, byEx] of Object.entries(spec)) {
    for (const [exId, count] of Object.entries(byEx)) {
      const e = entry(date, exId)
      entries.push(e)
      sets[e.id] = count
    }
  }
  return { entries, setCountOf: (id: string) => sets[id] ?? 0 }
}

describe('dayLoad — continuous daily training load', () => {
  it('is zero for a rest day', () => {
    expect(dayLoad(0, [])).toBe(0)
  })

  it('counts one point per working set', () => {
    expect(dayLoad(12, [])).toBe(12)
  })

  it('scales sport by its level, not just its duration', () => {
    expect(dayLoad(0, [sess('d', 2, 'major')])).toBeGreaterThan(dayLoad(0, [sess('d', 2, 'casual')]))
  })

  it('ADDS multiple sport sessions instead of taking the hardest', () => {
    const two = dayLoad(0, [sess('d', 1, 'casual'), sess('d', 1, 'casual')])
    expect(two).toBe(2 * dayLoad(0, [sess('d', 1, 'casual')]))
  })

  it('falls back to a duration estimate for sports with no level field', () => {
    expect(dayLoad(0, [sess('d', 2)])).toBeGreaterThan(0)
  })

  it('adds lifting and sport together', () => {
    expect(dayLoad(10, [sess('d', 1, 'club')])).toBe(10 + dayLoad(0, [sess('d', 1, 'club')]))
  })
})

describe('intensityCalendar — level scale', () => {
  const months = ['2026-09']
  const run = (spec: Record<string, Record<string, number>>, opts: Record<string, unknown> = {}) => {
    const { entries, setCountOf } = build(spec)
    return intensityCalendar({ entries, exById: EX, setCountOf, sessions: [], months, today: '2026-09-30', ...opts })
  }
  const levelOn = (cal: ReturnType<typeof run>, date: string) =>
    cal.flatMap((m) => m.days).find((d) => d.date === date)?.level

  it('gives a rest day level 0', () => {
    expect(levelOn(run({ '2026-09-01': { bench: 8 } }), '2026-09-02')).toBe(0)
  })

  it('caps at level 4 by an ABSOLUTE threshold, so a huge day is always max', () => {
    const cal = run({ '2026-09-01': { bench: MAX_DAY_LOAD + 50 } })
    expect(levelOn(cal, '2026-09-01')).toBe(4)
  })

  it('spreads ordinary days across levels 1–3 by their rank', () => {
    const spec: Record<string, Record<string, number>> = {}
    for (let d = 1; d <= 12; d++) spec[`2026-09-${String(d).padStart(2, '0')}`] = { bench: d }
    const cal = run(spec)
    expect(levelOn(cal, '2026-09-01')).toBe(1)
    expect(levelOn(cal, '2026-09-12')).toBe(3)
  })

  it('does NOT let a few monster days drag every ordinary day down a level', () => {
    const base: Record<string, Record<string, number>> = {}
    for (let d = 1; d <= 12; d++) base[`2026-09-${String(d).padStart(2, '0')}`] = { bench: d }
    const before = run(base).flatMap((m) => m.days).map((d) => d.level)

    const withMonsters = { ...base }
    for (let d = 20; d <= 23; d++) withMonsters[`2026-09-${d}`] = { bench: MAX_DAY_LOAD + 40 }
    const after = run(withMonsters)

    for (let d = 1; d <= 12; d++) {
      const iso = `2026-09-${String(d).padStart(2, '0')}`
      expect(levelOn(after, iso)).toBe(before[d - 1])
    }
  })

  it('derives the 1–3 cut points from ALL history, not just the months shown', () => {
    const spec: Record<string, Record<string, number>> = {}
    for (let d = 1; d <= 12; d++) spec[`2026-08-${String(d).padStart(2, '0')}`] = { bench: d }
    spec['2026-09-01'] = { bench: 2 }
    const shown = run(spec)
    const all = run(spec, { months: ['2026-08', '2026-09'] })
    expect(levelOn(shown, '2026-09-01')).toBe(levelOn(all, '2026-09-01'))
  })
})

describe('intensityCalendar — future days', () => {
  it('marks days after today as null, not as rest', () => {
    const cal = intensityCalendar({
      entries: [], exById: EX, setCountOf: () => 0, sessions: [],
      months: ['2026-09'], today: '2026-09-16',
    })
    expect(cal[0].days.find((d) => d.date === '2026-09-16')?.level).toBe(0)
    expect(cal[0].days.find((d) => d.date === '2026-09-17')?.level).toBeNull()
    expect(cal[0].days.find((d) => d.date === '2026-09-30')?.level).toBeNull()
  })
})

describe('intensityCalendar — grid shape', () => {
  const cal = (month: string, today = '2026-12-31') =>
    intensityCalendar({ entries: [], exById: EX, setCountOf: () => 0, sessions: [], months: [month], today })[0]

  it('emits every day of the month', () => {
    expect(cal('2026-09').days).toHaveLength(30)
    expect(cal('2026-02').days).toHaveLength(28)
  })

  it('offsets the first row so the month starts on the right weekday (Mon = 0)', () => {
    expect(cal('2026-09').leading).toBe(1) // 2026-09-01 is a Tuesday
    expect(cal('2026-11').leading).toBe(6) // 2026-11-01 is a Sunday
  })
})

describe('intensityCalendar — day contents', () => {
  const sessions = [sess('2026-09-01', 2, 'club')]
  const run = (include?: { strength?: boolean; sport?: boolean }) => {
    const { entries, setCountOf } = build({ '2026-09-01': { bench: 4, row: 9, squat: 6 } })
    return intensityCalendar({
      entries, exById: EX, setCountOf, sessions, months: ['2026-09'], today: '2026-09-30', include,
    })[0].days.find((d) => d.date === '2026-09-01')!
  }

  it('lists one tag per body part, heaviest first', () => {
    expect(run().strength).toEqual([
      { part: 'back', sets: 9 },
      { part: 'legs', sets: 6 },
      { part: 'chest', sets: 4 },
    ])
  })

  it('lists sport sessions with their hours', () => {
    expect(run().sports).toEqual([{ sportId: 'frisbee', hours: 2 }])
  })

  it('drops strength from both the tags and the load when it is filtered out', () => {
    const day = run({ strength: false, sport: true })
    expect(day.strength).toEqual([])
    expect(day.load).toBe(dayLoad(0, sessions))
  })

  it('drops sport from both the tags and the load when it is filtered out', () => {
    const day = run({ strength: true, sport: false })
    expect(day.sports).toEqual([])
    expect(day.load).toBe(19)
  })
})

describe('intensityCalendar — default month span', () => {
  const { entries, setCountOf } = build({ '2026-06-20': { bench: 5 }, '2026-08-03': { row: 5 } })

  it('covers every month from the first logged day through today', () => {
    const cal = intensityCalendar({
      entries, exById: EX, setCountOf, sessions: [], today: '2026-09-16',
    })
    expect(cal.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
  })

  it('keeps the span when a category is filtered out, so months never vanish', () => {
    const cal = intensityCalendar({
      entries, exById: EX, setCountOf, sessions: [], today: '2026-09-16',
      include: { strength: false, sport: true },
    })
    expect(cal.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
  })

  it('falls back to the current month with no history at all', () => {
    const cal = intensityCalendar({
      entries: [], exById: EX, setCountOf: () => 0, sessions: [], today: '2026-09-16',
    })
    expect(cal.map((m) => m.month)).toEqual(['2026-09'])
  })
})
