import type { Sport, SportSession } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

export function sportName(s: Sport, lang: TranslationTarget): string {
  const primary = lang === 'zh' ? s.name_zh : s.name_en
  return primary || s.name_zh || s.name_en
}

export function tierLabel(s: Sport, tier: number, lang: TranslationTarget): string {
  const t = s.tiers.find((x) => x.level === tier)
  return t ? (lang === 'zh' ? t.zh : t.en) : `T${tier}`
}

/** Tier signal colors (play → casual → club → major). */
export const TIER_COLORS = ['#2dd4bf', '#7cc4ff', '#f5a623', '#ff6b6b']

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

/** Total hours in each of the 4 tiers. */
export function hoursByTier(sessions: SportSession[]): number[] {
  const out = [0, 0, 0, 0]
  for (const s of sessions) {
    const i = s.tier - 1
    if (i >= 0 && i < 4) out[i] += s.hours
  }
  return out
}
