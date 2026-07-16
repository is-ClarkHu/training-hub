// Injuries tab (SPEC §6A): active-injury banner + injury log (CRUD, status
// transitions acute→rehab→recovered) + per-injury rehab timeline.
import { useCallback, useEffect, useState } from 'react'
import {
  getInjuries,
  getEntries,
  getSportSessions,
  updateInjury,
  softDeleteInjury,
  resolveInjuryPhotoUrls,
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
import { RehabLoop } from './RehabLoop'
import { RehabTimeline } from './RehabTimeline'
import { RehabLibrary } from './RehabLibrary'
import {
  INJURY_LATERALITY_LABELS,
  INJURY_SCENARIO_LABELS,
  INJURY_STATUSES,
  INJURY_STATUS_LABELS,
  INJURY_TYPE_LABELS,
  bodyAreaLabel,
  daysSince,
} from './util'
import './injuries.css'

export function InjuriesScreen() {
  const { lang } = useLanguage()
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [sessions, setSessions] = useState<SportSession[]>([])
  const [dialog, setDialog] = useState<{ open: boolean; injury?: Injury }>({ open: false })
  const [loading, setLoading] = useState(true)
  const [showLibrary, setShowLibrary] = useState(false)
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [inj, ents, sess] = await Promise.all([getInjuries(), getEntries(), getSportSessions()])
    setInjuries(inj)
    setEntries(ents)
    setSessions(sess)
    const photoRefs = inj.flatMap((i) => i.attachments.filter((a) => a.kind === 'photo' && a.photo_id))
    setPhotoMap(await resolveInjuryPhotoUrls(photoRefs))
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
      <RehabLoop lang={lang} />

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
                  <span className="inj-area">{bodyAreaLabel(i, lang)}</span>
                  <span className={`inj-status-badge ${i.status}`}>{INJURY_STATUS_LABELS[i.status][lang]}</span>
                  <div className="inj-card-actions">
                    <button className="hist-link" type="button" onClick={() => setDialog({ open: true, injury: i })}>edit</button>
                    <button className="hist-link danger" type="button" onClick={() => remove(i.id)}>delete</button>
                  </div>
                </div>

                <div className="inj-meta">
                  <span>{lang === 'zh' ? '受伤' : 'onset'}: {i.started_on} ({daysSince(i.started_on)}{lang === 'zh' ? '天前' : 'd ago'})</span>
                  {i.laterality && <span>{INJURY_LATERALITY_LABELS[i.laterality][lang]}</span>}
                  {i.body_part && <span>{categoryLabel(i.body_part, lang)}</span>}
                  {i.injury_type && <span>{INJURY_TYPE_LABELS[i.injury_type][lang]}</span>}
                  {i.scenario && <span>{INJURY_SCENARIO_LABELS[i.scenario][lang]}</span>}
                  {i.severity != null && <span>{lang === 'zh' ? '严重度' : 'severity'} {i.severity}/5</span>}
                </div>

                {(lang === 'zh' ? i.note_zh : i.note_en) || i.note_raw ? (
                  <p className="inj-note">{(lang === 'zh' ? i.note_zh : i.note_en) || i.note_raw}</p>
                ) : null}

                {(() => {
                  const photos = i.attachments.filter((a) => a.kind === 'photo' && a.photo_id && photoMap[a.photo_id!])
                  if (photos.length === 0) return null
                  return (
                    <div className="inj-photos inj-photos-view">
                      {photos.map((a) => (
                        <button key={a.photo_id} type="button" className="inj-photo-thumb" onClick={() => setLightbox(photoMap[a.photo_id!])} title={a.label}>
                          <img src={photoMap[a.photo_id!]} alt={a.label || 'injury photo'} />
                        </button>
                      ))}
                    </div>
                  )
                })()}

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

      <div className="inj-lib-section">
        <button className="th-btn-ghost inj-lib-toggle" type="button" onClick={() => setShowLibrary((v) => !v)}>
          {showLibrary ? '▾ ' : '▸ '}{lang === 'zh' ? '康复动作库' : 'Rehab library'}
        </button>
        {showLibrary && <RehabLibrary lang={lang} />}
      </div>

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

      {lightbox && (
        <div className="inj-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="injury photo" />
        </div>
      )}
    </div>
  )
}
