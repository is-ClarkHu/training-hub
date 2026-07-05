import type { Sport, SportField, SportSession } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

export function sportName(s: Sport, lang: TranslationTarget): string {
  const primary = lang === 'zh' ? s.name_zh : s.name_en
  return primary || s.name_zh || s.name_en
}

export function fieldLabel(f: SportField, lang: TranslationTarget): string {
  return lang === 'zh' ? f.label_zh : f.label_en
}

/** Human label for a session's stored value of a given field. */
export function attrLabel(f: SportField, value: string | undefined, lang: TranslationTarget): string {
  if (!value) return '—'
  if (f.type === 'select') {
    const o = f.options?.find((x) => x.value === value)
    return o ? (lang === 'zh' ? o.zh : o.en) : value
  }
  return value
}

/** Signal colors for grouping. */
export const TIER_COLORS = ['#2dd4bf', '#7cc4ff', '#f5a623', '#ff6b6b', '#a78bfa', '#4ade80']

function mondayOf(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const wd = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - wd)
  return x
}

/** Total hours per ISO week for the last `weeks` weeks (oldest → newest). */
export function weeklyHours(sessions: SportSession[], weeks = 8): { labels: string[]; data: number[] } {
  const thisMon = mondayOf(new Date())
  const data = new Array<number>(weeks).fill(0)
  const labels: string[] = []
  for (let i = 0; i < weeks; i++) {
    const d = new Date(thisMon)
    d.setDate(thisMon.getDate() - (weeks - 1 - i) * 7)
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`)
  }
  for (const s of sessions) {
    const sm = mondayOf(new Date(`${s.date}T00:00:00`))
    const weeksAgo = Math.round((thisMon.getTime() - sm.getTime()) / (7 * 86_400_000))
    const idx = weeks - 1 - weeksAgo
    if (idx >= 0 && idx < weeks) data[idx] += s.hours
  }
  return { labels, data }
}

/** Total hours grouped by a select-field's option values (for the doughnut). */
export function hoursByField(
  sessions: SportSession[],
  field: SportField,
): { labels: string[]; data: number[] } {
  if (field.type !== 'select' || !field.options) return { labels: [], data: [] }
  const sums = new Map<string, number>(field.options.map((o) => [o.value, 0]))
  for (const s of sessions) {
    const v = s.attributes?.[field.key]
    if (v != null && sums.has(v)) sums.set(v, (sums.get(v) ?? 0) + s.hours)
  }
  return { labels: [...sums.keys()], data: [...sums.values()] }
}
