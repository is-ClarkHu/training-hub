import type { InjuryStatus } from '../../supabase/types'

export const INJURY_STATUSES: InjuryStatus[] = ['acute', 'rehab', 'recovered']

export const INJURY_STATUS_LABELS: Record<InjuryStatus, { zh: string; en: string }> = {
  acute: { zh: '急性', en: 'Acute' },
  rehab: { zh: '康复中', en: 'Rehab' },
  recovered: { zh: '已恢复', en: 'Recovered' },
}

/** Whole days from an ISO date to today (never negative). */
export function daysSince(date: string): number {
  const start = new Date(`${date}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((now.getTime() - start.getTime()) / 86_400_000))
}

/** Whole days between two ISO dates (from → to). */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000))
}
