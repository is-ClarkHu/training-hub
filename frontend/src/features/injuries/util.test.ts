// Onset reconciliation. The onset date and the "newly occurred" checkpoint are the
// same event, but the editor used to seed the checkpoint at today() and then let the
// onset field be moved back to the real date without it, so rows drifted apart.
import { describe, it, expect } from 'vitest'
import { reconcileOnset } from './util'
import type { InjuryCheckpoint, InjuryStatus } from '../../supabase/types'

const cp = (status: InjuryStatus, date: string): InjuryCheckpoint => ({ status, date })

describe('reconcileOnset', () => {
  it('pulls both back to the earlier date when they disagree', () => {
    const r = reconcileOnset('2026-10-10', [cp('newly_occurred', '2026-10-22')])
    expect(r.started_on).toBe('2026-10-10')
    expect(r.checkpoints[0].date).toBe('2026-10-10')
  })

  it('works whichever side is earlier', () => {
    const r = reconcileOnset('2026-10-22', [cp('newly_occurred', '2026-10-10')])
    expect(r.started_on).toBe('2026-10-10')
    expect(r.checkpoints[0].date).toBe('2026-10-10')
  })

  it('leaves a consistent row untouched', () => {
    const cps = [cp('newly_occurred', '2026-10-10'), cp('treating', '2026-10-14')]
    const r = reconcileOnset('2026-10-10', cps)
    expect(r.started_on).toBe('2026-10-10')
    expect(r.checkpoints).toBe(cps) // same reference: nothing rewritten
  })

  it('touches only the onset checkpoint', () => {
    const r = reconcileOnset('2026-10-10', [
      cp('newly_occurred', '2026-10-22'),
      cp('treating', '2026-10-25'),
    ])
    expect(r.checkpoints.map((c) => c.date)).toEqual(['2026-10-10', '2026-10-25'])
  })

  it('leaves a row with no onset checkpoint alone', () => {
    // Injuries logged straight into a later stage have no "newly occurred" row.
    const cps = [cp('rehab_training', '2026-10-14')]
    const r = reconcileOnset('2026-10-10', cps)
    expect(r.started_on).toBe('2026-10-10')
    expect(r.checkpoints).toBe(cps)
  })
})
