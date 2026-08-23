import { categoryLabel } from '../../categories'
import type { CycleDay, Exercise, TrainingCycle } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { categoryRegions } from './anatomy'

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

/** How well an exercise fits a split day: shared categories first, shared anatomical
 *  regions as a weaker signal (so a day bound only by regions still matches). */
export function dayMatchScore(day: CycleDay, ex: Exercise): number {
  const cats = new Set(day.body_parts)
  const direct = ex.body_parts.filter((bp) => cats.has(bp)).length
  if (direct > 0) return direct * 10
  const dayRegions = new Set(day.regions ?? [])
  if (dayRegions.size === 0) return 0
  const exRegions = new Set(ex.body_parts.flatMap((bp) => categoryRegions(bp)))
  let shared = 0
  for (const r of exRegions) if (dayRegions.has(r)) shared++
  return shared
}

/**
 * The split day an exercise most likely belongs to — what the Log screen pre-selects
 * so a back lift is never silently filed under the chest day (which used to complete
 * that day, close the round, and quietly start the next one). Returns null when the
 * exercise trains nothing this cycle plans, i.e. it is free training.
 *
 * Ties break toward a day the current round still owes (`remaining`), then day order.
 */
export function suggestCycleDay(cycle: TrainingCycle, ex: Exercise, remaining: string[] = []): string | null {
  let best: { label: string; score: number; owed: boolean } | null = null
  for (const d of cycle.days) {
    const score = dayMatchScore(d, ex)
    if (score <= 0) continue
    const owed = remaining.includes(d.label)
    if (!best || score > best.score || (score === best.score && owed && !best.owed)) {
      best = { label: d.label, score, owed }
    }
  }
  return best?.label ?? null
}
