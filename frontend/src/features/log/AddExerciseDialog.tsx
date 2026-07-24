// Add-exercise dialog. Manual-first: you can always type the name(s), body part
// and measure type and create — no AI needed. "Suggest" is an optional helper that
// auto-fills the other-language name + classification when the backend/key is set.
// De-duplicates against the existing library on create.
import { useState } from 'react'
import { createExercise, withUndo } from '../../db'
import { useUndo } from '../../undo'
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
  onChanged,
  onClose,
}: {
  lang: TranslationTarget
  initialName?: string
  existing?: Exercise[]
  onCreated: (ex: Exercise) => void
  onChanged?: () => void
  onClose: () => void
}) {
  const { push } = useUndo()
  const startZh = HAS_CJK.test(initialName)
  const [raw, setRaw] = useState(initialName)
  const [nameZh, setNameZh] = useState(startZh ? initialName : '')
  const [nameEn, setNameEn] = useState(startZh ? '' : initialName)
  const cats = useCategories()
  const [bodyParts, setBodyParts] = useState<BodyPart[]>(['chest'])
  const toggleBodyPart = (k: BodyPart) =>
    setBodyParts((ps) => (ps.includes(k) ? ps.filter((p) => p !== k) : [...ps, k]))
  const [measureType, setMeasureType] = useState<MeasureType>('weight_reps')
  const [durationHm, setDurationHm] = useState(false)
  const [bodyweight, setBodyweight] = useState(false)
  const [assisted, setAssisted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  async function onSuggest() {
    if (!raw.trim()) return
    setBusy(true)
    setHint(null)
    const s = await suggestExercise(raw)
    if (s.name_zh) setNameZh(s.name_zh)
    if (s.name_en) setNameEn(s.name_en)
    if (s.body_part) setBodyParts((ps) => (ps.includes(s.body_part!) ? ps : [...ps, s.body_part!]))
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
    const { result: ex, undo } = await withUndo(['exercises'], () => createExercise({
      name_zh: zh,
      name_en: en,
      body_parts: bodyParts,
      measure_type: measureType,
      duration_hm: durationHm,
      bodyweight,
      assisted: measureType === 'weight_reps' ? assisted : false,
      is_custom: true,
      needs_translation: !zh || !en,
    }))
    setBusy(false)
    onCreated(ex)
    push(lang === 'zh' ? `已新建「${zh || en}」` : `Added “${en || zh}”`, async () => { await undo(); onChanged?.() })
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
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '部位(可多选)' : 'Body parts (multi)'}</label>
          <div className="log-cat-pick">
            {cats.map((c) => (
              <button key={c.key} type="button" className={`log-cat ${bodyParts.includes(c.key) ? 'on' : ''}`} onClick={() => toggleBodyPart(c.key)}>
                {categoryLabel(c.key, lang)}
              </button>
            ))}
          </div>
        </div>
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '类型' : 'Measure'}</label>
          <select className="th-input" value={measureType} onChange={(e) => { const v = e.target.value as MeasureType; setMeasureType(v); setBodyweight(v !== 'weight_reps') }}>
            {MEASURE_TYPES.map((mt) => (<option key={mt} value={mt}>{MEASURE_TYPE_LABELS[mt][lang]}</option>))}
          </select>
        </div>
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '类型' : 'Kind'}</label>
          <select className="th-input" value={bodyweight ? 'bodyweight' : 'gym'} onChange={(e) => setBodyweight(e.target.value === 'bodyweight')}>
            <option value="gym">{lang === 'zh' ? '健身房 (上重量)' : 'Gym (weighted)'}</option>
            <option value="bodyweight">{lang === 'zh' ? '徒手健身' : 'Bodyweight'}</option>
          </select>
        </div>
        {measureType === 'weight_reps' && (
          <label className="log-perside">
            <input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} />
            {lang === 'zh' ? '助力器械（重量越小越强，如助力引体）' : 'Assisted (less weight = stronger, e.g. assisted pull-up)'}
          </label>
        )}
        {measureType === 'duration' && (
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '时长格式' : 'Duration format'}</label>
            <select className="th-input" value={durationHm ? 'hm' : 'ms'} onChange={(e) => setDurationHm(e.target.value === 'hm')}>
              <option value="ms">{lang === 'zh' ? '分:秒 (mm:ss)' : 'mm:ss'}</option>
              <option value="hm">{lang === 'zh' ? '时:分 (hh:mm)' : 'hh:mm'}</option>
            </select>
          </div>
        )}

        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={onCreate} disabled={busy || bodyParts.length === 0 || (!nameZh.trim() && !nameEn.trim())}>
            {lang === 'zh' ? '创建' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
