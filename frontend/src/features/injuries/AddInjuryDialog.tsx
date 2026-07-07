// Add / edit an injury (SPEC §4.8, §6A). An injury is an EVENT: body area +
// laterality + type + scenario + onset + stage, a bilingual note (AI-translated,
// like AddExerciseDialog's Suggest), and text/link attachment references.
import { useState } from 'react'
import { createInjury, updateInjury, today } from '../../db'
import type {
  BodyPart,
  Injury,
  InjuryAttachmentRef,
  InjuryLaterality,
  InjuryScenario,
  InjuryStatus,
  InjuryType,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import { suggestInjuryNote, type TranslationTarget } from '../../translation'
import {
  INJURY_LATERALITIES,
  INJURY_LATERALITY_LABELS,
  INJURY_SCENARIOS,
  INJURY_SCENARIO_LABELS,
  INJURY_STATUSES,
  INJURY_STATUS_LABELS,
  INJURY_TYPES,
  INJURY_TYPE_LABELS,
} from './util'

export function AddInjuryDialog({
  lang,
  injury,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  injury?: Injury
  onSaved: (injury: Injury) => void
  onClose: () => void
}) {
  const editing = !!injury
  const cats = useCategories()
  const [bodyAreaZh, setBodyAreaZh] = useState(injury?.body_area_zh ?? '')
  const [bodyAreaEn, setBodyAreaEn] = useState(injury?.body_area_en ?? '')
  const [bodyPart, setBodyPart] = useState<BodyPart | ''>(injury?.body_part ?? '')
  const [laterality, setLaterality] = useState<InjuryLaterality | ''>(injury?.laterality ?? '')
  const [injuryType, setInjuryType] = useState<InjuryType | ''>(injury?.injury_type ?? '')
  const [scenario, setScenario] = useState<InjuryScenario | ''>(injury?.scenario ?? '')
  const [startedOn, setStartedOn] = useState(injury?.started_on ?? today())
  const [status, setStatus] = useState<InjuryStatus>(injury?.status ?? 'newly_occurred')
  const [severity, setSeverity] = useState<number | ''>(injury?.severity ?? '')
  const [noteZh, setNoteZh] = useState(injury?.note_zh ?? '')
  const [noteEn, setNoteEn] = useState(injury?.note_en ?? '')
  const [attachments, setAttachments] = useState<InjuryAttachmentRef[]>(injury?.attachments ?? [])
  const [busy, setBusy] = useState(false)
  const [translatingArea, setTranslatingArea] = useState(false)
  const [translatingNote, setTranslatingNote] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const OFFLINE_HINT = lang === 'zh'
    ? '自动翻译暂不可用(离线或未配 key),手动补另一语即可。'
    : 'Auto-translate unavailable (offline or no key). Fill the other language manually.'

  async function onTranslateArea() {
    const src = (bodyAreaZh || bodyAreaEn).trim()
    if (!src) return
    setTranslatingArea(true)
    setHint(null)
    const s = await suggestInjuryNote(src)
    setBodyAreaZh(s.note_zh)
    setBodyAreaEn(s.note_en)
    if (s.needsTranslation) setHint(OFFLINE_HINT)
    setTranslatingArea(false)
  }

  async function onTranslateNote() {
    const src = (noteZh || noteEn).trim()
    if (!src) return
    setTranslatingNote(true)
    setHint(null)
    const s = await suggestInjuryNote(src)
    setNoteZh(s.note_zh)
    setNoteEn(s.note_en)
    if (s.needsTranslation) setHint(OFFLINE_HINT)
    setTranslatingNote(false)
  }

  function setAttachment(i: number, patch: Partial<InjuryAttachmentRef>) {
    setAttachments((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  }

  const hasArea = !!(bodyAreaZh.trim() || bodyAreaEn.trim())

  async function onSave() {
    if (!hasArea) return
    setBusy(true)
    const fields = {
      body_area_zh: bodyAreaZh.trim(),
      body_area_en: bodyAreaEn.trim(),
      body_part: bodyPart || null,
      laterality: laterality || null,
      injury_type: injuryType || null,
      scenario: scenario || null,
      started_on: startedOn,
      status,
      severity: severity === '' ? null : Number(severity),
      note_zh: noteZh.trim(),
      note_en: noteEn.trim(),
      attachments: attachments.filter((a) => a.label.trim() || a.url?.trim()),
    }
    let saved: Injury
    if (injury) {
      await updateInjury(injury.id, fields)
      saved = { ...injury, ...fields } as Injury
    } else {
      saved = await createInjury(fields)
    }
    setBusy(false)
    onSaved(saved)
  }

  return (
    <div className="inj-dialog-backdrop" onClick={onClose}>
      <div className="inj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? (lang === 'zh' ? '编辑伤病' : 'Edit injury') : (lang === 'zh' ? '登记伤病' : 'Add injury')}</h3>

        <div className="inj-field">
          <div className="inj-note-head">
            <label className="th-label">{lang === 'zh' ? '受伤部位 (双语)' : 'Body area (bilingual)'}</label>
            <button className="th-btn-ghost inj-translate" type="button" onClick={onTranslateArea} disabled={translatingArea || !hasArea}>
              {translatingArea ? '…' : (lang === 'zh' ? '翻译' : 'Translate')}
            </button>
          </div>
          <input className="th-input" value={bodyAreaZh} onChange={(e) => setBodyAreaZh(e.target.value)}
            placeholder={lang === 'zh' ? '中文,如 左腿后侧' : 'Chinese, e.g. 左腿后侧'} autoFocus />
          <input className="th-input" value={bodyAreaEn} onChange={(e) => setBodyAreaEn(e.target.value)}
            placeholder={lang === 'zh' ? '英文,如 left hamstring' : 'English, e.g. left hamstring'} />
        </div>

        <div className="inj-grid2">
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-bp">{lang === 'zh' ? '部位分类(可选)' : 'Body part (optional)'}</label>
            <select id="inj-bp" className="th-input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart | '')}>
              <option value="">—</option>
              {cats.map((c) => (
                <option key={c.key} value={c.key}>{categoryLabel(c.key, lang)}</option>
              ))}
            </select>
          </div>
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-side">{lang === 'zh' ? '左右侧' : 'Side'}</label>
            <select id="inj-side" className="th-input" value={laterality} onChange={(e) => setLaterality(e.target.value as InjuryLaterality | '')}>
              <option value="">—</option>
              {INJURY_LATERALITIES.map((s) => (
                <option key={s} value={s}>{INJURY_LATERALITY_LABELS[s][lang]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="inj-grid2">
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-type">{lang === 'zh' ? '伤病类型' : 'Type'}</label>
            <select id="inj-type" className="th-input" value={injuryType} onChange={(e) => setInjuryType(e.target.value as InjuryType | '')}>
              <option value="">—</option>
              {INJURY_TYPES.map((t) => (
                <option key={t} value={t}>{INJURY_TYPE_LABELS[t][lang]}</option>
              ))}
            </select>
          </div>
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-scene">{lang === 'zh' ? '受伤场景' : 'Scenario'}</label>
            <select id="inj-scene" className="th-input" value={scenario} onChange={(e) => setScenario(e.target.value as InjuryScenario | '')}>
              <option value="">—</option>
              {INJURY_SCENARIOS.map((s) => (
                <option key={s} value={s}>{INJURY_SCENARIO_LABELS[s][lang]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="inj-grid2">
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-date">{lang === 'zh' ? '受伤时间' : 'Onset date'}</label>
            <input id="inj-date" className="th-input" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>
          <div className="inj-field">
            <label className="th-label" htmlFor="inj-sev">{lang === 'zh' ? '严重度 (1–5)' : 'Severity (1–5)'}</label>
            <select id="inj-sev" className="th-input" value={severity} onChange={(e) => setSeverity(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="inj-field">
          <label className="th-label" htmlFor="inj-status">{lang === 'zh' ? '当前状态' : 'Status'}</label>
          <select id="inj-status" className="th-input" value={status} onChange={(e) => setStatus(e.target.value as InjuryStatus)}>
            {INJURY_STATUSES.map((s) => (
              <option key={s} value={s}>{INJURY_STATUS_LABELS[s][lang]}</option>
            ))}
          </select>
        </div>

        <div className="inj-field">
          <div className="inj-note-head">
            <label className="th-label">{lang === 'zh' ? '记录 (双语)' : 'Note (bilingual)'}</label>
            <button className="th-btn-ghost inj-translate" type="button" onClick={onTranslateNote} disabled={translatingNote || (!noteZh.trim() && !noteEn.trim())}>
              {translatingNote ? '…' : (lang === 'zh' ? '翻译' : 'Translate')}
            </button>
          </div>
          <input className="th-input" value={noteZh} onChange={(e) => setNoteZh(e.target.value)}
            placeholder={lang === 'zh' ? '中文记录' : 'Chinese note'} />
          <input className="th-input" value={noteEn} onChange={(e) => setNoteEn(e.target.value)}
            placeholder={lang === 'zh' ? '英文记录' : 'English note'} />
          {hint && <p className="inj-hint">{hint}</p>}
        </div>

        <div className="inj-field">
          <div className="inj-note-head">
            <label className="th-label">{lang === 'zh' ? '附件/资料 (链接或文字)' : 'References (link or text)'}</label>
            <button className="th-btn-ghost inj-translate" type="button"
              onClick={() => setAttachments((prev) => [...prev, { label: '', url: '' }])}>
              {lang === 'zh' ? '+ 添加' : '+ Add'}
            </button>
          </div>
          {attachments.map((a, i) => (
            <div key={i} className="inj-grid2 inj-attach-row">
              <input className="th-input" value={a.label} onChange={(e) => setAttachment(i, { label: e.target.value })}
                placeholder={lang === 'zh' ? '如 MRI 报告 / 处方' : 'e.g. MRI report'} />
              <div className="log-row">
                <input className="th-input" value={a.url ?? ''} onChange={(e) => setAttachment(i, { url: e.target.value })}
                  placeholder={lang === 'zh' ? '链接(可选)' : 'link (optional)'} />
                <button className="hist-link danger" type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </div>
            </div>
          ))}
        </div>

        <div className="inj-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || !hasArea}>
            {editing ? (lang === 'zh' ? '保存' : 'Save') : (lang === 'zh' ? '登记' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  )
}
