// Active-injury banner (SPEC §6A): any non-recovered injury surfaces here. Used
// on the Injuries tab and reusable on the Dashboard. Renders nothing when clear.
import type { Injury } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { INJURY_STATUS_LABELS, daysSince } from './util'

export function ActiveInjuryBanner({ injuries, lang }: { injuries: Injury[]; lang: TranslationTarget }) {
  const active = injuries.filter((i) => i.status !== 'recovered')
  if (active.length === 0) return null

  return (
    <div className="inj-banner" role="status">
      <span className="inj-banner-icon" aria-hidden="true">▲</span>
      <div className="inj-banner-list">
        {active.map((i) => (
          <span key={i.id} className="inj-banner-item">
            <strong>{i.body_area}</strong> · {INJURY_STATUS_LABELS[i.status][lang]} · {daysSince(i.started_on)}
            {lang === 'zh' ? '天' : 'd'}
          </span>
        ))}
      </div>
    </div>
  )
}
