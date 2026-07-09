// Edit an existing exercise (name / body part / measure type), merge it into
// another, or delete it. Renames reflect everywhere automatically because History
// and charts render exercises by id — no separate "sync to history" step needed.
import { useEffect, useState } from 'react'
import { updateExercise, softDeleteExercise, mergeExercises, exerciseUsage, withUndo } from '../../db'
import { useUndo } from '../../undo'
import {
  MEASURE_TYPE_LABELS,
  type BodyPart,
  type Exercise,
  type MeasureType,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'
import { exerciseKind, sortExercises } from './util'
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
  onSaved: () => Promise<void> | void
  onClose: () => void
}) {
  const cats = useCategories()
  const { push } = useUndo()
  const [nameZh, setNameZh] = useState(exercise.name_zh)
  const [nameEn, setNameEn] = useState(exercise.name_en)
  const [bodyParts, setBodyParts] = useState<BodyPart[]>(exercise.body_parts)
  const toggleBodyPart = (k: BodyPart) =>
    setBodyParts((ps) => (ps.includes(k) ? ps.filter((p) => p !== k) : [...ps, k]))
  const [measureType, setMeasureType] = useState<MeasureType>(exercise.measure_type)
  const [perSide, setPerSide] = useState(exercise.default_per_side ?? false)
  const [durationHm, setDurationHm] = useState(exercise.duration_hm ?? false)
  const [bodyweight, setBodyweight] = useState(exerciseKind(exercise) === 'bodyweight')
  const [mergeTarget, setMergeTarget] = useState('')
  const [usage, setUsage] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void exerciseUsage(exercise.id).then(setUsage)
  }, [exercise.id])

  const catOrder = cats.map((c) => c.key)
  const others = sortExercises(allExercises.filter((e) => e.id !== exercise.id && !e.deleted), lang, catOrder)
  const mergeGroups = cats
    .map((c) => ({ cat: c, items: others.filter((e) => e.body_parts[0] === c.key) }))
    .filter((g) => g.items.length > 0)
  const ungrouped = others.filter((e) => !cats.some((c) => e.body_parts[0] === c.key))
  const exName = (e: Exercise) => (lang === 'zh' ? e.name_zh : e.name_en) || e.name_zh || e.name_en

  async function onSave() {
    setBusy(true)
    const { undo } = await withUndo(['exercises'], () => updateExercise(exercise.id, {
      name_zh: nameZh.trim(),
      name_en: nameEn.trim(),
      body_parts: bodyParts,
      measure_type: measureType,
      default_per_side: perSide,
      duration_hm: durationHm,
      bodyweight,
      name_locked: true,
    }))
    setBusy(false)
    await onSaved()
    push(lang === 'zh' ? `已保存「${exName(exercise)}」` : `Saved “${exName(exercise)}”`, async () => { await undo(); await onSaved() })
  }
  async function onMerge() {
    if (!mergeTarget) return
    if (!confirm(lang === 'zh' ? '合并后本动作的所有记录会归到目标动作,本动作删除。继续?' : 'All records move to the target and this exercise is removed. Continue?')) return
    setBusy(true)
    const { undo } = await withUndo(['exercises', 'workout_entries'], () => mergeExercises(exercise.id, mergeTarget))
    setBusy(false)
    await onSaved()
    push(lang === 'zh' ? `已合并「${exName(exercise)}」` : `Merged “${exName(exercise)}”`, async () => { await undo(); await onSaved() })
  }
  async function onDelete() {
    const msg = usage
      ? lang === 'zh' ? `该动作有 ${usage} 条记录。删除后，这些记录会显示为“已删除动作”。仍然删除？` : `${usage} records reference this exercise. They will show as “deleted exercise”. Delete anyway?`
      : lang === 'zh' ? '删除该动作?' : 'Delete this exercise?'
    if (!confirm(msg)) return
    setBusy(true)
    const { undo } = await withUndo(['exercises'], () => softDeleteExercise(exercise.id))
    setBusy(false)
    await onSaved()
    push(lang === 'zh' ? `已删除「${exName(exercise)}」` : `Deleted “${exName(exercise)}”`, async () => { await undo(); await onSaved() })
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
          <select className="th-input" value={measureType} onChange={(e) => setMeasureType(e.target.value as MeasureType)}>
            {MEASURE_TYPES.map((mt) => (<option key={mt} value={mt}>{MEASURE_TYPE_LABELS[mt][lang]}</option>))}
          </select>
        </div>
        {measureType === 'duration' && (
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '时长格式' : 'Duration format'}</label>
            <select className="th-input" value={durationHm ? 'hm' : 'ms'} onChange={(e) => setDurationHm(e.target.value === 'hm')}>
              <option value="ms">{lang === 'zh' ? '分:秒 (mm:ss)' : 'mm:ss'}</option>
              <option value="hm">{lang === 'zh' ? '时:分 (hh:mm)' : 'hh:mm'}</option>
            </select>
          </div>
        )}

        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '类型' : 'Kind'}</label>
          <select className="th-input" value={bodyweight ? 'bodyweight' : 'gym'} onChange={(e) => setBodyweight(e.target.value === 'bodyweight')}>
            <option value="gym">{lang === 'zh' ? '健身房 (上重量)' : 'Gym (weighted)'}</option>
            <option value="bodyweight">{lang === 'zh' ? '徒手健身' : 'Bodyweight'}</option>
          </select>
        </div>

        <label className="log-perside">
          <input type="checkbox" checked={perSide} onChange={(e) => setPerSide(e.target.checked)} />
          {lang === 'zh' ? '默认每侧记录（录入时自动勾选）' : 'Per-side by default'}
        </label>

        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '合并到(它们其实是同一个动作)' : 'Merge into (same exercise)'}</label>
          <div className="log-row">
            <select className="th-input" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">{lang === 'zh' ? '选择目标动作…' : 'Select target exercise…'}</option>
              {mergeGroups.map((g) => (
                <optgroup key={g.cat.key} label={categoryLabel(g.cat.key, lang)}>
                  {g.items.map((e) => (<option key={e.id} value={e.id}>{exName(e)} · {MEASURE_TYPE_LABELS[e.measure_type][lang]}</option>))}
                </optgroup>
              ))}
              {ungrouped.length > 0 && (
                <optgroup label={lang === 'zh' ? '其他' : 'Other'}>
                  {ungrouped.map((e) => (<option key={e.id} value={e.id}>{exName(e)} · {MEASURE_TYPE_LABELS[e.measure_type][lang]}</option>))}
                </optgroup>
              )}
            </select>
            <button className="th-btn-ghost log-suggest" type="button" onClick={onMerge} disabled={busy || !mergeTarget}>
              {lang === 'zh' ? '合并' : 'Merge'}
            </button>
          </div>
        </div>

        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onDelete} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || bodyParts.length === 0 || (!nameZh.trim() && !nameEn.trim())}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
