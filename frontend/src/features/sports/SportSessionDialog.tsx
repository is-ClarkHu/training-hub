// Edit / delete one sport session (opened from History). Duration is h:mm; the
// sport's custom fields render dynamically; injury + note editable.
import { useState } from 'react'
import { updateSportSession, softDeleteSportSession } from '../../db'
import type { Sport, SportSession } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { fieldLabel } from './util'
import { parseHours, formatHours } from '../log/util'
import './sports.css'

export function SportSessionDialog({
  lang,
  sport,
  session,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  sport: Sport | undefined
  session: SportSession
  onSaved: () => void
  onClose: () => void
}) {
  const [date, setDate] = useState(session.date)
  const [hours, setHours] = useState(formatHours(session.hours))
  const [attrs, setAttrs] = useState<Record<string, string>>({ ...(session.attributes ?? {}) })
  const [injury, setInjury] = useState(session.injury)
  const [note, setNote] = useState(session.note_raw)
  const [busy, setBusy] = useState(false)

  async function save() {
    const h = parseHours(hours)
    if (!h || h <= 0) return
    setBusy(true)
    await updateSportSession(session.id, { date, hours: h, attributes: attrs, injury, note_raw: note })
    setBusy(false)
    onSaved()
  }
  async function remove() {
    if (!confirm(lang === 'zh' ? '删除这条运动记录?' : 'Delete this session?')) return
    setBusy(true)
    await softDeleteSportSession(session.id)
    setBusy(false)
    onSaved()
  }

  const name = sport ? (lang === 'zh' ? sport.name_zh : sport.name_en) || sport.name_zh : '(sport)'

  return (
    <div className="sport-dialog-backdrop" onClick={onClose}>
      <div className="sport-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>🏃 {name}</h3>

        <div className="sport-grid2">
          <div className="sport-field">
            <label className="th-label">{lang === 'zh' ? '日期' : 'Date'}</label>
            <input className="th-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="sport-field">
            <label className="th-label">{lang === 'zh' ? '时长 (时:分)' : 'Duration (h:mm)'}</label>
            <input className="th-input" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1:30" />
          </div>
        </div>

        {(sport?.fields ?? []).map((f) => (
          <div key={f.key} className="sport-field">
            <label className="th-label">{fieldLabel(f, lang)}</label>
            {f.type === 'select' ? (
              <select className="th-input" value={attrs[f.key] ?? ''} onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => (<option key={o.value} value={o.value}>{lang === 'zh' ? o.zh : o.en}</option>))}
              </select>
            ) : (
              <input className="th-input" type={f.type === 'number' ? 'number' : 'text'} value={attrs[f.key] ?? ''}
                onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))} />
            )}
          </div>
        ))}

        <label className="log-perside">
          <input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} />
          {lang === 'zh' ? '带伤' : 'injury'}
        </label>

        <div className="sport-field">
          <label className="th-label">{lang === 'zh' ? '笔记' : 'Note'}</label>
          <input className="th-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="sport-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={remove} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
          <button className="th-btn" type="button" onClick={save} disabled={busy}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
