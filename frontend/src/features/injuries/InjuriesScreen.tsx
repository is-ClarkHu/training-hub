// Injuries tab (SPEC §6A): active-injury banner + injury log (CRUD, status
// transitions acute→rehab→recovered) + per-injury rehab timeline.
import { useCallback, useEffect, useState } from 'react'
import {
  getInjuries,
  getEntries,
  getSportSessions,
  updateInjury,
  softDeleteInjury,
} from '../../db'
import { useLanguage } from '../../i18n'
import { categoryLabel } from '../../categories'
import {
  type Injury,
  type InjuryStatus,
  type SportSession,
  type WorkoutEntry,
} from '../../supabase/types'
import { AddInjuryDialog } from './AddInjuryDialog'
import { ActiveInjuryBanner } from './ActiveInjuryBanner'
import { RehabTimeline } from './RehabTimeline'
import { INJURY_STATUSES, INJURY_STATUS_LABELS, daysSince } from './util'
import './injuries.css'

export function InjuriesScreen() {
  const { lang } = useLanguage()
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [sessions, setSessions] = useState<SportSession[]>([])
  const [dialog, setDialog] = useState<{ open: boolean; injury?: Injury }>({ open: false })
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [inj, ents, sess] = await Promise.all([getInjuries(), getEntries(), getSportSessions()])
    setInjuries(inj)
    setEntries(ents)
    setSessions(sess)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function setStatus(id: string, status: InjuryStatus) {
    await updateInjury(id, { status })
    await reload()
  }

  async function remove(id: string) {
    if (!confirm('Delete this injury?')) return
    await softDeleteInjury(id)
    await reload()
  }

  if (loading) return <p className="inj-empty">Loading…</p>

  return (
    <div className="inj-screen">
      <ActiveInjuryBanner injuries={injuries} lang={lang} />

      <div className="inj-head">
        <span className="th-label">Injury log</span>
        <button className="th-btn-ghost inj-add" type="button" onClick={() => setDialog({ open: true })}>
          + Injury
        </button>
      </div>

      {injuries.length === 0 ? (
        <p className="inj-empty">No injuries logged.</p>
      ) : (
        <div className="inj-list">
          {injuries.map((i) => {
            const linked = entries.filter((e) => e.injury_id === i.id && !e.deleted).length
            const injured = sessions.filter((s) => s.injury && s.date >= i.started_on).length
            return (
              <div key={i.id} className={`inj-card status-${i.status}`}>
                <div className="inj-card-head">
                  <span className="inj-area">{i.body_area}</span>
                  <span className={`inj-status-badge ${i.status}`}>{INJURY_STATUS_LABELS[i.status][lang]}</span>
                  <div className="inj-card-actions">
                    <button className="hist-link" type="button" onClick={() => setDialog({ open: true, injury: i })}>edit</button>
                    <button className="hist-link danger" type="button" onClick={() => remove(i.id)}>delete</button>
                  </div>
                </div>

                <div className="inj-meta">
                  <span>{lang === 'zh' ? '发病' : 'onset'}: {i.started_on} ({daysSince(i.started_on)}{lang === 'zh' ? '天前' : 'd ago'})</span>
                  {i.body_part && <span>{categoryLabel(i.body_part, lang)}</span>}
                  {i.severity != null && <span>{lang === 'zh' ? '严重度' : 'severity'} {i.severity}/5</span>}
                </div>

                {i.note_raw && <p className="inj-note">{i.note_raw}</p>}

                <div className="inj-status-switch" role="group" aria-label="status">
                  {INJURY_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`inj-status-opt ${i.status === s ? 'active' : ''}`}
                      onClick={() => setStatus(i.id, s)}
                    >
                      {INJURY_STATUS_LABELS[s][lang]}
                    </button>
                  ))}
                </div>

                <RehabTimeline injury={i} lang={lang} linkedEntries={linked} injuredSessions={injured} />
              </div>
            )
          })}
        </div>
      )}

      {dialog.open && (
        <AddInjuryDialog
          lang={lang}
          injury={dialog.injury}
          onSaved={() => {
            setDialog({ open: false })
            void reload()
          }}
          onClose={() => setDialog({ open: false })}
        />
      )}
    </div>
  )
}
