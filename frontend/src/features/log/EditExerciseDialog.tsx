// Edit an existing exercise (name / body part / measure type), merge it into
// another, or delete it. Renames reflect everywhere automatically because History
// and charts render exercises by id — no separate "sync to history" step needed.
import { useEffect, useState } from 'react'
import { updateExercise, softDeleteExercise, mergeExercises, exerciseUsage } from '../../db'
import {
  BODY_PARTS,
  BODY_PART_LABELS,
  MEASURE_TYPE_LABELS,
  type BodyPart,
  type Exercise,
  type MeasureType,
} from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import './log.css'

const MEASURE_TYPES: MeasureType[] = ['weight_reps', 'reps_only', 'duration']

export function EditExerciseDialog({
  lang,
  exercise,
  allExercises,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  exercise: Exercise
  allExercises: Exercise[]
  onSaved: () => void
  onClose: () => void
}) {
  const [nameZh, setNameZh] = useState(exercise.name_zh)
  const [nameEn, setNameEn] = useState(exercise.name_en)
  const [bodyPart, setBodyPart] = useState<BodyPart>(exercise.body_part)
  const [measureType, setMeasureType] = useState<MeasureType>(exercise.measure_type)
  const [perSide, setPerSide] = useState(exercise.default_per_side ?? false)
  const [mergeTarget, setMergeTarget] = useState('')
  const [usage, setUsage] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void exerciseUsage(exercise.id).then(setUsage)
  }, [exercise.id])

  const others = allExercises.filter((e) => e.id !== exercise.id)
  const exName = (e: Exercise) => (lang === 'zh' ? e.name_zh : e.name_en) || e.name_zh || e.name_en

  async function onSave() {
    setBusy(true)
    await updateExercise(exercise.id, {
      name_zh: nameZh.trim(),
      name_en: nameEn.trim(),
      body_part: bodyPart,
      measure_type: measureType,
      default_per_side: perSide,
      name_locked: true,
    })
    setBusy(false)
    onSaved()
  }
  async function onMerge() {
    if (!mergeTarget) return
    if (!confirm(lang === 'zh' ? '合并后本动作的所有记录会归到目标动作,本动作删除。继续?' : 'All records move to the target and this exercise is removed. Continue?')) return
    setBusy(true)
    await mergeExercises(exercise.id, mergeTarget)
    setBusy(false)
    onSaved()
  }
  async function onDelete() {
    const msg = usage
      ? lang === 'zh' ? `该动作有 ${usage} 条记录,删除后它们会显示为"已删除动作"。仍删除?` : `${usage} records reference this; they'll show as “deleted”. Delete anyway?`
      : lang === 'zh' ? '删除该动作?' : 'Delete this exercise?'
    if (!confirm(msg)) return
    setBusy(true)
    await softDeleteExercise(exercise.id)
    setBusy(false)
    onSaved()
  }

  return (
    <div className="log-dialog-backdrop" onClick={onClose}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '编辑动作' : 'Edit exercise'}{usage != null && <small className="log-usage"> · {usage} {lang === 'zh' ? '条记录' : 'records'}</small>}</h3>

        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">中文名</label>
            <input className="th-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
          </div>
          <div className="log-field">
            <label className="th-label">English</label>
            <input className="th-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
        </div>
        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '部位' : 'Body part'}</label>
            <select className="th-input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart)}>
              {BODY_PARTS.map((bp) => (<option key={bp} value={bp}>{BODY_PART_LABELS[bp][lang]}</option>))}
            </select>
          </div>
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '类型' : 'Measure'}</label>
            <select className="th-input" value={measureType} onChange={(e) => setMeasureType(e.target.value as MeasureType)}>
              {MEASURE_TYPES.map((mt) => (<option key={mt} value={mt}>{MEASURE_TYPE_LABELS[mt][lang]}</option>))}
            </select>
          </div>
        </div>

        <label className="log-perside">
          <input type="checkbox" checked={perSide} onChange={(e) => setPerSide(e.target.checked)} />
          {lang === 'zh' ? '默认每侧(录入时自动勾选)' : 'per-side by default (prefills the toggle)'}
        </label>

        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '合并到(它们其实是同一个动作)' : 'Merge into (same exercise)'}</label>
          <div className="log-row">
            <select className="th-input" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">{lang === 'zh' ? '选择目标动作…' : 'pick target…'}</option>
              {others.map((e) => (<option key={e.id} value={e.id}>{exName(e)}</option>))}
            </select>
            <button className="th-btn-ghost log-suggest" type="button" onClick={onMerge} disabled={busy || !mergeTarget}>
              {lang === 'zh' ? '合并' : 'Merge'}
            </button>
          </div>
        </div>

        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onDelete} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || (!nameZh.trim() && !nameEn.trim())}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
