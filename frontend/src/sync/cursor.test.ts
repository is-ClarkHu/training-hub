import { describe, it, expect } from 'vitest'
import {
  tms, isNewer, afterCursor, byCursor, pageAfter, drain, selectPush, maxCursor,
  type Keyed, type Cursor,
} from './cursor'

const EPOCH = '1970-01-01T00:00:00.000Z'
const BASE = 1_700_000_000_000
const T = (offsetMs: number): string => new Date(BASE + offsetMs).toISOString()
const r = (ts: string, id: string): Keyed => ({ updated_at: ts, id })
const ids = (rows: Keyed[]): string[] => rows.map((x) => x.id)

describe('tms — epoch parsing is format-robust', () => {
  it('parses `…Z` and `…+00:00` for the same instant equally', () => {
    expect(tms('2026-07-26T12:00:00.500Z')).toBe(tms('2026-07-26T12:00:00.500+00:00'))
  })
  it('orders correctly regardless of the two formats', () => {
    expect(isNewer('2026-07-26T12:00:00.501Z', '2026-07-26T12:00:00.500+00:00')).toBe(true)
    expect(isNewer('2026-07-26T12:00:00.500+00:00', '2026-07-26T12:00:00.500Z')).toBe(false) // equal instant
  })
})

describe('afterCursor — composite (updated_at, id) strict order', () => {
  it('compares by timestamp first', () => {
    expect(afterCursor(T(2), 'a', T(1), 'z')).toBe(true)
    expect(afterCursor(T(1), 'z', T(2), 'a')).toBe(false)
  })
  it('breaks ms ties by id', () => {
    expect(afterCursor(T(1), 'b', T(1), 'a')).toBe(true)
    expect(afterCursor(T(1), 'a', T(1), 'b')).toBe(false)
    expect(afterCursor(T(1), 'a', T(1), 'a')).toBe(false) // equal → not after
  })
  it('an empty sinceId is before every real id at the same ts', () => {
    expect(afterCursor(T(1), 'a', T(1), '')).toBe(true)
  })
})

describe('drain — keyset pagination never skips or duplicates', () => {
  // The dataset the invariant is checked against: heavy ms-ties, multiple clusters.
  const dataset: Keyed[] = [
    r(T(0), 'a'), r(T(0), 'b'), r(T(0), 'c'),   // 3-way tie at T0
    r(T(5), 'd'),
    r(T(9), 'e'), r(T(9), 'f'), r(T(9), 'g'), r(T(9), 'h'), r(T(9), 'i'), // 5-way tie at T9
    r(T(20), 'j'),
  ]
  const fromStart: Cursor = { ts: EPOCH, id: '' }

  for (const page of [1, 2, 3, 4, 1000]) {
    it(`drains every row exactly once at page size ${page}`, () => {
      const pulled = drain(dataset, page, fromStart)
      // no duplicates
      expect(new Set(ids(pulled)).size).toBe(pulled.length)
      // covers the whole dataset, in cursor order
      expect(ids(pulled)).toEqual(ids(byCursor(dataset)))
    })
  }

  it('a tie cluster larger than the page size is fully drained (the original bug)', () => {
    // 5 rows share T9; with page=2 the naive `.gt(max updated_at)` cursor would set
    // the watermark to T9 after the first page and skip the remaining T9 rows.
    const pulled = drain(dataset, 2, fromStart)
    const t9 = pulled.filter((x) => x.updated_at === T(9))
    expect(ids(t9)).toEqual(['e', 'f', 'g', 'h', 'i'])
  })

  it('resumes from a mid cursor without re-pulling or skipping', () => {
    const pulled = drain(dataset, 2, { ts: T(9), id: 'g' }) // after (T9,g)
    expect(ids(pulled)).toEqual(['h', 'i', 'j'])
  })

  it('empty dataset drains to nothing', () => {
    expect(drain([], 2, fromStart)).toEqual([])
  })
})

describe('drain — legacy watermark (id cursor is empty) self-heals', () => {
  // Upgrading from the old bare-timestamp watermark: ts=T9, id=''. The `.gte` branch
  // must RE-INCLUDE the rows exactly at T9 (recovering any the old `.gt` had skipped)
  // and exclude everything strictly before T9.
  const dataset: Keyed[] = [
    r(T(0), 'a'), r(T(9), 'e'), r(T(9), 'f'), r(T(9), 'g'), r(T(20), 'j'),
  ]
  it('re-includes boundary ties and drops earlier rows', () => {
    const pulled = drain(dataset, 2, { ts: T(9), id: '' })
    expect(ids(pulled)).toEqual(['e', 'f', 'g', 'j']) // 'a' (before T9) excluded
    expect(new Set(ids(pulled)).size).toBe(pulled.length)
  })
  it('pageAfter with empty id uses >= (never `id.gt.""`, which would crash on a uuid cast)', () => {
    const got = pageAfter(dataset, { ts: T(9), id: '' }, 100)
    expect(got.every((x) => tms(x.updated_at) >= tms(T(9)))).toBe(true)
  })
})

describe('selectPush + maxCursor — push side of the composite cursor', () => {
  const local: Keyed[] = [r(T(0), 'a'), r(T(9), 'e'), r(T(9), 'f'), r(T(20), 'j')]

  it('selects everything from a fresh cursor and advances to the composite-max', () => {
    const picked = selectPush(local, { ts: EPOCH, id: '' })
    expect(ids(picked)).toEqual(['a', 'e', 'f', 'j'])
    expect(maxCursor(picked)).toEqual({ ts: T(20), id: 'j' })
  })

  it('is idempotent: re-pushing from the advanced cursor selects nothing', () => {
    const cur = maxCursor(local) // {T20,'j'}
    expect(selectPush(local, cur)).toEqual([])
  })

  it('catches a new same-ms row with a LARGER id (tie handled by the fix)', () => {
    const cur = maxCursor(local.filter((x) => x.updated_at === T(9))) // {T9,'f'}
    const withNew = [...local, r(T(9), 'g')] // g > f, same ms
    expect(ids(selectPush(withNew, cur))).toContain('g')
  })

  it('DOCUMENTED RESIDUAL: a new same-ms row with a SMALLER id is missed', () => {
    // Needs a per-row dirty flag to fully close; see training-hub-sync memory. This
    // test pins the known gap so a future fix flips it deliberately.
    const cur = maxCursor(local.filter((x) => x.updated_at === T(9))) // {T9,'f'}
    const withNew = [...local, r(T(9), 'a2')] // 'a2' < 'f', same ms, written after the push
    expect(ids(selectPush(withNew, cur))).not.toContain('a2')
  })
})
