import type {
  Injury,
  InjuryCheckpoint,
  InjuryLaterality,
  InjuryScenario,
  InjuryStatus,
  InjuryType,
} from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

// Lifecycle order (§6A). 'relapsed' is a branch off the main line — it re-opens a
// recovered injury — so it lives at the end of the ordered stage list.
export const INJURY_STATUSES: InjuryStatus[] = [
  'newly_occurred',
  'observing',
  'treating',
  'rehab_training',
  'returning',
  'recovered',
  'relapsed',
]

// The linear stages (excludes 'relapsed') used to draw the progress timeline.
export const INJURY_STAGES: InjuryStatus[] = INJURY_STATUSES.filter((s) => s !== 'relapsed')

export const INJURY_STATUS_LABELS: Record<InjuryStatus, { zh: string; en: string }> = {
  newly_occurred: { zh: '新发生', en: 'New' },
  observing: { zh: '观察中', en: 'Observing' },
  treating: { zh: '治疗中', en: 'Treating' },
  rehab_training: { zh: '康复训练中', en: 'Rehab' },
  returning: { zh: '逐步复训', en: 'Returning' },
  recovered: { zh: '已康复', en: 'Recovered' },
  relapsed: { zh: '复发', en: 'Relapsed' },
}

export const INJURY_TYPE_LABELS: Record<InjuryType, { zh: string; en: string }> = {
  sprain: { zh: '扭伤', en: 'Sprain' },
  strain: { zh: '拉伤', en: 'Strain' },
  contusion: { zh: '撞伤', en: 'Contusion' },
  overuse: { zh: '劳损', en: 'Overuse' },
  fracture: { zh: '骨折', en: 'Fracture' },
  other: { zh: '其他', en: 'Other' },
}

export const INJURY_SCENARIO_LABELS: Record<InjuryScenario, { zh: string; en: string }> = {
  running: { zh: '跑步', en: 'Running' },
  strength: { zh: '力量训练', en: 'Strength' },
  competition: { zh: '比赛', en: 'Competition' },
  daily: { zh: '日常活动', en: 'Daily' },
  other: { zh: '其他', en: 'Other' },
}

export const INJURY_LATERALITY_LABELS: Record<InjuryLaterality, { zh: string; en: string }> = {
  left: { zh: '左侧', en: 'Left' },
  right: { zh: '右侧', en: 'Right' },
  bilateral: { zh: '双侧', en: 'Bilateral' },
}

export const INJURY_TYPES = Object.keys(INJURY_TYPE_LABELS) as InjuryType[]
export const INJURY_SCENARIOS = Object.keys(INJURY_SCENARIO_LABELS) as InjuryScenario[]
export const INJURY_LATERALITIES = Object.keys(INJURY_LATERALITY_LABELS) as InjuryLaterality[]

/** True for any stage that still needs managing (everything but recovered). */
export function isActiveInjury(status: InjuryStatus): boolean {
  return status !== 'recovered'
}

/** Lifecycle position of a stage (higher = further along). Used to break date
 *  ties when deciding the current stage. */
export function stageRank(status: InjuryStatus): number {
  const i = INJURY_STATUSES.indexOf(status)
  return i < 0 ? 0 : i
}

/**
 * The injury's current stage = the FURTHEST-ALONG stage in the (locked) recovery
 * flow that has a checkpoint — not the one with the latest date. The flow order
 * is fixed; a later-in-flow stage is never demoted just because its date is
 * earlier. So backfilling middle steps never changes where the injury is now, and
 * once you've recorded e.g. 逐步复训 the status stays there until you record a
 * LATER-in-flow stage (like 已康复). Date sanity is enforced separately by
 * checkpointOrderError. Same-stage duplicates tie-break to the later date.
 */
export function currentStage(checkpoints: InjuryCheckpoint[]): InjuryCheckpoint | null {
  let best: InjuryCheckpoint | null = null
  for (const c of checkpoints) {
    if (
      !best ||
      stageRank(c.status) > stageRank(best.status) ||
      (stageRank(c.status) === stageRank(best.status) && c.date > best.date)
    ) {
      best = c
    }
  }
  return best
}

/**
 * Validate that stage dates move forward along the lifecycle: a stage that comes
 * LATER in the recovery flow must not be dated EARLIER than one before it.
 * Returns the first offending pair (earlier-in-flow, later-in-flow), or null.
 * 'relapsed' is a branch off the linear flow and is excluded from the check.
 */
export function checkpointOrderError(
  checkpoints: InjuryCheckpoint[],
): { before: InjuryCheckpoint; after: InjuryCheckpoint } | null {
  const linear = checkpoints
    .filter((c) => INJURY_STAGES.includes(c.status))
    .sort((a, b) => INJURY_STAGES.indexOf(a.status) - INJURY_STAGES.indexOf(b.status))
  for (let i = 1; i < linear.length; i++) {
    if (linear[i].date < linear[i - 1].date) return { before: linear[i - 1], after: linear[i] }
  }
  return null
}

/** Body area in the current UI language, falling back across the pair + legacy (§14). */
export function bodyAreaLabel(
  i: Pick<Injury, 'body_area_zh' | 'body_area_en' | 'body_area'>,
  lang: TranslationTarget,
): string {
  return lang === 'zh'
    ? i.body_area_zh || i.body_area_en || i.body_area || ''
    : i.body_area_en || i.body_area_zh || i.body_area || ''
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
