import type { TranslationTarget } from '../../translation'
import type { Exercise } from '../../supabase/types'

/** One editable set row in the Log form (strings; parsed on save). */
export interface SetDraft {
  weight: string
  reps: string
  duration: string // 'mm:ss' or seconds
  per_side: boolean
}

export const emptySet = (): SetDraft => ({ weight: '', reps: '', duration: '', per_side: false })

export function exerciseName(ex: Exercise, lang: TranslationTarget): string {
  const primary = lang === 'zh' ? ex.name_zh : ex.name_en
  return primary || ex.name_zh || ex.name_en // fall back only if a name is genuinely missing
}

/** Parse 'mm:ss' (or bare seconds) → total seconds; '' → null. */
export function parseDuration(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (t.includes(':')) {
    const [m, s] = t.split(':')
    const mins = parseInt(m, 10) || 0
    const secs = parseInt(s, 10) || 0
    return mins * 60 + secs
  }
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function toNumber(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

export function toInt(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}
