// Add-new-exercise flow (SPEC §7.1): user types the name in Chinese or English →
// the translation subsystem proposes the other name + body_part + measure_type →
// user confirms (and may edit) → a library row is created and the dictionary grows.
import { useState } from 'react'
import { createExercise } from '../../db'
import { suggestExercise } from '../../translation'
import {
  BODY_PARTS,
  BODY_PART_LABELS,
  MEASURE_TYPE_LABELS,
  type BodyPart,
  type Exercise,
  type MeasureType,
} from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

const MEASURE_TYPES: MeasureType[] = ['weight_reps', 'reps_only', 'duration']

export function AddExerciseDialog({
  lang,
  initialName = '',
  onCreated,
  onClose,
}: {
  lang: TranslationTarget
  initialName?: string
  onCreated: (ex: Exercise) => void
  onClose: () => void
}) {
  const [raw, setRaw] = useState(initialName)
  const [nameZh, setNameZh] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [bodyPart, setBodyPart] = useState<BodyPart>('chest')
  const [measureType, setMeasureType] = useState<MeasureType>('weight_reps')
  const [proposed, setProposed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function onSuggest() {
    if (!raw.trim()) return
    setBusy(true)
    setNote(null)
    const s = await suggestExercise(raw)
    setNameZh(s.name_zh)
    setNameEn(s.name_en)
    if (s.body_part) setBodyPart(s.body_part)
    if (s.measure_type) setMeasureType(s.measure_type)
    setProposed(true)
    if (s.needsTranslation) {
      setNote('Offline or translation unavailable — fill the other name manually.')
    }
    setBusy(false)
  }

  async function onCreate() {
    if (!nameZh.trim() && !nameEn.trim()) return
    setBusy(true)
    const ex = await createExercise({
      name_zh: nameZh.trim(),
      name_en: nameEn.trim(),
      body_part: bodyPart,
      measure_type: measureType,
      is_custom: true,
      needs_translation: !nameZh.trim() || !nameEn.trim(),
    })
    setBusy(false)
    onCreated(ex)
  }

  return (
    <div className="log-dialog-backdrop" onClick={onClose}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add exercise</h3>

        <div className="log-field">
          <label className="th-label" htmlFor="ex-raw">Name (Chinese or English)</label>
          <div className="log-row">
            <input
              id="ex-raw"
              className="th-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={lang === 'zh' ? '例如 牧师凳弯举' : 'e.g. 牧师凳弯举'}
              autoFocus
            />
            <button className="th-btn-ghost log-suggest" type="button" onClick={onSuggest} disabled={busy || !raw.trim()}>
              {busy ? '…' : 'Suggest'}
            </button>
          </div>
        </div>

        {proposed && (
          <>
            <div className="log-grid2">
              <div className="log-field">
                <label className="th-label" htmlFor="ex-zh">中文名</label>
                <input id="ex-zh" className="th-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
              </div>
              <div className="log-field">
                <label className="th-label" htmlFor="ex-en">English name</label>
                <input id="ex-en" className="th-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
            </div>
            <div className="log-grid2">
              <div className="log-field">
                <label className="th-label" htmlFor="ex-bp">Body part</label>
                <select id="ex-bp" className="th-input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart)}>
                  {BODY_PARTS.map((bp) => (
                    <option key={bp} value={bp}>{BODY_PART_LABELS[bp][lang]}</option>
                  ))}
                </select>
              </div>
              <div className="log-field">
                <label className="th-label" htmlFor="ex-mt">Measure</label>
                <select id="ex-mt" className="th-input" value={measureType} onChange={(e) => setMeasureType(e.target.value as MeasureType)}>
                  {MEASURE_TYPES.map((mt) => (
                    <option key={mt} value={mt}>{MEASURE_TYPE_LABELS[mt][lang]}</option>
                  ))}
                </select>
              </div>
            </div>
            {note && <p className="th-error">{note}</p>}
          </>
        )}

        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="th-btn" type="button" onClick={onCreate} disabled={busy || !proposed || (!nameZh.trim() && !nameEn.trim())}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
