import { describe, it, expect } from 'vitest'
import { nextMonotonicIso } from './helpers'

const BASE = 1_700_000_000_000
const ms = (iso: string): number => Date.parse(iso)

describe('nextMonotonicIso — client clock is monotonic', () => {
  it('uses wall-clock time when it is ahead of the last stamp', () => {
    const wall = Date.now()
    expect(nextMonotonicIso(wall, null)).toBe(new Date(wall).toISOString())
  })

  it('never goes backward: a rewound clock still advances by 1ms', () => {
    const last = '2026-07-26T12:00:00.000Z'
    // wall clock jumped 5s into the past (NTP correction / user changed the date)
    const out = nextMonotonicIso(ms(last) - 5000, last)
    expect(ms(out)).toBe(ms(last) + 1)
  })

  it('a same-ms wall reading still strictly increases', () => {
    const last = '2026-07-26T12:00:00.500Z'
    expect(ms(nextMonotonicIso(ms(last), last))).toBe(ms(last) + 1)
  })

  it('stays strictly increasing across a run of backward readings', () => {
    let last: string | null = null
    let prev = -1
    // Feed a wall clock that ticks backward every call; output must keep rising.
    for (let i = 0; i < 100; i++) {
      const wall = BASE - i // going backward
      const out = nextMonotonicIso(wall, last)
      expect(ms(out)).toBeGreaterThan(prev)
      prev = ms(out)
      last = out
    }
  })
})
