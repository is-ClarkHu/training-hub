// Add-exercise dialog. Manual-first: you can always type the name(s), body part
// and measure type and create — no AI needed. "Suggest" is an optional helper that
// auto-fills the other-language name + classification when the backend/key is set.
// De-duplicates against the existing library on create.
import { useState } from 'react'
import { createExercise } from '../../db'
import { suggestExercise } from '../../translation'
import {
  MEASURE_TYPE_LABELS,
  type BodyPart,
  type Exercise,
  type MeasureType,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'

const MEASURE_TYPES: MeasureType[] = ['weight_reps', 'reps_only', 'duration']
const HAS_CJK = /[一-鿿]/
const norm = (s: string) => s.trim().toLowerCase()

export function AddExerciseDialog({
  lang,
  initialName = '',
  existing = [],
  onCreated,
  onClose,
}: {
  lang: TranslationTarget
  initialName?: string
  existing?: Exercise[]
  onCreated: (ex: Exercise) => void
  onClose: () => void
}) {
  const startZh = HAS_CJK.test(initialName)
  const [raw, setRaw] = useState(initialName)
  const [nameZh, setNameZh] = useState(startZh ? initialName : '')
  const [nameEn, setNameEn] = useState(startZh ? '' : initialName)
  const cats = useCategories()
  const [bodyPart, setBodyPart] = useState<BodyPart>('chest')
  const [measureType, setMeasureType] = useState<MeasureType>('weight_reps')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  async function onSuggest() {
    if (!raw.trim()) return
    setBusy(true)
    setHint(null)
    const s = await suggestExercise(raw)
    if (s.name_zh) setNameZh(s.name_zh)
    if (s.name_en) setNameEn(s.name_en)
    if (s.body_part) setBodyPart(s.body_part)
    if (s.measure_type) setMeasureType(s.measure_type)
    if (s.needsTranslation) {
      setHint(lang === 'zh' ? '自动翻译暂不可用(填 key + 跑后端可启用),手动填另一名即可。' : 'Auto-translate unavailable (set a key + run the backend). Fill the other name manually.')
    }
    setBusy(false)
  }

  async function onCreate() {
    const zh = nameZh.trim()
    const en = nameEn.trim()
    if (!zh && !en) return
    const dup = existing.find(
      (e) => (zh && norm(e.name_zh) === norm(zh)) || (en && norm(e.name_en) === norm(en)),
    )
    if (dup) {
      if (confirm(lang === 'zh' ? '库里已有同名动作,直接用它?' : 'An exercise with this name exists — use it?')) onCreated(dup)
      return
    }
    setBusy(true)
    const ex = await createExercise({
      name_zh: zh,
      name_en: en,
      body_part: bodyPart,
      measure_type: measureType,
      is_custom: true,
      needs_translation: !zh || !en,
    })
    setBusy(false)
    onCreated(ex)
  }

  return (
    <div className="log-dialog-backdrop" onClick={onClose}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '添加动作' : 'Add exercise'}</h3>

        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '自动翻译(可选)' : 'Auto-translate (optional)'}</label>
          <div className="log-row">
            <input className="th-input" value={raw} onChange={(e) => setRaw(e.target.value)}
              placeholder={lang === 'zh' ? '输中/英名后点 Suggest' : 'type a name, then Suggest'} />
            <button className="th-btn-ghost log-suggest" type="button" onClick={onSuggest} disabled={busy || !raw.trim()}>
              {busy ? '…' : 'Suggest'}
            </button>
          </div>
          {hint && <p className="log-hint">{hint}</p>}
        </div>

        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">中文名</label>
            <input className="th-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} autoFocus />
          </div>
          <div className="log-field">
            <label className="th-label">English name</label>
            <input className="th-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
        </div>
        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '部位' : 'Body part'}</label>
            <select className="th-input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart)}>
              {cats.map((c) => (<option key={c.key} value={c.key}>{categoryLabel(c.key, lang)}</option>))}
            </select>
          </div>
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '类型' : 'Measure'}</label>
            <select className="th-input" value={measureType} onChange={(e) => setMeasureType(e.target.value as MeasureType)}>
              {MEASURE_TYPES.map((mt) => (<option key={mt} value={mt}>{MEASURE_TYPE_LABELS[mt][lang]}</option>))}
            </select>
          </div>
        </div>

        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="th-btn" type="button" onClick={onCreate} disabled={busy || (!nameZh.trim() && !nameEn.trim())}>
            {lang === 'zh' ? '创建' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
