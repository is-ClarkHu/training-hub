// Rehab progress visualization per injury (SPEC §6A): the linear stage timeline
// (new → observing → treating → rehab → returning → recovered) with the date each
// stage was entered (from checkpoints), days-since-onset, a relapse flag, and
// return-to-activity signals (rehab-modified lifts + injured sport sessions).
import type { Injury, InjuryStatus } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { INJURY_STAGES, INJURY_STATUS_LABELS, daysBetween, daysSince } from './util'

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
  const relapsed = injury.status === 'relapsed'
  const recovered = injury.status === 'recovered'
  // relapsed re-opens the injury → show full line as "reached, but reopened".
  const currentIdx = recovered
    ? INJURY_STAGES.length - 1
    : relapsed
      ? INJURY_STAGES.length - 1
      : INJURY_STAGES.indexOf(injury.status)

  const days = recovered && injury.resolved_on
    ? daysBetween(injury.started_on, injury.resolved_on)
    : daysSince(injury.started_on)

  // Latest date the injury entered each stage (from checkpoints).
  const stageDate: Partial<Record<InjuryStatus, string>> = {}
  for (const cp of injury.checkpoints) stageDate[cp.status] = cp.date

  return (
    <div className={`inj-timeline ${relapsed ? 'relapsed' : ''}`}>
      <div className="inj-days">
        <span className="inj-days-n">{days}</span>
        <span className="inj-days-l">{recovered ? (lang === 'zh' ? '恢复用时(天)' : 'days to recover') : (lang === 'zh' ? '天(自受伤)' : 'days since onset')}</span>
      </div>

      <div className="inj-stages">
        {INJURY_STAGES.map((s, i) => (
          <div key={s} className={`inj-stage ${i <= currentIdx && !relapsed ? 'done' : ''} ${i === currentIdx && !relapsed ? 'current' : ''}`}>
            <span className="inj-stage-dot" />
            <span className="inj-stage-label">{INJURY_STATUS_LABELS[s][lang]}</span>
            {stageDate[s] && <span className="inj-stage-date">{stageDate[s]}</span>}
          </div>
        ))}
      </div>

      {relapsed && (
        <div className="inj-relapse-flag">
          ⚠️ {lang === 'zh' ? `复发 · ${stageDate.relapsed ?? ''}` : `Relapsed · ${stageDate.relapsed ?? ''}`}
        </div>
      )}

      <div className="inj-activity">
        <span>{lang === 'zh' ? '康复相关' : 'rehab activity'}:</span>
        <span className="inj-stat">{linkedEntries} {lang === 'zh' ? '减量/暂停动作' : 'modified lifts'}</span>
        <span className="inj-stat">{injuredSessions} {lang === 'zh' ? '带伤运动场次' : 'injured sessions'}</span>
      </div>
    </div>
  )
}
