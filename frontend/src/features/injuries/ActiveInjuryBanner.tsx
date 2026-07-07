// Active-injury banner (SPEC §6A): any non-recovered injury surfaces here. Used
// on the Injuries tab and reusable on the Dashboard. Renders nothing when clear.
import type { Injury } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { INJURY_STATUS_LABELS, bodyAreaLabel, daysSince } from './util'

export function ActiveInjuryBanner({
  injuries,
  lang,
  showClear = false,
}: {
  injuries: Injury[]
  lang: TranslationTarget
  showClear?: boolean
}) {
  const active = injuries.filter((i) => i.status !== 'recovered')

  // All-clear: no active injuries. Only shown where asked (e.g. Dashboard).
  if (active.length === 0) {
    if (!showClear) return null
    return (
      <div className="inj-banner ok" role="status">
        <span className="inj-banner-icon" aria-hidden="true">🟢</span>
        <div>
          <div className="inj-banner-title ok">{lang === 'zh' ? '近期无伤病 · 状态良好' : 'Injury-free · all clear'}</div>
          <div className="inj-banner-list">
            <span className="inj-banner-item">
              {lang === 'zh'
                ? '当前没有活动伤病。保持热身与循序渐进,留意疲劳累积——身体状态不错,继续保持 💪'
                : 'No active injuries right now. Keep warming up and progressing gradually, and watch for fatigue — you’re in good shape 💪'}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="inj-banner" role="status">
      <span className="inj-banner-icon" aria-hidden="true">⚠️</span>
      <div>
        <div className="inj-banner-title">{lang === 'zh' ? `活动伤病 · ${active.length}` : `Active injuries · ${active.length}`}</div>
        <div className="inj-banner-list">
          {active.map((i) => (
            <span key={i.id} className="inj-banner-item">
              <strong>{bodyAreaLabel(i, lang)}</strong> · {INJURY_STATUS_LABELS[i.status][lang]} · {daysSince(i.started_on)}{lang === 'zh' ? '天' : 'd'}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
