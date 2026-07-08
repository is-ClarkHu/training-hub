import { categoryLabel } from '../../categories'
import type { CycleDay } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

export function cycleDayTitle(day: CycleDay, lang: TranslationTarget): string {
  const localized = lang === 'zh' ? day.title_zh : day.title_en
  if (localized?.trim()) return localized.trim()
  if (day.body_parts.length > 0) return day.body_parts.map((bp) => categoryLabel(bp, lang)).join(' / ')
  return day.title?.trim() || day.label
}

export function cycleDayOptionLabel(day: CycleDay, lang: TranslationTarget): string {
  const title = cycleDayTitle(day, lang)
  return title && title !== day.label ? `${day.label} · ${title}` : day.label
}
