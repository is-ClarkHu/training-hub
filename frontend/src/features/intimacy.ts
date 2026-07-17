import type { IntimacyCategory, OptionalTracker } from '../supabase/types'
import type { TranslationTarget } from '../translation'

export const INTIMACY_VISIBLE_KEY = 'th.tracker.intimacy.enabled'

export const INTIMACY_CATEGORIES: IntimacyCategory[] = ['solo', 'partner_low', 'partner_active']

// Clinical/research phrasing rather than colloquial — the rows show up in History
// and in exported images, where a glance from someone else shouldn't be loud.
// Meaning is preserved; only the register changes.
export const INTIMACY_LABEL: Record<IntimacyCategory, { zh: string; en: string; shortZh: string; shortEn: string }> = {
  solo: { zh: '单人活动', en: 'Solitary', shortZh: '单人', shortEn: 'Solo' },
  partner_low: { zh: '双人 · 非插入', en: 'Partnered · non-penetrative', shortZh: '非插入', shortEn: 'Non-pen.' },
  partner_active: { zh: '双人 · 插入', en: 'Partnered · penetrative', shortZh: '插入', shortEn: 'Penetrative' },
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
