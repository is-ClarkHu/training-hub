// Add / edit a sport and its CUSTOM fields (SPEC §4.5, redesigned). Every sport
// tracks duration; beyond that you define your own fields — e.g. frisbee gets a
// "level" select (抛接/休闲/俱乐部/大赛), basketball gets none. No forced tiers.
import { useState } from 'react'
import { createSport, updateSport } from '../../db'
import { requestTranslation } from '../../translation'
import { FRISBEE_FIELDS, type Sport, type SportField, type SportFieldOption } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import './sports.css'

const HAS_CJK = /[一-鿿]/
let uid = 0
const optKey = () => `opt_${Date.now()}_${uid++}`

export function AddSportDialog({
  lang,
  sport,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  sport?: Sport
  onSaved: (s: Sport) => void
  onClose: () => void
}) {
  const editing = !!sport
  const [raw, setRaw] = useState('')
  const [nameZh, setNameZh] = useState(sport?.name_zh ?? '')
  const [nameEn, setNameEn] = useState(sport?.name_en ?? '')
  const [fields, setFields] = useState<SportField[]>((sport?.fields ?? []).map((f) => ({ ...f, options: f.options?.map((o) => ({ ...o })) })))
  const [proposed, setProposed] = useState(editing)
  const [busy, setBusy] = useState(false)

  async function onSuggest() {
    if (!raw.trim()) return
    setBusy(true)
    const inputIsZh = HAS_CJK.test(raw)
    const target: TranslationTarget = inputIsZh ? 'en' : 'zh'
    try {
      const res = await requestTranslation('sport', raw.trim(), target)
      setNameZh(inputIsZh ? raw.trim() : res.text)
      setNameEn(inputIsZh ? res.text : raw.trim())
    } catch {
      setNameZh(inputIsZh ? raw.trim() : '')
      setNameEn(inputIsZh ? '' : raw.trim())
    }
    setProposed(true)
    setBusy(false)
  }

  function setField(i: number, patch: Partial<SportField>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function setOption(fi: number, oi: number, patch: Partial<SportFieldOption>) {
    setFields((fs) => fs.map((f, idx) => (idx === fi ? { ...f, options: f.options?.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : f)))
  }
  function addField() {
    setFields((fs) => [...fs, { key: `field_${fs.length + 1}`, label_zh: '', label_en: '', type: 'select', options: [{ value: optKey(), zh: '', en: '' }] }])
  }
  function addFrisbeeLevel() {
    setFields((fs) => [...fs, ...FRISBEE_FIELDS.map((f) => ({ ...f, options: f.options?.map((o) => ({ ...o })) }))])
  }
  function addOption(fi: number) {
    setFields((fs) => fs.map((f, idx) => (idx === fi ? { ...f, options: [...(f.options ?? []), { value: optKey(), zh: '', en: '' }] } : f)))
  }

  async function onSave() {
    if (!nameZh.trim() && !nameEn.trim()) return
    setBusy(true)
    // derive a stable key for each field from its english label if missing
    const cleaned = fields.map((f) => ({ ...f, key: f.key || (f.label_en || f.label_zh).toLowerCase().replace(/\s+/g, '_') }))
    if (sport) {
      await updateSport(sport.id, { name_zh: nameZh.trim(), name_en: nameEn.trim(), fields: cleaned })
      onSaved({ ...sport, name_zh: nameZh.trim(), name_en: nameEn.trim(), fields: cleaned })
    } else {
      const created = await createSport({ name_zh: nameZh.trim(), name_en: nameEn.trim(), fields: cleaned, needs_translation: !nameZh.trim() || !nameEn.trim() })
      onSaved(created)
    }
    setBusy(false)
  }

  return (
    <div className="sport-dialog-backdrop" onClick={onClose}>
      <div className="sport-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? (lang === 'zh' ? '编辑运动' : 'Edit sport') : (lang === 'zh' ? '添加运动' : 'Add sport')}</h3>

        {!editing && (
          <div className="sport-field">
            <label className="th-label">{lang === 'zh' ? '名称(中/英,可自动翻译)' : 'Name (zh/en, auto-translate)'}</label>
            <div className="sport-row">
              <input className="th-input" value={raw} onChange={(e) => setRaw(e.target.value)}
                placeholder={lang === 'zh' ? '例如 篮球' : 'e.g. basketball'} autoFocus />
              <button className="th-btn-ghost sport-suggest" type="button" onClick={onSuggest} disabled={busy || !raw.trim()}>
                {busy ? '…' : 'Suggest'}
              </button>
            </div>
          </div>
        )}

        {(proposed || editing) && (
          <>
            <div className="sport-grid2">
              <div className="sport-field">
                <label className="th-label">中文名</label>
                <input className="th-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
              </div>
              <div className="sport-field">
                <label className="th-label">English</label>
                <input className="th-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
            </div>

            <span className="th-label">{lang === 'zh' ? '自定义属性(时长自动记录)' : 'Custom fields (duration always tracked)'}</span>
            {fields.length === 0 && <p className="sport-empty">{lang === 'zh' ? '无额外属性 — 仅记时长' : 'no extra fields — duration only'}</p>}

            {fields.map((f, fi) => (
              <div key={fi} className="sport-field-block">
                <div className="sport-field-head">
                  <input className="th-input" value={f.label_zh} onChange={(e) => setField(fi, { label_zh: e.target.value })} placeholder={lang === 'zh' ? '属性名(中)' : 'label zh'} />
                  <input className="th-input" value={f.label_en} onChange={(e) => setField(fi, { label_en: e.target.value })} placeholder="label en" />
                  <select className="th-input sport-ftype" value={f.type} onChange={(e) => setField(fi, { type: e.target.value as SportField['type'] })}>
                    <option value="select">{lang === 'zh' ? '选项' : 'select'}</option>
                    <option value="text">{lang === 'zh' ? '文本' : 'text'}</option>
                    <option value="number">{lang === 'zh' ? '数字' : 'number'}</option>
                  </select>
                  <button className="cyc-del" type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== fi))}>×</button>
                </div>
                {f.type === 'select' && (
                  <div className="sport-opts">
                    {(f.options ?? []).map((o, oi) => (
                      <div key={oi} className="sport-opt-row">
                        <input className="th-input" value={o.zh} onChange={(e) => setOption(fi, oi, { zh: e.target.value })} placeholder="中文" />
                        <input className="th-input" value={o.en} onChange={(e) => setOption(fi, oi, { en: e.target.value, value: o.value || (e.target.value.toLowerCase().replace(/\s+/g, '_')) })} placeholder="English" />
                      </div>
                    ))}
                    <button className="th-btn-ghost sport-add-opt" type="button" onClick={() => addOption(fi)}>{lang === 'zh' ? '+ 选项' : '+ option'}</button>
                  </div>
                )}
              </div>
            ))}

            <div className="sport-field-actions">
              <button className="th-btn-ghost" type="button" onClick={addField}>{lang === 'zh' ? '+ 属性' : '+ field'}</button>
              <button className="th-btn-ghost" type="button" onClick={addFrisbeeLevel}>{lang === 'zh' ? '+ 飞盘等级' : '+ frisbee level'}</button>
            </div>
          </>
        )}

        <div className="sport-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || (!proposed && !editing) || (!nameZh.trim() && !nameEn.trim())}>
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
