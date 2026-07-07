// Add / edit an injury (SPEC §4.8, §6A): body area, onset, status, optional
// severity, bilingual note.
import { useState } from 'react'
import { createInjury, updateInjury, today } from '../../db'
import {
  type BodyPart,
  type Injury,
  type InjuryStatus,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'
import { INJURY_STATUSES, INJURY_STATUS_LABELS } from './util'

export function AddInjuryDialog({
  lang,
  injury,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  injury?: Injury
  onSaved: () => void
  onClose: () => void
}) {
  const editing = !!injury
  const cats = useCategories()
  const [bodyArea, setBodyArea] = useState(injury?.body_area ?? '')
  const [bodyPart, setBodyPart] = useState<BodyPart | ''>(injury?.body_part ?? '')
  const [startedOn, setStartedOn] = useState(injury?.started_on ?? today())
  const [status, setStatus] = useState<InjuryStatus>(injury?.status ?? 'acute')
  const [severity, setSeverity] = useState<number | ''>(injury?.severity ?? '')
  const [note, setNote] = useState(injury?.note_raw ?? '')
  const [busy, setBusy] = useState(false)

  async function onSave() {
    if (!bodyArea.trim()) return
    setBusy(true)
    const fields = {
      body_area: bodyArea.trim(),
      body_part: bodyPart || null,
      started_on: startedOn,
      status,
      severity: severity === '' ? null : Number(severity),
      note_raw: note,
    }
    if (injury) await updateInjury(injury.id, fields)
    else await createInjury(fields)
    setBusy(false)
    onSaved()
  }

  return (
    <div className="inj-dialog-backdrop" onClick={onClose}>
      <div className="inj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Edit injury' : 'Add injury'}</h3>

        <div className="inj-field">
          <label className="th-label" htmlFor="inj-area">Body area</label>
          <input id="inj-area" className="th-input" value={bodyArea} onChange={(e) => setBodyArea(e.target.value)}
            placeholder={lang === 'zh' ? '例如 左腿后侧 / left hamstring' : 'e.g. left hamstring'} autoFocus />
        </div>

        <div className="inj-grid2">
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-bp">Body part (optional)</label>
            <select id="inj-bp" className="th-input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart | '')}>
              <option value="">—</option>
              {cats.map((c) => (
                <option key={c.key} value={c.key}>{categoryLabel(c.key, lang)}</option>
              ))}
            </select>
          </div>
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-date">Onset date</label>
            <input id="inj-date" className="th-input" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>
        </div>

        <div className="inj-grid2">
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-status">Status</label>
            <select id="inj-status" className="th-input" value={status} onChange={(e) => setStatus(e.target.value as InjuryStatus)}>
              {INJURY_STATUSES.map((s) => (
                <option key={s} value={s}>{INJURY_STATUS_LABELS[s][lang]}</option>
              ))}
            </select>
          </div>
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-sev">Severity (1–5)</label>
            <select id="inj-sev" className="th-input" value={severity} onChange={(e) => setSeverity(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="inj-field">
          <label className="th-label" htmlFor="inj-note">Note</label>
          <input id="inj-note" className="th-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="inj-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || !bodyArea.trim()}>
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
