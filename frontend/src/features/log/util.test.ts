// The "待翻译" badge must follow the names, not a flag written once at creation.
import { describe, it, expect } from 'vitest'
import { exerciseNeedsTranslation } from './util'
import type { Exercise } from '../../supabase/types'

const ex = (zh: string, en: string, flag = false): Exercise =>
  ({ name_zh: zh, name_en: en, needs_translation: flag, body_parts: ['chest'], measure_type: 'weight_reps' } as unknown as Exercise)

describe('exerciseNeedsTranslation', () => {
  it('is false once both languages are filled, even if the stale flag says otherwise', () => {
    expect(exerciseNeedsTranslation(ex('卧推', 'Bench press', true))).toBe(false)
  })
  it('is true while a language is missing', () => {
    expect(exerciseNeedsTranslation(ex('卧推', ''))).toBe(true)
    expect(exerciseNeedsTranslation(ex('', 'Bench press'))).toBe(true)
    expect(exerciseNeedsTranslation(ex('卧推', '   '))).toBe(true)
  })
  it('is false for a missing exercise (deleted) — nothing to translate', () => {
    expect(exerciseNeedsTranslation(undefined)).toBe(false)
  })
})
