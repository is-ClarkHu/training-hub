// Add / edit a rehab exercise (§6A Phase 2). A rehab move reuses the exercises
// table (is_rehab=true) but carries knowledge: purpose, cues/precautions (both
// bilingual, AI-translatable) and dosage. Name translation reuses suggestExercise.
import { useState } from 'react'
import { createExercise, updateExercise } from '../../db'
import {
  MEASURE_TYPE_LABELS,
  type BodyPart,
  type Exercise,
  type MeasureType,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import { suggestExercise, suggestInjuryNote, type TranslationTarget } from '../../translation'

const MEASURE_TYPES: MeasureType[] = ['weight_reps', 'reps_only', 'duration']
const HAS_CJK = /[一-鿿]/

export function RehabExerciseDialog({
  lang,
  exercise,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  exercise?: Exercise
  onSaved: () => void
  onClose: () => void
}) {
  const editing = !!exercise
  const cats = useCategories()
  const [nameZh, setNameZh] = useState(exercise?.name_zh ?? '')
  const [nameEn, setNameEn] = useState(exercise?.name_en ?? '')
  const [bodyPart, setBodyPart] = useState<BodyPart>(exercise?.body_part ?? cats[0]?.key ?? 'legs')
  const [measureType, setMeasureType] = useState<MeasureType>(exercise?.measure_type ?? 'reps_only')
  const [purposeZh, setPurposeZh] = useState(exercise?.rehab_purpose_zh ?? '')
  const [purposeEn, setPurposeEn] = useState(exercise?.rehab_purpose_en ?? '')
  const [cuesZh, setCuesZh] = useState(exercise?.rehab_cues_zh ?? '')
  const [cuesEn, setCuesEn] = useState(exercise?.rehab_cues_en ?? '')
  const [dosage, setDosage] = useState(exercise?.rehab_dosage ?? '')
  const [busy, setBusy] = useState(false)
  const [tName, setTName] = useState(false)
  const [tPurpose, setTPurpose] = useState(false)
  const [tCues, setTCues] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const OFFLINE_HINT = lang === 'zh'
    ? '自动翻译暂不可用(离线或未配 key),手动补另一语即可。'
    : 'Auto-translate unavailable (offline or no key). Fill the other language manually.'

  async function onTranslateName() {
    const src = (nameZh || nameEn).trim()
    if (!src) return
    setTName(true); setHint(null)
    const s = await suggestExercise(src)
    if (s.name_zh) setNameZh(s.name_zh)
    if (s.name_en) setNameEn(s.name_en)
    if (s.body_part) setBodyPart(s.body_part)
    if (s.measure_type) setMeasureType(s.measure_type)
    if (s.needsTranslation) setHint(OFFLINE_HINT)
    setTName(false)
  }

  async function onTranslatePurpose() {
    const src = (purposeZh || purposeEn).trim()
    if (!src) return
    setTPurpose(true); setHint(null)
    const s = await suggestInjuryNote(src)
    setPurposeZh(s.note_zh); setPurposeEn(s.note_en)
    if (s.needsTranslation) setHint(OFFLINE_HINT)
    setTPurpose(false)
  }

  async function onTranslateCues() {
    const src = (cuesZh || cuesEn).trim()
    if (!src) return
    setTCues(true); setHint(null)
    const s = await suggestInjuryNote(src)
    setCuesZh(s.note_zh); setCuesEn(s.note_en)
    if (s.needsTranslation) setHint(OFFLINE_HINT)
    setTCues(false)
  }

  const canSave = !!(nameZh.trim() || nameEn.trim())

  async function onSave() {
    if (!canSave) return
    setBusy(true)
    const zh = nameZh.trim()
    const en = nameEn.trim()
    const fields = {
      name_zh: zh,
      name_en: en,
      body_part: bodyPart,
      measure_type: measureType,
      rehab_purpose_zh: purposeZh.trim(),
      rehab_purpose_en: purposeEn.trim(),
      rehab_cues_zh: cuesZh.trim(),
      rehab_cues_en: cuesEn.trim(),
      rehab_dosage: dosage.trim(),
    }
    if (exercise) {
      await updateExercise(exercise.id, fields)
    } else {
      await createExercise({ ...fields, is_rehab: true, is_custom: true, needs_translation: !zh || !en })
    }
    setBusy(false)
    onSaved()
  }

  return (
    <div className="inj-dialog-backdrop" onClick={onClose}>
      <div className="inj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? (lang === 'zh' ? '编辑康复动作' : 'Edit rehab exercise') : (lang === 'zh' ? '添加康复动作' : 'Add rehab exercise')}</h3>

        <div className="inj-field">
          <div className="inj-note-head">
            <label className="th-label">{lang === 'zh' ? '动作名 (双语)' : 'Name (bilingual)'}</label>
            <button className="th-btn-ghost inj-translate" type="button" onClick={onTranslateName} disabled={tName || !canSave}>
              {tName ? '…' : (lang === 'zh' ? '翻译' : 'Translate')}
            </button>
          </div>
          <input className="th-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)}
            placeholder={lang === 'zh' ? '中文,如 直腿抬高' : 'Chinese, e.g. 直腿抬高'}
            autoFocus={!editing && !HAS_CJK.test(nameEn)} />
          <input className="th-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)}
            placeholder={lang === 'zh' ? '英文,如 Straight Leg Raise' : 'English, e.g. Straight Leg Raise'} />
        </div>

        <div className="inj-grid2">
          <div className="inj-field">
            <label className="th-label">{lang === 'zh' ? '部位' : 'Body part'}</label>
            <select className="th-input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart)}>
              {cats.map((c) => (<option key={c.key} value={c.key}>{categoryLabel(c.key, lang)}</option>))}
            </select>
          </div>
          <div className="inj-field">
            <label className="th-label">{lang === 'zh' ? '计量' : 'Measure'}</label>
            <select className="th-input" value={measureType} onChange={(e) => setMeasureType(e.target.value as MeasureType)}>
              {MEASURE_TYPES.map((mt) => (<option key={mt} value={mt}>{MEASURE_TYPE_LABELS[mt][lang]}</option>))}
            </select>
          </div>
        </div>

        <div className="inj-field">
          <div className="inj-note-head">
            <label className="th-label">{lang === 'zh' ? '作用 (双语)' : 'Purpose (bilingual)'}</label>
            <button className="th-btn-ghost inj-translate" type="button" onClick={onTranslatePurpose} disabled={tPurpose || (!purposeZh.trim() && !purposeEn.trim())}>
              {tPurpose ? '…' : (lang === 'zh' ? '翻译' : 'Translate')}
            </button>
          </div>
          <input className="th-input" value={purposeZh} onChange={(e) => setPurposeZh(e.target.value)}
            placeholder={lang === 'zh' ? '中文,如 强化股四头肌' : 'Chinese purpose'} />
          <input className="th-input" value={purposeEn} onChange={(e) => setPurposeEn(e.target.value)}
            placeholder={lang === 'zh' ? '英文' : 'English purpose'} />
        </div>

        <div className="inj-field">
          <div className="inj-note-head">
            <label className="th-label">{lang === 'zh' ? '要领 / 注意 (双语)' : 'Cues / precautions (bilingual)'}</label>
            <button className="th-btn-ghost inj-translate" type="button" onClick={onTranslateCues} disabled={tCues || (!cuesZh.trim() && !cuesEn.trim())}>
              {tCues ? '…' : (lang === 'zh' ? '翻译' : 'Translate')}
            </button>
          </div>
          <input className="th-input" value={cuesZh} onChange={(e) => setCuesZh(e.target.value)}
            placeholder={lang === 'zh' ? '中文要领/注意' : 'Chinese cues'} />
          <input className="th-input" value={cuesEn} onChange={(e) => setCuesEn(e.target.value)}
            placeholder={lang === 'zh' ? '英文要领/注意' : 'English cues'} />
        </div>

        <div className="inj-field">
          <label className="th-label">{lang === 'zh' ? '剂量建议' : 'Dosage'}</label>
          <input className="th-input" value={dosage} onChange={(e) => setDosage(e.target.value)}
            placeholder={lang === 'zh' ? '如 3×15,每日' : 'e.g. 3×15, daily'} />
        </div>

        {hint && <p className="inj-hint">{hint}</p>}

        <div className="inj-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || !canSave}>
            {editing ? (lang === 'zh' ? '保存' : 'Save') : (lang === 'zh' ? '添加' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  )
}
