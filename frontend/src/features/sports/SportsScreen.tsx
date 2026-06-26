// Sports tab (SPEC §7.4): pick a sport (frisbee by default; manage the library
// here) → log a session (date, tier 1–4, hours, injury) → per-sport mini-charts.
import { useEffect, useState } from 'react'
import {
  ensureDefaultSport,
  getSports,
  getSportSessions,
  createSportSession,
  softDeleteSport,
  softDeleteSportSession,
  today,
} from '../../db'
import { useLanguage } from '../../i18n'
import type { Sport, SportSession, TierLevel } from '../../supabase/types'
import { AddSportDialog } from './AddSportDialog'
import { SportCharts } from './SportCharts'
import { sportName, tierLabel } from './util'
import './sports.css'

export function SportsScreen() {
  const { lang } = useLanguage()
  const [sports, setSports] = useState<Sport[]>([])
  const [sessions, setSessions] = useState<SportSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; sport?: Sport }>({ open: false })

  // session form
  const [date, setDate] = useState(today())
  const [tier, setTier] = useState<TierLevel>(1)
  const [hours, setHours] = useState('')
  const [injury, setInjury] = useState(false)
  const [estimated, setEstimated] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const list = await ensureDefaultSport()
      setSports(list)
      setSelectedId((prev) => prev ?? list.find((s) => s.is_default)?.id ?? list[0]?.id ?? null)
      setSessions(await getSportSessions())
    })()
  }, [])

  const selected = sports.find((s) => s.id === selectedId) ?? null
  const sessionsForSport = sessions.filter((s) => s.sport_id === selectedId)

  async function reloadSports(selectId?: string) {
    const list = await getSports()
    setSports(list)
    setSelectedId(selectId ?? list.find((s) => s.id === selectedId)?.id ?? list[0]?.id ?? null)
  }

  async function onSave() {
    if (!selected) return
    const h = Number(hours)
    if (!Number.isFinite(h) || h <= 0) return
    setSaving(true)
    await createSportSession({
      date,
      sport_id: selected.id,
      tier,
      hours: h,
      injury,
      estimated,
      note_raw: note,
    })
    setSessions(await getSportSessions())
    setHours('')
    setNote('')
    setInjury(false)
    setEstimated(false)
    setSaving(false)
  }

  async function onDeleteSport() {
    if (!selected || sports.length <= 1) return
    if (!confirm(`Delete sport “${sportName(selected, lang)}”?`)) return
    await softDeleteSport(selected.id)
    await reloadSports()
  }

  async function onDeleteSession(id: string) {
    await softDeleteSportSession(id)
    setSessions(await getSportSessions())
  }

  return (
    <div className="sport-screen">
      <div className="sport-bar">
        <div className="sport-chips">
          {sports.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`log-chip ${s.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              {sportName(s, lang)}
            </button>
          ))}
        </div>
        <div className="sport-bar-actions">
          {selected && (
            <button className="hist-link" type="button" onClick={() => setDialog({ open: true, sport: selected })}>edit</button>
          )}
          {selected && sports.length > 1 && (
            <button className="hist-link danger" type="button" onClick={onDeleteSport}>delete</button>
          )}
          <button className="th-btn-ghost sport-add" type="button" onClick={() => setDialog({ open: true })}>+ Sport</button>
        </div>
      </div>

      {selected && (
        <section className="sport-form">
          <div className="sport-grid2">
            <div className="sport-field">
              <label className="th-label" htmlFor="sp-date">Date</label>
              <input id="sp-date" className="th-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="sport-field">
              <label className="th-label" htmlFor="sp-tier">Tier</label>
              <select id="sp-tier" className="th-input" value={tier} onChange={(e) => setTier(Number(e.target.value) as TierLevel)}>
                {[1, 2, 3, 4].map((t) => (
                  <option key={t} value={t}>{t} · {tierLabel(selected, t, lang)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="sport-grid2">
            <div className="sport-field">
              <label className="th-label" htmlFor="sp-hours">Hours</label>
              <input id="sp-hours" className="th-input" inputMode="decimal" value={hours}
                onChange={(e) => setHours(e.target.value)} placeholder="e.g. 2" />
            </div>
            <div className="sport-toggles">
              <label className="sport-toggle">
                <input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} />
                {lang === 'zh' ? '伤病' : 'injury'}
              </label>
              <label className="sport-toggle">
                <input type="checkbox" checked={estimated} onChange={(e) => setEstimated(e.target.checked)} />
                {lang === 'zh' ? '估算' : 'estimated'}
              </label>
            </div>
          </div>

          <div className="sport-field">
            <label className="th-label" htmlFor="sp-note">Note</label>
            <input id="sp-note" className="th-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <button className="th-btn" type="button" onClick={onSave} disabled={saving || !hours}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存场次' : 'Save session'}
          </button>
        </section>
      )}

      {selected && <SportCharts sport={selected} sessions={sessionsForSport} lang={lang} />}

      {sessionsForSport.length > 0 && selected && (
        <section className="sport-list">
          <span className="th-label">Recent sessions</span>
          <ul>
            {sessionsForSport.slice(0, 20).map((s) => (
              <li key={s.id} className="sport-list-item">
                <span className="sport-li-date">{s.date}</span>
                <span className="sport-li-tier">{tierLabel(selected, s.tier, lang)}</span>
                <span className="sport-li-hours">{s.hours}h</span>
                {s.injury && <span className="sport-li-injury">injury</span>}
                {s.estimated && <span className="sport-li-est">est.</span>}
                <button className="hist-link danger" type="button" onClick={() => onDeleteSession(s.id)}>delete</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog.open && (
        <AddSportDialog
          lang={lang}
          sport={dialog.sport}
          onSaved={(s) => {
            setDialog({ open: false })
            void reloadSports(s.id)
          }}
          onClose={() => setDialog({ open: false })}
        />
      )}
    </div>
  )
}
