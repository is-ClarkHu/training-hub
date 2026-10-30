// The "待翻译" badge must follow the names, not a flag written once at creation.
import { describe, it, expect } from 'vitest'
import { exerciseNeedsTranslation, maskHours, parseHours } from './util'
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

describe('maskHours — the colon is typed for you', () => {
  it('builds h:mm as digits arrive', () => {
    expect(maskHours('1')).toBe('1')
    expect(maskHours('13')).toBe('13')
    expect(maskHours('130')).toBe('1:30')
    expect(maskHours('1230')).toBe('12:30')
  })

  it('ignores anything that is not a digit, including a typed colon', () => {
    expect(maskHours('1:30')).toBe('1:30')
    expect(maskHours('1h30m')).toBe('1:30')
    expect(maskHours('abc')).toBe('')
  })

  it('caps at four digits so a stuck key cannot log a 1000-hour session', () => {
    expect(maskHours('123456')).toBe('12:34')
  })

  it('round-trips through parseHours', () => {
    expect(parseHours(maskHours('130'))).toBeCloseTo(1.5)
    expect(parseHours(maskHours('45'))).toBe(45) // two digits are still a bare number
  })
})
