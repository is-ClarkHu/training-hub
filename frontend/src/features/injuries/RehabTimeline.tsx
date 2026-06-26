// Rehab progress visualization per injury (SPEC §6A, required): onset → rehab →
// recovered timeline with days-since-onset, plus return-to-activity signals
// (rehab-modified exercises + injured sport sessions since onset).
import type { Injury } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { INJURY_STATUSES, INJURY_STATUS_LABELS, daysBetween, daysSince } from './util'

export function RehabTimeline({
  injury,
  lang,
  linkedEntries,
  injuredSessions,
}: {
  injury: Injury
  lang: TranslationTarget
  linkedEntries: number
  injuredSessions: number
}) {
  const currentIdx = INJURY_STATUSES.indexOf(injury.status)
  const recovered = injury.status === 'recovered'
  const days = recovered && injury.resolved_on
    ? daysBetween(injury.started_on, injury.resolved_on)
    : daysSince(injury.started_on)

  return (
    <div className="inj-timeline">
      <div className="inj-days">
        <span className="inj-days-n">{days}</span>
        <span className="inj-days-l">{recovered ? (lang === 'zh' ? '恢复用时(天)' : 'days to recover') : (lang === 'zh' ? '天(自发病)' : 'days since onset')}</span>
      </div>

      <div className="inj-stages">
        {INJURY_STATUSES.map((s, i) => (
          <div key={s} className={`inj-stage ${i <= currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}>
            <span className="inj-stage-dot" />
            <span className="inj-stage-label">{INJURY_STATUS_LABELS[s][lang]}</span>
          </div>
        ))}
      </div>

      <div className="inj-activity">
        <span>{lang === 'zh' ? '康复相关' : 'rehab activity'}:</span>
        <span className="inj-stat">{linkedEntries} {lang === 'zh' ? '减量/暂停动作' : 'modified lifts'}</span>
        <span className="inj-stat">{injuredSessions} {lang === 'zh' ? '带伤运动场次' : 'injured sessions'}</span>
      </div>
    </div>
  )
}
