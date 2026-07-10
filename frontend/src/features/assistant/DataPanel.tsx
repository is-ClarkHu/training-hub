// Right pane · Data tab (PLAN-ai-chatrooms P6 / §3.1). Where the user fills the
// optional pre-fillable modules the assistant can read (per-room permission). All
// fields optional. Medical is high-sensitivity — a room must be granted it and it
// is never shared cross-room.
import { useEffect, useMemo, useState } from 'react'
import { Chart, PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Filler } from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  getBasics, saveBasics,
  getTrainingEnv, saveTrainingEnv,
  getMedicalBackground, saveMedicalBackground,
  getBodyMeasurements, addBodyMeasurement, deleteBodyMeasurement,
  getNotes, createNote, deleteNote,
  getSupplements, createSupplement, updateSupplement, deleteSupplement,
  getFoodLog, createFoodLog, deleteFoodLog,
  getPublicFiles, createPublicFile, deletePublicFile,
  today,
} from '../../db'
import { describeFood } from './assistantClient'
import type {
  Basics, BodyMeasurement, FoodLog, MedicalBackground, Note, NoteTag, PublicFile, Supplement, TrainingEnv,
} from '../../supabase/types'

Chart.register(PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Filler)

type L = 'zh' | 'en'
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))
const NOTE_TAGS: NoteTag[] = ['training', 'injury', 'goal', 'habit', 'medical', 'equipment', 'other']

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export function DataPanel({ lang }: { lang: L }) {
  const [basics, setBasics] = useState<Partial<Basics>>({})
  const [env, setEnv] = useState<Partial<TrainingEnv>>({})
  const [medical, setMedical] = useState<Partial<MedicalBackground>>({})
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [supps, setSupps] = useState<Supplement[]>([])
  const [food, setFood] = useState<FoodLog[]>([])
  const [files, setFiles] = useState<PublicFile[]>([])
  const [foodDraft, setFoodDraft] = useState<{ date: string; description: string; photo?: string; aiDesc?: string }>({ date: today(), description: '' })
  const [recognizing, setRecognizing] = useState(false)
  const [foodErr, setFoodErr] = useState<string | null>(null)

  // draft rows for the "add" forms
  const [mDraft, setMDraft] = useState<Partial<BodyMeasurement>>({ date: today() })
  const [noteDraft, setNoteDraft] = useState<{ content: string; tag: NoteTag }>({ content: '', tag: 'other' })
  const [supDraft, setSupDraft] = useState<Partial<Supplement>>({})

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

  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en)

  // Oldest→newest series for the trend chart (measurements come newest-first).
  const trend = useMemo(() => {
    const asc = [...measurements].reverse()
    const pick = (key: 'weight_kg' | 'body_fat_pct') =>
      asc.filter((m) => m[key] != null).map((m) => ({ x: m.date.slice(5), y: m[key] as number }))
    return { weight: pick('weight_kg'), fat: pick('body_fat_pct') }
  }, [measurements])

  return (
    <aside className="asst-memory asst-data">
      <p className="asst-hint">{t('都是可选的,填了对应聊天室授权后 AI 才会读。', 'All optional; the AI reads a module only in rooms you grant it.')}</p>

      {/* Basics */}
      <details open>
        <summary>{t('基础资料', 'Basics')}</summary>
        <div className="asst-data-grid">
          <label>{t('年龄', 'Age')}<input className="th-input" type="number" value={basics.age ?? ''} onChange={(e) => setBasics({ ...basics, age: num(e.target.value) })} /></label>
          <label>{t('性别', 'Sex')}<input className="th-input" value={basics.sex ?? ''} onChange={(e) => setBasics({ ...basics, sex: e.target.value })} /></label>
          <label>{t('生理性别', 'Biological sex')}<input className="th-input" value={basics.biological_sex ?? ''} onChange={(e) => setBasics({ ...basics, biological_sex: e.target.value })} /></label>
          <label>{t('身高(cm)', 'Height (cm)')}<input className="th-input" type="number" value={basics.height_cm ?? ''} onChange={(e) => setBasics({ ...basics, height_cm: num(e.target.value) })} /></label>
          <label>{t('训练年限', 'Training years')}<input className="th-input" type="number" value={basics.training_years ?? ''} onChange={(e) => setBasics({ ...basics, training_years: num(e.target.value) })} /></label>
          <label>{t('训练水平', 'Level')}<input className="th-input" value={basics.training_level ?? ''} onChange={(e) => setBasics({ ...basics, training_level: e.target.value })} /></label>
          <label>{t('工作类型', 'Work type')}<input className="th-input" value={basics.work_type ?? ''} onChange={(e) => setBasics({ ...basics, work_type: e.target.value })} placeholder={t('久坐/体力/轮班', 'sedentary/physical/shift')} /></label>
          <label>{t('睡眠(h)', 'Sleep (h)')}<input className="th-input" type="number" value={basics.sleep_hours ?? ''} onChange={(e) => setBasics({ ...basics, sleep_hours: num(e.target.value) })} /></label>
          <label>{t('静息心率', 'Resting HR')}<input className="th-input" type="number" value={basics.resting_hr ?? ''} onChange={(e) => setBasics({ ...basics, resting_hr: num(e.target.value) })} /></label>
          <label>{t('最大心率', 'Max HR')}<input className="th-input" type="number" value={basics.max_hr ?? ''} onChange={(e) => setBasics({ ...basics, max_hr: num(e.target.value) })} /></label>
        </div>
        <button className="th-btn" type="button" onClick={() => void saveBasics(basics)}>{t('保存', 'Save')}</button>
      </details>

      {/* Body measurements */}
      <details>
        <summary>{t('体测趋势', 'Measurements')}</summary>
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
          <label>{t('体重(kg)', 'Weight (kg)')}<input className="th-input" type="number" value={mDraft.weight_kg ?? ''} onChange={(e) => setMDraft({ ...mDraft, weight_kg: num(e.target.value) })} /></label>
          <label>{t('体脂(%)', 'Body fat (%)')}<input className="th-input" type="number" value={mDraft.body_fat_pct ?? ''} onChange={(e) => setMDraft({ ...mDraft, body_fat_pct: num(e.target.value) })} /></label>
          <label>{t('肌肉(kg)', 'Muscle (kg)')}<input className="th-input" type="number" value={mDraft.muscle_kg ?? ''} onChange={(e) => setMDraft({ ...mDraft, muscle_kg: num(e.target.value) })} /></label>
          <label>{t('腰围(cm)', 'Waist (cm)')}<input className="th-input" type="number" value={mDraft.waist_cm ?? ''} onChange={(e) => setMDraft({ ...mDraft, waist_cm: num(e.target.value) })} /></label>
        </div>
        <button className="th-btn" type="button" onClick={async () => {
          await addBodyMeasurement({
            date: mDraft.date ?? today(),
            weight_kg: mDraft.weight_kg ?? null, body_fat_pct: mDraft.body_fat_pct ?? null,
            muscle_kg: mDraft.muscle_kg ?? null, waist_cm: mDraft.waist_cm ?? null,
          })
          setMDraft({ date: today() })
          await reload()
        }}>{t('添加记录', 'Add')}</button>
        <ul className="asst-mem-list">
          {measurements.slice(0, 8).map((m) => (
            <li key={m.id} className="asst-data-row">
              <span>{m.date}: {[m.weight_kg && `${m.weight_kg}kg`, m.body_fat_pct && `${m.body_fat_pct}%`, m.muscle_kg && `${m.muscle_kg}kg肌`, m.waist_cm && `${m.waist_cm}cm腰`].filter(Boolean).join(', ')}</span>
              <button type="button" onClick={async () => { await deleteBodyMeasurement(m.id); await reload() }}>🗑</button>
            </li>
          ))}
        </ul>
      </details>

      {/* Training environment */}
      <details>
        <summary>{t('训练环境', 'Environment')}</summary>
        <div className="asst-data-grid">
          <label>{t('常用健身房', 'Usual gym')}<input className="th-input" value={env.gym ?? ''} onChange={(e) => setEnv({ ...env, gym: e.target.value })} /></label>
          <label>{t('器械', 'Equipment')}<input className="th-input" value={env.equipment ?? ''} onChange={(e) => setEnv({ ...env, equipment: e.target.value })} /></label>
          <label>{t('家庭设备', 'Home equipment')}<input className="th-input" value={env.home_equipment ?? ''} onChange={(e) => setEnv({ ...env, home_equipment: e.target.value })} /></label>
        </div>
        <button className="th-btn" type="button" onClick={() => void saveTrainingEnv(env)}>{t('保存', 'Save')}</button>
      </details>

      {/* Supplements */}
      <details>
        <summary>{t('补剂', 'Supplements')}</summary>
        <div className="asst-data-grid">
          <label>{t('名称', 'Name')}<input className="th-input" value={supDraft.name ?? ''} onChange={(e) => setSupDraft({ ...supDraft, name: e.target.value })} /></label>
          <label>{t('品牌', 'Brand')}<input className="th-input" value={supDraft.brand ?? ''} onChange={(e) => setSupDraft({ ...supDraft, brand: e.target.value })} /></label>
          <label>{t('剂量', 'Dose')}<input className="th-input" value={supDraft.dose ?? ''} onChange={(e) => setSupDraft({ ...supDraft, dose: e.target.value })} /></label>
          <label>{t('时间', 'Timing')}<input className="th-input" value={supDraft.timing ?? ''} onChange={(e) => setSupDraft({ ...supDraft, timing: e.target.value })} /></label>
          <label>{t('频率', 'Frequency')}<input className="th-input" value={supDraft.frequency ?? ''} onChange={(e) => setSupDraft({ ...supDraft, frequency: e.target.value })} /></label>
        </div>
        <button className="th-btn" type="button" disabled={!supDraft.name?.trim()} onClick={async () => {
          await createSupplement({ name: supDraft.name ?? '', brand: supDraft.brand ?? null, dose: supDraft.dose ?? null, timing: supDraft.timing ?? null, frequency: supDraft.frequency ?? null })
          setSupDraft({})
          await reload()
        }}>{t('添加', 'Add')}</button>
        <ul className="asst-mem-list">
          {supps.map((s) => (
            <li key={s.id} className="asst-data-row">
              <label className={s.still_using ? '' : 'is-stale'}>
                <input type="checkbox" checked={s.still_using} onChange={async (e) => { await updateSupplement(s.id, { still_using: e.target.checked }); await reload() }} />
                {s.name}{s.brand ? ` (${s.brand})` : ''}{s.dose ? ` · ${s.dose}` : ''}
              </label>
              <button type="button" onClick={async () => { await deleteSupplement(s.id); await reload() }}>🗑</button>
            </li>
          ))}
        </ul>
      </details>

      {/* Notes */}
      <details>
        <summary>{t('笔记', 'Notes')}</summary>
        <textarea className="th-input" rows={2} value={noteDraft.content} onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })} placeholder={t('随便写…', 'Anything…')} />
        <div className="asst-data-noteadd">
          <select className="th-input" value={noteDraft.tag} onChange={(e) => setNoteDraft({ ...noteDraft, tag: e.target.value as NoteTag })}>
            {NOTE_TAGS.map((tg) => <option key={tg} value={tg}>{tg}</option>)}
          </select>
          <button className="th-btn" type="button" disabled={!noteDraft.content.trim()} onClick={async () => {
            await createNote(noteDraft.content, noteDraft.tag)
            setNoteDraft({ content: '', tag: 'other' })
            await reload()
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
      </details>

      {/* Food — one entry = date + photo + text (+ AI recognition) */}
      <details>
        <summary>{t('饮食', 'Food')}</summary>
        <div className="asst-data-grid">
          <label>{t('日期', 'Date')}<input className="th-input" type="date" value={foodDraft.date} onChange={(e) => setFoodDraft({ ...foodDraft, date: e.target.value })} /></label>
          <label>{t('图片', 'Photo')}<input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) setFoodDraft({ ...foodDraft, photo: await fileToDataUrl(f), aiDesc: undefined })
          }} /></label>
        </div>
        {foodDraft.photo && <img className="asst-food-preview" src={foodDraft.photo} alt="" />}
        {foodDraft.photo && (
          <button className="th-btn" type="button" disabled={recognizing} onClick={async () => {
            if (!foodDraft.photo) return
            setRecognizing(true); setFoodErr(null)
            try {
              const desc = await describeFood(foodDraft.photo)
              setFoodDraft((d) => ({ ...d, aiDesc: desc }))
            } catch (err) {
              setFoodErr(err instanceof Error ? err.message : String(err))
            } finally {
              setRecognizing(false)
            }
          }}>{recognizing ? t('识别中…', 'Recognizing…') : t('AI 识别图片', 'AI recognize')}</button>
        )}
        {foodDraft.aiDesc !== undefined && (
          <label className="asst-data-full">{t('AI 识别(可改)', 'AI recognition (editable)')}
            <textarea className="th-input" rows={2} value={foodDraft.aiDesc} onChange={(e) => setFoodDraft({ ...foodDraft, aiDesc: e.target.value })} />
          </label>
        )}
        {foodErr && <p className="th-error">{foodErr}</p>}
        <label className="asst-data-full">{t('我的描述', 'My note')}
          <textarea className="th-input" rows={2} value={foodDraft.description} onChange={(e) => setFoodDraft({ ...foodDraft, description: e.target.value })} placeholder={t('吃了什么…', 'What you ate…')} />
        </label>
        <button className="th-btn" type="button" disabled={!foodDraft.description.trim() && !foodDraft.photo && !foodDraft.aiDesc} onClick={async () => {
          await createFoodLog(foodDraft.description, new Date(foodDraft.date).toISOString(), foodDraft.photo, foodDraft.aiDesc)
          setFoodDraft({ date: today(), description: '' })
          await reload()
        }}>{t('添加一条', 'Add entry')}</button>
        <ul className="asst-mem-list">
          {food.slice(0, 12).map((f) => (
            <li key={f.id} className="asst-data-row">
              <span>{f.eaten_at.slice(0, 10)}: {f.description || f.ai_description}{f.ai_description && f.description ? ` · AI:${f.ai_description}` : ''}{f.photo_path ? ' 📷' : ''}</span>
              <button type="button" onClick={async () => { await deleteFoodLog(f.id); await reload() }}>🗑</button>
            </li>
          ))}
        </ul>
      </details>

      {/* Public files */}
      <details>
        <summary>{t('公共文件', 'Files')}</summary>
        <p className="asst-hint">{t('小文件;文本会被提取供 AI 读取。按聊天室在「记忆」页授权。', 'Small files; text is extracted for the AI. Grant per room in the Memory tab.')}</p>
        <input type="file" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) { await createPublicFile(f); e.target.value = ''; await reload() }
        }} />
        <ul className="asst-mem-list">
          {files.map((f) => (
            <li key={f.id} className="asst-data-row">
              <span>{f.name}{f.content ? '' : ' (无文本)'}</span>
              <button type="button" onClick={async () => { await deletePublicFile(f.id); await reload() }}>🗑</button>
            </li>
          ))}
        </ul>
      </details>

      {/* Medical background — high-sensitivity */}
      <details>
        <summary>{t('医疗背景 ⚠', 'Medical ⚠')}</summary>
        <p className="asst-hint">{t('高敏感。只有你单独授权的聊天室能读,不会跨室共享。用于运动安全。', 'High-sensitivity. Only rooms you explicitly grant can read it; never shared across rooms. Used for exercise safety.')}</p>
        <label className="asst-data-full">{t('疾病史', 'Conditions')}<textarea className="th-input" rows={2} value={medical.conditions ?? ''} onChange={(e) => setMedical({ ...medical, conditions: e.target.value })} placeholder={t('心血管/血压/糖尿病/哮喘…', 'cardiovascular/BP/diabetes/asthma…')} /></label>
        <label className="asst-data-full">{t('手术史', 'Surgeries')}<textarea className="th-input" rows={2} value={medical.surgeries ?? ''} onChange={(e) => setMedical({ ...medical, surgeries: e.target.value })} /></label>
        <label className="asst-data-full">{t('运动限制', 'Restrictions')}<textarea className="th-input" rows={2} value={medical.restrictions ?? ''} onChange={(e) => setMedical({ ...medical, restrictions: e.target.value })} /></label>
        <label className="asst-data-full">{t('过敏', 'Allergies')}<textarea className="th-input" rows={2} value={medical.allergies ?? ''} onChange={(e) => setMedical({ ...medical, allergies: e.target.value })} /></label>
        <label className="asst-data-full">{t('家族病史', 'Family history')}<textarea className="th-input" rows={2} value={medical.family_history ?? ''} onChange={(e) => setMedical({ ...medical, family_history: e.target.value })} /></label>
        <label className="asst-data-full">{t('近期体检/血检', 'Recent labs')}<textarea className="th-input" rows={2} value={medical.recent_labs ?? ''} onChange={(e) => setMedical({ ...medical, recent_labs: e.target.value })} /></label>
        <button className="th-btn" type="button" onClick={() => void saveMedicalBackground(medical)}>{t('保存', 'Save')}</button>
      </details>
    </aside>
  )
}
