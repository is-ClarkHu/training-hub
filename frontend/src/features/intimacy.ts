import type { IntimacyCategory, OptionalTracker } from '../supabase/types'
import type { TranslationTarget } from '../translation'

export const INTIMACY_VISIBLE_KEY = 'th.tracker.intimacy.enabled'

export const INTIMACY_CATEGORIES: IntimacyCategory[] = ['solo', 'partner_low', 'partner_active']

export const INTIMACY_LABEL: Record<IntimacyCategory, { zh: string; en: string; shortZh: string; shortEn: string }> = {
  solo: { zh: '自慰', en: 'Masturbation', shortZh: '自慰', shortEn: 'Solo' },
  partner_low: { zh: '前戏 / 口交', en: 'Foreplay / Oral', shortZh: '前戏', shortEn: 'Foreplay' },
  partner_active: { zh: '性交', en: 'Sex', shortZh: '性交', shortEn: 'Sex' },
}

export const INTIMACY_COLORS: Record<IntimacyCategory, string> = {
  solo: '#a78bfa',
  partner_low: '#f472b6',
  partner_active: '#fb7185',
}

export function intimacyVisible(): boolean {
  return localStorage.getItem(INTIMACY_VISIBLE_KEY) === '1'
}

export function setIntimacyVisible(on: boolean): void {
  localStorage.setItem(INTIMACY_VISIBLE_KEY, on ? '1' : '0')
}

export function intimacyCategory(row: OptionalTracker): IntimacyCategory {
  return row.category ?? 'partner_active'
}

export function intimacyLabel(category: IntimacyCategory, lang: TranslationTarget, short = false): string {
  const label = INTIMACY_LABEL[category]
  if (short) return lang === 'zh' ? label.shortZh : label.shortEn
  return lang === 'zh' ? label.zh : label.en
}
