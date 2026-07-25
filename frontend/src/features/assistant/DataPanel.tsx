// Right pane · Data tab (PLAN-ai-chatrooms P6 / §3.1). A grid of module tiles;
// clicking one opens a modal to edit that module (basics, measurements, training
// env, supplements, food, notes, files, medical). All fields optional; the
// assistant reads a module only in rooms granted its permission. Medical is
// high-sensitivity.
//
// Typed inputs: categorical fields use <select>/<datalist> instead of free text,
// numbers use type=number with units in the label, dates use type=date. The list
// modules (measurements / supplements / food) support full CRUD — add, inline
// edit, delete/hide, and a search box to find rows.
import { useEffect, useMemo, useState } from 'react'
import { Chart, PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Filler } from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  getBasics, saveBasics,
  getTrainingEnv, saveTrainingEnv,
  getMedicalBackground, saveMedicalBackground,
  getBodyMeasurements, addBodyMeasurement, updateBodyMeasurement, deleteBodyMeasurement,
  getNotes, createNote, deleteNote,
  getSupplements, createSupplement, updateSupplement, deleteSupplement,
  getFoodLog, createFoodLog, updateFoodLog, deleteFoodLog,
  getPublicFiles, createPublicFile, setPublicFileSummary, deletePublicFile,
  today,
} from '../../db'
import { hasBackend } from '../../ai/config'
import { describeFood, summarizeFile, warmupBackend } from './assistantClient'
import type {
  Basics, BodyMeasurement, FoodLog, MedicalBackground, Note, NoteTag, PublicFile, Supplement, TrainingEnv,
} from '../../supabase/types'

Chart.register(PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Filler)

type L = 'zh' | 'en'
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))
const NOTE_TAGS: NoteTag[] = ['training', 'injury', 'goal', 'habit', 'medical', 'equipment', 'other']

// ── typed option sets ────────────────────────────────────────
type Opt = { value: string; zh: string; en: string }
const SEX_OPTS: Opt[] = [
  { value: 'male', zh: '男', en: 'Male' },
  { value: 'female', zh: '女', en: 'Female' },
  { value: 'other', zh: '其他', en: 'Other' },
]
const LEVEL_OPTS: Opt[] = [
  { value: 'beginner', zh: '新手', en: 'Beginner' },
  { value: 'novice', zh: '初级', en: 'Novice' },
  { value: 'intermediate', zh: '中级', en: 'Intermediate' },
  { value: 'advanced', zh: '高级', en: 'Advanced' },
  { value: 'elite', zh: '精英', en: 'Elite' },
]
const WORK_OPTS: Opt[] = [
  { value: 'sedentary', zh: '久坐', en: 'Sedentary' },
  { value: 'physical', zh: '体力', en: 'Physical' },
  { value: 'shift', zh: '轮班', en: 'Shift' },
  { value: 'mixed', zh: '混合', en: 'Mixed' },
]
// Semi-free fields: suggestions via <datalist>, but the user may still type anything.
const TIMING_OPTS: Opt[] = [
  { value: 'pre-workout', zh: '训练前', en: 'Pre-workout' },
  { value: 'post-workout', zh: '训练后', en: 'Post-workout' },
  { value: 'morning', zh: '早晨', en: 'Morning' },
  { value: 'evening', zh: '晚上', en: 'Evening' },
  { value: 'pre-sleep', zh: '睡前', en: 'Pre-sleep' },
  { value: 'with-meal', zh: '随餐', en: 'With meal' },
]
const FREQ_OPTS: Opt[] = [
  { value: 'daily', zh: '每天', en: 'Daily' },
  { value: 'every-other-day', zh: '隔天', en: 'Every other day' },
  { value: 'training-days', zh: '训练日', en: 'Training days' },
  { value: 'weekly', zh: '每周', en: 'Weekly' },
  { value: 'as-needed', zh: '需要时', en: 'As needed' },
]

// A localized <select>. Keeps any pre-existing free-text value selectable so
// legacy data is never silently dropped.
function LSelect({ value, opts, onChange, lang, placeholder }: {
  value: string | null | undefined; opts: Opt[]; onChange: (v: string) => void; lang: L; placeholder: string
}) {
  const v = value ?? ''
  const known = opts.some((o) => o.value === v)
  return (
    <select className="th-input" value={v} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {!known && v !== '' && <option value={v}>{v}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{lang === 'zh' ? o.zh : o.en}</option>)}
    </select>
  )
}

// A free-text input backed by localized suggestions.
function LDatalist({ id, value, opts, onChange, lang, placeholder }: {
  id: string; value: string | null | undefined; opts: Opt[]; onChange: (v: string) => void; lang: L; placeholder?: string
}) {
  return (
    <>
      <input className="th-input" list={id} value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {opts.map((o) => <option key={o.value} value={lang === 'zh' ? o.zh : o.en} />)}
      </datalist>
    </>
  )
}

const MODULES: { key: string; zh: string; en: string; icon: string; high?: boolean }[] = [
  { key: 'basics', zh: '基础资料', en: 'Basics', icon: '🧍' },
  { key: 'measure', zh: '体测趋势', en: 'Measurements', icon: '📈' },
  { key: 'env', zh: '训练环境', en: 'Environment', icon: '🏋' },
  { key: 'supp', zh: '补剂', en: 'Supplements', icon: '💊' },
  { key: 'food', zh: '饮食', en: 'Food', icon: '🍽' },
  { key: 'notes', zh: '笔记', en: 'Notes', icon: '📝' },
  { key: 'medical', zh: '医疗背景', en: 'Medical', icon: '⚠', high: true },
]

const fileExt = (name: string): string => (name.split('.').pop() || '').toUpperCase().slice(0, 4)

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export function DataPanel({ lang }: { lang: L }) {
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en)
  const [open, setOpen] = useState<string | null>(null)

  const [basics, setBasics] = useState<Partial<Basics>>({})
  const [env, setEnv] = useState<Partial<TrainingEnv>>({})
  const [medical, setMedical] = useState<Partial<MedicalBackground>>({})
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [supps, setSupps] = useState<Supplement[]>([])
  const [food, setFood] = useState<FoodLog[]>([])
  const [files, setFiles] = useState<PublicFile[]>([])

  const [mDraft, setMDraft] = useState<Partial<BodyMeasurement>>({ date: today() })
  const [noteDraft, setNoteDraft] = useState<{ content: string; tag: NoteTag }>({ content: '', tag: 'other' })
  const [supDraft, setSupDraft] = useState<Partial<Supplement>>({})
  const [foodDraft, setFoodDraft] = useState<{ date: string; description: string; photo?: string; aiDesc?: string }>({ date: today(), description: '' })
  const [recognizing, setRecognizing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [foodErr, setFoodErr] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<PublicFile | null>(null)

  // CRUD helpers: inline-edit target per list module + a shared search box.
  const [editM, setEditM] = useState<BodyMeasurement | null>(null)
  const [editSup, setEditSup] = useState<Supplement | null>(null)
  const [editFood, setEditFood] = useState<FoodLog | null>(null)
  const [query, setQuery] = useState('')
  // Reset transient edit/search state whenever a different module opens.
  useEffect(() => {
    setQuery(''); setEditM(null); setEditSup(null); setEditFood(null)
    setFoodErr(null)
    if (open === 'food' && hasBackend()) warmupBackend() // wake a cold relay before recognition
  }, [open])
  const match = (s: string) => query.trim() === '' || s.toLowerCase().includes(query.trim().toLowerCase())

  async function uploadFile(f: File) {
    const row = await createPublicFile(f)
    await reload()
    // The file itself stores fine without a relay; only the AI summary needs one.
    if (row.content && hasBackend()) {
      setSummarizing(row.id)
      try { const s = await summarizeFile(row.content); if (s) await setPublicFileSummary(row.id, s) }
      catch { /* summary best-effort */ }
      finally { setSummarizing(null); await reload() }
    }
  }

  async function reload() {
    const [b, e, md, ms, ns, ss, fd, fl] = await Promise.all([
      getBasics(), getTrainingEnv(), getMedicalBackground(),
      getBodyMeasurements(), getNotes(), getSupplements(),
      getFoodLog(), getPublicFiles(),
    ])
    setBasics(b ?? {})
    setEnv(e ?? {})
    setMedical(md ?? {})
    setMeasurements(ms)
    setNotes(ns)
    setSupps(ss)
    setFood(fd)
    setFiles(fl)
  }
  useEffect(() => { void reload() }, [])

  // Oldest→newest series for the trend chart (measurements come newest-first).
  const trend = useMemo(() => {
    const asc = [...measurements].reverse()
    const pick = (key: 'weight_kg' | 'body_fat_pct') =>
      asc.filter((m) => m[key] != null).map((m) => ({ x: m.date.slice(5), y: m[key] as number }))
    return { weight: pick('weight_kg'), fat: pick('body_fat_pct') }
  }, [measurements])

  async function runRecognize() {
    if (!foodDraft.photo) return
    setRecognizing(true); setFoodErr(null); setElapsed(0)
    const started = Date.now()
    const iv = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    try {
      const desc = await describeFood(foodDraft.photo, foodDraft.description)
      setFoodDraft((d) => ({ ...d, aiDesc: desc }))
    } catch (err) {
      setFoodErr(err instanceof Error ? err.message : String(err))
    } finally {
      window.clearInterval(iv)
      setRecognizing(false)
    }
  }

  function moduleBody(key: string) {
    switch (key) {
      case 'basics':
        return (
          <>
            <div className="asst-data-grid">
              <label>{t('年龄', 'Age')}<input className="th-input" type="number" min={0} value={basics.age ?? ''} onChange={(e) => setBasics({ ...basics, age: num(e.target.value) })} /></label>
              <label>{t('性别', 'Sex')}<LSelect lang={lang} value={basics.sex} opts={SEX_OPTS} placeholder={t('选择…', 'Select…')} onChange={(v) => setBasics({ ...basics, sex: v })} /></label>
              <label>{t('生理性别', 'Biological sex')}<LSelect lang={lang} value={basics.biological_sex} opts={SEX_OPTS} placeholder={t('选择…', 'Select…')} onChange={(v) => setBasics({ ...basics, biological_sex: v })} /></label>
              <label>{t('身高(cm)', 'Height (cm)')}<input className="th-input" type="number" min={0} step={0.5} value={basics.height_cm ?? ''} onChange={(e) => setBasics({ ...basics, height_cm: num(e.target.value) })} /></label>
              <label>{t('训练年限(年)', 'Training (yr)')}<input className="th-input" type="number" min={0} step={0.5} value={basics.training_years ?? ''} onChange={(e) => setBasics({ ...basics, training_years: num(e.target.value) })} /></label>
              <label>{t('训练水平', 'Level')}<LSelect lang={lang} value={basics.training_level} opts={LEVEL_OPTS} placeholder={t('选择…', 'Select…')} onChange={(v) => setBasics({ ...basics, training_level: v })} /></label>
              <label>{t('工作类型', 'Work type')}<LSelect lang={lang} value={basics.work_type} opts={WORK_OPTS} placeholder={t('选择…', 'Select…')} onChange={(v) => setBasics({ ...basics, work_type: v })} /></label>
              <label>{t('睡眠(h)', 'Sleep (h)')}<input className="th-input" type="number" min={0} max={24} step={0.5} value={basics.sleep_hours ?? ''} onChange={(e) => setBasics({ ...basics, sleep_hours: num(e.target.value) })} /></label>
              <label>{t('静息心率(bpm)', 'Resting HR (bpm)')}<input className="th-input" type="number" min={0} value={basics.resting_hr ?? ''} onChange={(e) => setBasics({ ...basics, resting_hr: num(e.target.value) })} /></label>
              <label>{t('最大心率(bpm)', 'Max HR (bpm)')}<input className="th-input" type="number" min={0} value={basics.max_hr ?? ''} onChange={(e) => setBasics({ ...basics, max_hr: num(e.target.value) })} /></label>
            </div>
            <button className="th-btn" type="button" onClick={async () => { await saveBasics(basics); setOpen(null) }}>{t('保存', 'Save')}</button>
          </>
        )
      case 'measure':
        return (
          <>
            {(trend.weight.length >= 2 || trend.fat.length >= 2) && (
              <div className="asst-chart">
                <Line
                  data={{
                    labels: (trend.weight.length ? trend.weight : trend.fat).map((p) => p.x),
                    datasets: [
                      ...(trend.weight.length >= 2 ? [{ label: t('体重kg', 'Weight'), data: trend.weight.map((p) => p.y), borderColor: '#4fd1e0', backgroundColor: 'rgba(79,209,224,0.12)', fill: true, tension: 0.3, pointRadius: 2 }] : []),
                      ...(trend.fat.length >= 2 ? [{ label: t('体脂%', 'Body fat'), data: trend.fat.map((p) => p.y), borderColor: '#e0a24f', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2, yAxisID: 'y1' }] : []),
                    ],
                  }}
                  options={{
                    maintainAspectRatio: false,
                    plugins: { legend: { display: trend.fat.length >= 2, labels: { color: '#8b93a3', boxWidth: 10, font: { size: 10 } } } },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: '#8b93a3', font: { size: 9 }, maxRotation: 0 } },
                      y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#8b93a3', font: { size: 9 } } },
                      y1: { position: 'right', grid: { display: false }, ticks: { color: '#8b93a3', font: { size: 9 } }, display: trend.fat.length >= 2 },
                    },
                  }}
                />
              </div>
            )}
            <div className="asst-data-grid">
              <label>{t('日期', 'Date')}<input className="th-input" type="date" value={mDraft.date ?? today()} onChange={(e) => setMDraft({ ...mDraft, date: e.target.value })} /></label>
              <label>{t('体重(kg)', 'Weight (kg)')}<input className="th-input" type="number" min={0} step={0.1} value={mDraft.weight_kg ?? ''} onChange={(e) => setMDraft({ ...mDraft, weight_kg: num(e.target.value) })} /></label>
              <label>{t('体脂(%)', 'Body fat (%)')}<input className="th-input" type="number" min={0} max={100} step={0.1} value={mDraft.body_fat_pct ?? ''} onChange={(e) => setMDraft({ ...mDraft, body_fat_pct: num(e.target.value) })} /></label>
              <label>{t('肌肉(kg)', 'Muscle (kg)')}<input className="th-input" type="number" min={0} step={0.1} value={mDraft.muscle_kg ?? ''} onChange={(e) => setMDraft({ ...mDraft, muscle_kg: num(e.target.value) })} /></label>
              <label>{t('腰围(cm)', 'Waist (cm)')}<input className="th-input" type="number" min={0} step={0.5} value={mDraft.waist_cm ?? ''} onChange={(e) => setMDraft({ ...mDraft, waist_cm: num(e.target.value) })} /></label>
            </div>
            <button className="th-btn" type="button" onClick={async () => {
              await addBodyMeasurement({ date: mDraft.date ?? today(), weight_kg: mDraft.weight_kg ?? null, body_fat_pct: mDraft.body_fat_pct ?? null, muscle_kg: mDraft.muscle_kg ?? null, waist_cm: mDraft.waist_cm ?? null })
              setMDraft({ date: today() })
              await reload()
            }}>{t('添加记录', 'Add')}</button>
            <input className="th-input asst-data-search" placeholder={t('按日期搜索…', 'Search by date…')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="asst-mem-list">
              {measurements.filter((m) => match(m.date)).slice(0, 60).map((m) => (
                editM?.id === m.id ? (
                  <li key={m.id} className="asst-data-editrow">
                    <input className="th-input" type="date" value={editM.date} onChange={(e) => setEditM({ ...editM, date: e.target.value })} />
                    <input className="th-input" type="number" step={0.1} placeholder={t('体重kg', 'kg')} value={editM.weight_kg ?? ''} onChange={(e) => setEditM({ ...editM, weight_kg: num(e.target.value) })} />
                    <input className="th-input" type="number" step={0.1} placeholder={t('体脂%', 'fat%')} value={editM.body_fat_pct ?? ''} onChange={(e) => setEditM({ ...editM, body_fat_pct: num(e.target.value) })} />
                    <input className="th-input" type="number" step={0.1} placeholder={t('肌肉kg', 'musc')} value={editM.muscle_kg ?? ''} onChange={(e) => setEditM({ ...editM, muscle_kg: num(e.target.value) })} />
                    <input className="th-input" type="number" step={0.5} placeholder={t('腰cm', 'waist')} value={editM.waist_cm ?? ''} onChange={(e) => setEditM({ ...editM, waist_cm: num(e.target.value) })} />
                    <div className="asst-edit-actions">
                      <button type="button" onClick={async () => { await updateBodyMeasurement(editM.id, { date: editM.date, weight_kg: editM.weight_kg, body_fat_pct: editM.body_fat_pct, muscle_kg: editM.muscle_kg, waist_cm: editM.waist_cm }); setEditM(null); await reload() }}>{t('保存', 'Save')}</button>
                      <button type="button" onClick={() => setEditM(null)}>{t('取消', 'Cancel')}</button>
                    </div>
                  </li>
                ) : (
                  <li key={m.id} className="asst-data-row">
                    <span>{m.date}: {[m.weight_kg && `${m.weight_kg}kg`, m.body_fat_pct && `${m.body_fat_pct}%`, m.muscle_kg && `${m.muscle_kg}kg肌`, m.waist_cm && `${m.waist_cm}cm腰`].filter(Boolean).join(', ')}</span>
                    <span className="asst-row-actions">
                      <button type="button" title={t('编辑', 'Edit')} onClick={() => setEditM(m)}>✎</button>
                      <button type="button" title={t('删除', 'Delete')} onClick={async () => { await deleteBodyMeasurement(m.id); await reload() }}>🗑</button>
                    </span>
                  </li>
                )
              ))}
            </ul>
          </>
        )
      case 'env':
        return (
          <>
            <div className="asst-data-grid">
              <label>{t('常用健身房', 'Usual gym')}<input className="th-input" value={env.gym ?? ''} onChange={(e) => setEnv({ ...env, gym: e.target.value })} /></label>
              <label>{t('器械', 'Equipment')}<input className="th-input" value={env.equipment ?? ''} onChange={(e) => setEnv({ ...env, equipment: e.target.value })} /></label>
              <label>{t('家庭设备', 'Home equipment')}<input className="th-input" value={env.home_equipment ?? ''} onChange={(e) => setEnv({ ...env, home_equipment: e.target.value })} /></label>
            </div>
            <button className="th-btn" type="button" onClick={async () => { await saveTrainingEnv(env); setOpen(null) }}>{t('保存', 'Save')}</button>
          </>
        )
      case 'supp':
        return (
          <>
            <div className="asst-data-grid">
              <label>{t('名称', 'Name')}<input className="th-input" value={supDraft.name ?? ''} onChange={(e) => setSupDraft({ ...supDraft, name: e.target.value })} /></label>
              <label>{t('品牌', 'Brand')}<input className="th-input" value={supDraft.brand ?? ''} onChange={(e) => setSupDraft({ ...supDraft, brand: e.target.value })} /></label>
              <label>{t('剂量', 'Dose')}<input className="th-input" value={supDraft.dose ?? ''} placeholder={t('如 5 g / 2 粒', 'e.g. 5 g / 2 caps')} onChange={(e) => setSupDraft({ ...supDraft, dose: e.target.value })} /></label>
              <label>{t('时间', 'Timing')}<LDatalist id="supp-timing" lang={lang} value={supDraft.timing} opts={TIMING_OPTS} onChange={(v) => setSupDraft({ ...supDraft, timing: v })} /></label>
              <label>{t('频率', 'Frequency')}<LDatalist id="supp-freq" lang={lang} value={supDraft.frequency} opts={FREQ_OPTS} onChange={(v) => setSupDraft({ ...supDraft, frequency: v })} /></label>
            </div>
            <button className="th-btn" type="button" disabled={!supDraft.name?.trim()} onClick={async () => {
              await createSupplement({ name: supDraft.name ?? '', brand: supDraft.brand ?? null, dose: supDraft.dose ?? null, timing: supDraft.timing ?? null, frequency: supDraft.frequency ?? null })
              setSupDraft({}); await reload()
            }}>{t('添加一条', 'Add entry')}</button>
            <input className="th-input asst-data-search" placeholder={t('搜索名称…', 'Search name…')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="asst-mem-list">
              {supps.filter((s) => match(`${s.name} ${s.brand ?? ''} ${s.dose ?? ''}`)).map((s) => (
                editSup?.id === s.id ? (
                  <li key={s.id} className="asst-data-editrow">
                    <input className="th-input" placeholder={t('名称', 'Name')} value={editSup.name} onChange={(e) => setEditSup({ ...editSup, name: e.target.value })} />
                    <input className="th-input" placeholder={t('品牌', 'Brand')} value={editSup.brand ?? ''} onChange={(e) => setEditSup({ ...editSup, brand: e.target.value })} />
                    <input className="th-input" placeholder={t('剂量', 'Dose')} value={editSup.dose ?? ''} onChange={(e) => setEditSup({ ...editSup, dose: e.target.value })} />
                    <LDatalist id="supp-timing-edit" lang={lang} value={editSup.timing} opts={TIMING_OPTS} placeholder={t('时间', 'Timing')} onChange={(v) => setEditSup({ ...editSup, timing: v })} />
                    <LDatalist id="supp-freq-edit" lang={lang} value={editSup.frequency} opts={FREQ_OPTS} placeholder={t('频率', 'Frequency')} onChange={(v) => setEditSup({ ...editSup, frequency: v })} />
                    <div className="asst-edit-actions">
                      <button type="button" onClick={async () => { await updateSupplement(editSup.id, { name: editSup.name, brand: editSup.brand || null, dose: editSup.dose || null, timing: editSup.timing || null, frequency: editSup.frequency || null }); setEditSup(null); await reload() }}>{t('保存', 'Save')}</button>
                      <button type="button" onClick={() => setEditSup(null)}>{t('取消', 'Cancel')}</button>
                    </div>
                  </li>
                ) : (
                  <li key={s.id} className="asst-data-row">
                    <label className={s.still_using ? '' : 'is-stale'}>
                      <input type="checkbox" checked={s.still_using} onChange={async (e) => { await updateSupplement(s.id, { still_using: e.target.checked }); await reload() }} />
                      {s.name}{s.brand ? ` (${s.brand})` : ''}{s.dose ? ` · ${s.dose}` : ''}
                    </label>
                    <span className="asst-row-actions">
                      <button type="button" title={t('编辑', 'Edit')} onClick={() => setEditSup(s)}>✎</button>
                      <button type="button" title={t('删除', 'Delete')} onClick={async () => { await deleteSupplement(s.id); await reload() }}>🗑</button>
                    </span>
                  </li>
                )
              ))}
            </ul>
          </>
        )
      case 'food':
        return (
          <>
            <div className="asst-data-grid">
              <label>{t('日期', 'Date')}<input className="th-input" type="date" value={foodDraft.date} onChange={(e) => setFoodDraft({ ...foodDraft, date: e.target.value })} /></label>
              <label>{t('图片', 'Photo')}<input type="file" accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setFoodDraft({ ...foodDraft, photo: await fileToDataUrl(f), aiDesc: undefined })
              }} /></label>
            </div>
            <label className="asst-data-full">{t('我的描述', 'My note')}
              <textarea className="th-input" rows={2} value={foodDraft.description} onChange={(e) => setFoodDraft({ ...foodDraft, description: e.target.value })} placeholder={t('吃了什么…（写清有助于 AI 识别，如「西冷一块 洋葱炒鸡胸一盘 刀削面一碗」）', 'What you ate… (details help AI, e.g. "1 ribeye, chicken & onion, a bowl of noodles")')} />
            </label>
            {foodDraft.photo && <img className="asst-food-preview" src={foodDraft.photo} alt="" />}
            {/* Photo + note still save without a relay; only the AI read of the
                image needs one, so hide just that button. */}
            {foodDraft.photo && hasBackend() && (
              <>
                <button className="th-btn" type="button" disabled={recognizing} onClick={runRecognize}>
                  {recognizing ? `${t('识别中', 'Recognizing')}… ${elapsed}s` : t('AI 识别图片（结合上面的描述）', 'AI recognize (uses your note)')}
                </button>
                {recognizing && elapsed >= 6 && (
                  <p className="asst-data-hint">{t('服务器可能在冷启动，首次识别约需 30–60 秒，请稍候…', 'The server may be waking up — the first recognition can take 30–60s, hang tight…')}</p>
                )}
              </>
            )}
            {foodDraft.photo && !hasBackend() && (
              <p className="asst-data-hint">{t('AI 图片识别需要后端服务,线上版本暂不可用', 'AI photo recognition needs the backend — unavailable in this hosted build')}</p>
            )}
            {foodDraft.aiDesc !== undefined && (
              <label className="asst-data-full">{t('AI 识别(可改)', 'AI recognition (editable)')}
                <textarea className="th-input" rows={2} value={foodDraft.aiDesc} onChange={(e) => setFoodDraft({ ...foodDraft, aiDesc: e.target.value })} />
              </label>
            )}
            {foodErr && <p className="th-error">{foodErr}</p>}
            <button className="th-btn" type="button" disabled={!foodDraft.description.trim() && !foodDraft.photo && !foodDraft.aiDesc} onClick={async () => {
              await createFoodLog(foodDraft.description, new Date(foodDraft.date).toISOString(), foodDraft.photo, foodDraft.aiDesc)
              setFoodDraft({ date: today(), description: '' }); await reload()
            }}>{t('添加一条', 'Add entry')}</button>
            <input className="th-input asst-data-search" placeholder={t('搜索描述/日期…', 'Search note/date…')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="asst-mem-list">
              {food.filter((f) => match(`${f.description} ${f.ai_description ?? ''} ${f.eaten_at.slice(0, 10)}`)).slice(0, 60).map((f) => (
                editFood?.id === f.id ? (
                  <li key={f.id} className="asst-data-editrow">
                    <input className="th-input" type="date" value={editFood.eaten_at.slice(0, 10)} onChange={(e) => setEditFood({ ...editFood, eaten_at: new Date(e.target.value).toISOString() })} />
                    <textarea className="th-input" rows={2} placeholder={t('我的描述', 'My note')} value={editFood.description} onChange={(e) => setEditFood({ ...editFood, description: e.target.value })} />
                    <textarea className="th-input" rows={2} placeholder={t('AI 识别', 'AI')} value={editFood.ai_description ?? ''} onChange={(e) => setEditFood({ ...editFood, ai_description: e.target.value })} />
                    <div className="asst-edit-actions">
                      <button type="button" onClick={async () => { await updateFoodLog(editFood.id, { description: editFood.description, ai_description: editFood.ai_description || null, eaten_at: editFood.eaten_at }); setEditFood(null); await reload() }}>{t('保存', 'Save')}</button>
                      <button type="button" onClick={() => setEditFood(null)}>{t('取消', 'Cancel')}</button>
                    </div>
                  </li>
                ) : (
                  <li key={f.id} className="asst-data-row">
                    <span>{f.eaten_at.slice(0, 10)}: {f.description || f.ai_description}{f.ai_description && f.description ? ` · AI:${f.ai_description}` : ''}{f.photo_path ? ' 📷' : ''}</span>
                    <span className="asst-row-actions">
                      <button type="button" title={t('编辑', 'Edit')} onClick={() => setEditFood(f)}>✎</button>
                      <button type="button" title={t('删除', 'Delete')} onClick={async () => { await deleteFoodLog(f.id); await reload() }}>🗑</button>
                    </span>
                  </li>
                )
              ))}
            </ul>
          </>
        )
      case 'notes':
        return (
          <>
            <textarea className="th-input" rows={2} value={noteDraft.content} onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })} placeholder={t('随便写…', 'Anything…')} />
            <div className="asst-data-noteadd">
              <select className="th-input" value={noteDraft.tag} onChange={(e) => setNoteDraft({ ...noteDraft, tag: e.target.value as NoteTag })}>
                {NOTE_TAGS.map((tg) => <option key={tg} value={tg}>{tg}</option>)}
              </select>
              <button className="th-btn" type="button" disabled={!noteDraft.content.trim()} onClick={async () => {
                await createNote(noteDraft.content, noteDraft.tag); setNoteDraft({ content: '', tag: 'other' }); await reload()
              }}>{t('添加', 'Add')}</button>
            </div>
            <ul className="asst-mem-list">
              {notes.map((n) => (
                <li key={n.id} className="asst-data-row">
                  <span>{n.tag ? `[${n.tag}] ` : ''}{n.content}</span>
                  <button type="button" onClick={async () => { await deleteNote(n.id); await reload() }}>🗑</button>
                </li>
              ))}
            </ul>
          </>
        )
      case 'medical':
        return (
          <>
            <p className="asst-hint">{t('高敏感。只有你单独授权的聊天室能读,不会跨室共享。用于运动安全。', 'High-sensitivity. Only rooms you explicitly grant can read it; never shared across rooms. Used for exercise safety.')}</p>
            <label className="asst-data-full">{t('疾病史', 'Conditions')}<textarea className="th-input" rows={2} value={medical.conditions ?? ''} onChange={(e) => setMedical({ ...medical, conditions: e.target.value })} placeholder={t('心血管/血压/糖尿病/哮喘…', 'cardiovascular/BP/diabetes/asthma…')} /></label>
            <label className="asst-data-full">{t('手术史', 'Surgeries')}<textarea className="th-input" rows={2} value={medical.surgeries ?? ''} onChange={(e) => setMedical({ ...medical, surgeries: e.target.value })} /></label>
            <label className="asst-data-full">{t('运动限制', 'Restrictions')}<textarea className="th-input" rows={2} value={medical.restrictions ?? ''} onChange={(e) => setMedical({ ...medical, restrictions: e.target.value })} /></label>
            <label className="asst-data-full">{t('过敏', 'Allergies')}<textarea className="th-input" rows={2} value={medical.allergies ?? ''} onChange={(e) => setMedical({ ...medical, allergies: e.target.value })} /></label>
            <label className="asst-data-full">{t('家族病史', 'Family history')}<textarea className="th-input" rows={2} value={medical.family_history ?? ''} onChange={(e) => setMedical({ ...medical, family_history: e.target.value })} /></label>
            <label className="asst-data-full">{t('近期体检/血检', 'Recent labs')}<textarea className="th-input" rows={2} value={medical.recent_labs ?? ''} onChange={(e) => setMedical({ ...medical, recent_labs: e.target.value })} /></label>
            <button className="th-btn" type="button" onClick={async () => { await saveMedicalBackground(medical); setOpen(null) }}>{t('保存', 'Save')}</button>
          </>
        )
      default:
        return null
    }
  }

  const openMod = MODULES.find((m) => m.key === open)

  return (
    <aside className="asst-memory asst-data">
      {/* Public files — Claude-Projects-style knowledge box, always visible up top */}
      <section className="asst-files">
        <div className="asst-files-head">
          <span className="asst-files-title">{t('公共文件', 'Files')} ({files.length})</span>
          <label className="th-btn asst-files-add">
            {t('＋ 添加', '＋ Add')}
            <input type="file" hidden onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              e.target.value = ''
              await uploadFile(f)
            }} />
          </label>
        </div>
        {files.length === 0 ? (
          <p className="asst-hint">{t('上传训练计划、教练/医生说明、饮食原则等小文件。按聊天室在「记忆」页授权。', 'Upload small files (plans, coach/doctor notes…). Grant per room in the Memory tab.')}</p>
        ) : (
          <ul className="asst-files-list">
            {files.map((f) => (
              <li key={f.id} className="asst-file-card" onClick={() => setPreviewFile(f)}>
                <span className="asst-file-icon">📄</span>
                <span className="asst-file-main">
                  <span className="asst-file-name">{f.name}</span>
                  <span className="asst-file-sub">
                    {summarizing === f.id ? t('生成摘要中…', 'Summarizing…') : (f.summary || (f.content ? t('无摘要', 'no summary') : t('无文本', 'no text')))}
                  </span>
                </span>
                <span className="asst-file-ext">{fileExt(f.name)}</span>
                <button type="button" className="asst-file-del" onClick={async (e) => { e.stopPropagation(); await deletePublicFile(f.id); await reload() }}>🗑</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="asst-hint">{t('都是可选的,填了对应聊天室授权后 AI 才会读。', 'All optional; the AI reads a module only in rooms you grant it.')}</p>
      <div className="asst-tiles">
        {MODULES.map((m) => (
          <button key={m.key} type="button" className={`asst-tile ${m.high ? 'high' : ''}`} onClick={() => setOpen(m.key)}>
            <span className="asst-tile-icon">{m.icon}</span>
            <span>{lang === 'zh' ? m.zh : m.en}</span>
          </button>
        ))}
      </div>

      {openMod && (
        <div className="asst-modal-backdrop" onClick={() => setOpen(null)}>
          <div className="asst-modal" onClick={(e) => e.stopPropagation()}>
            <div className="asst-modal-head">
              <h3>{openMod.icon} {lang === 'zh' ? openMod.zh : openMod.en}</h3>
              <button type="button" className="asst-modal-x" onClick={() => setOpen(null)}>×</button>
            </div>
            <div className="asst-modal-body">{moduleBody(openMod.key)}</div>
          </div>
        </div>
      )}

      {previewFile && (
        <div className="asst-modal-backdrop" onClick={() => setPreviewFile(null)}>
          <div className="asst-modal" onClick={(e) => e.stopPropagation()}>
            <div className="asst-modal-head">
              <h3>📄 {previewFile.name}</h3>
              <button type="button" className="asst-modal-x" onClick={() => setPreviewFile(null)}>×</button>
            </div>
            <div className="asst-modal-body">
              {previewFile.summary && (
                <>
                  <span className="th-label">{t('AI 摘要', 'AI summary')}</span>
                  <p className="asst-mem-summary">{previewFile.summary}</p>
                </>
              )}
              <span className="th-label">{t('提取的正文', 'Extracted text')}</span>
              <pre className="asst-file-content">{previewFile.content || t('(无可读文本)', '(no readable text)')}</pre>
              <button className="th-btn" type="button" onClick={async () => {
                await deletePublicFile(previewFile.id); setPreviewFile(null); await reload()
              }}>{t('移除文件', 'Remove file')}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
