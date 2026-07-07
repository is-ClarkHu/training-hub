// Rehab loop (§6A Phase 3), mounted at the top of the Cycle tab. For each active
// injury it closes the loop: assess symptoms → execute the rehab plan → observe
// training response → advance the stage. Recovered injuries drop out (archived).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { addInjuryAssessment, getEntries, getExercises, getInjuries, updateInjury } from '../../db'
import type { Exercise, Injury, InjuryStatus, WorkoutEntry } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { exerciseName } from '../log/util'
import {
  INJURY_STAGES,
  INJURY_STATUS_LABELS,
  bodyAreaLabel,
  daysSince,
} from './util'

const RESPONSE_WINDOW_DAYS = 14

export function RehabLoop({ lang }: { lang: TranslationTarget }) {
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [inj, exs, ents] = await Promise.all([getInjuries(), getExercises(), getEntries()])
    setInjuries(inj)
    setExercises(exs)
    setEntries(ents)
    setLoading(false)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const active = injuries.filter((i) => i.status !== 'recovered')
  if (loading || active.length === 0) return null

  return (
    <section className="loop-section">
      <span className="th-label">{lang === 'zh' ? '康复循环' : 'Rehab loop'}</span>
      <div className="loop-list">
        {active.map((i) => (
          <InjuryLoopCard key={i.id} injury={i} exercises={exercises} entries={entries} lang={lang} onChange={reload} />
        ))}
      </div>
    </section>
  )
}

function nextStage(status: InjuryStatus): InjuryStatus {
  const idx = INJURY_STAGES.indexOf(status)
  if (idx >= 0 && idx < INJURY_STAGES.length - 1) return INJURY_STAGES[idx + 1]
  return 'rehab_training' // relapsed / off-line → resume rehab
}

function InjuryLoopCard({
  injury,
  exercises,
  entries,
  lang,
  onChange,
}: {
  injury: Injury
  exercises: Exercise[]
  entries: WorkoutEntry[]
  lang: TranslationTarget
  onChange: () => void
}) {
  const [editingPlan, setEditingPlan] = useState(false)
  const [pain, setPain] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const exById = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises])
  const rehabExercises = useMemo(() => exercises.filter((e) => e.is_rehab), [exercises])
  const planExercises = injury.rehab_plan_exercise_ids
    .map((id) => exById[id])
    .filter((e): e is Exercise => !!e)

  const currentIdx = INJURY_STAGES.indexOf(injury.status)
  const isStage = currentIdx >= 0

  // Training response: rehab entries linked to this injury within the window.
  const response = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RESPONSE_WINDOW_DAYS)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const linked = entries.filter(
      (e) => e.injury_id === injury.id && !e.deleted && exById[e.exercise_id]?.is_rehab && e.date >= cutoffStr,
    )
    const lastDate = entries
      .filter((e) => e.injury_id === injury.id && !e.deleted && exById[e.exercise_id]?.is_rehab)
      .map((e) => e.date)
      .sort()
      .pop()
    return { count: linked.length, lastDate }
  }, [entries, exById, injury.id])

  const recentAssessments = injury.assessments.slice(-5)
  const latest = recentAssessments[recentAssessments.length - 1]
  const prev = recentAssessments[recentAssessments.length - 2]
  const trend = latest && prev ? latest.pain - prev.pain : null

  async function advance() {
    setBusy(true)
    await updateInjury(injury.id, { status: nextStage(injury.status) })
    setBusy(false)
    onChange()
  }
  async function togglePlan(exId: string) {
    const cur = injury.rehab_plan_exercise_ids
    const next = cur.includes(exId) ? cur.filter((x) => x !== exId) : [...cur, exId]
    await updateInjury(injury.id, { rehab_plan_exercise_ids: next })
    onChange()
  }
  async function saveAssessment() {
    const p = Number(pain)
    if (pain === '' || !Number.isFinite(p)) return
    setBusy(true)
    await addInjuryAssessment(injury.id, p, note)
    setPain('')
    setNote('')
    setBusy(false)
    onChange()
  }

  return (
    <div className="loop-card">
      <div className="loop-head">
        <span className="loop-area">{bodyAreaLabel(injury, lang)}</span>
        <span className={`inj-status-badge ${injury.status}`}>{INJURY_STATUS_LABELS[injury.status][lang]}</span>
        <span className="loop-days">{daysSince(injury.started_on)}{lang === 'zh' ? '天' : 'd'}</span>
      </div>

      {/* stage strip */}
      <div className="loop-stages">
        {INJURY_STAGES.map((s, idx) => (
          <span key={s} className={`loop-stage ${isStage && idx <= currentIdx ? 'done' : ''} ${idx === currentIdx ? 'current' : ''}`}>
            {INJURY_STATUS_LABELS[s][lang]}
          </span>
        ))}
        {injury.status !== 'recovered' && (
          <button className="th-btn-ghost loop-advance" type="button" onClick={advance} disabled={busy}>
            → {INJURY_STATUS_LABELS[nextStage(injury.status)][lang]}
          </button>
        )}
      </div>

      {/* rehab plan */}
      <div className="loop-block">
        <div className="loop-block-head">
          <span className="loop-block-title">{lang === 'zh' ? '康复计划' : 'Rehab plan'}</span>
          <button className="hist-link" type="button" onClick={() => setEditingPlan((v) => !v)}>
            {editingPlan ? (lang === 'zh' ? '完成' : 'done') : (lang === 'zh' ? '编辑' : 'edit')}
          </button>
        </div>
        {editingPlan ? (
          rehabExercises.length === 0 ? (
            <p className="loop-hint">{lang === 'zh' ? '康复库还没动作 —— 去 Injuries 页康复库添加。' : 'No rehab exercises yet — add them in the Injuries rehab library.'}</p>
          ) : (
            <div className="loop-plan-pick">
              {rehabExercises.map((e) => (
                <button key={e.id} type="button"
                  className={`loop-ex ${injury.rehab_plan_exercise_ids.includes(e.id) ? 'on' : ''}`}
                  onClick={() => void togglePlan(e.id)}>
                  {exerciseName(e, lang)}
                </button>
              ))}
            </div>
          )
        ) : planExercises.length === 0 ? (
          <p className="loop-hint">{lang === 'zh' ? '还没挂康复动作 —— 点「编辑」从库里选。' : 'No plan yet — tap edit to assign rehab moves.'}</p>
        ) : (
          <div className="loop-plan-list">
            {planExercises.map((e) => (
              <div key={e.id} className="loop-plan-item">
                <span>{exerciseName(e, lang)}</span>
                {e.rehab_dosage && <span className="rehab-dosage">{e.rehab_dosage}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* symptom assessment */}
      <div className="loop-block">
        <div className="loop-block-head">
          <span className="loop-block-title">{lang === 'zh' ? '症状评估' : 'Symptoms'}</span>
          {latest && (
            <span className="loop-pain-latest">
              {lang === 'zh' ? '最近疼痛' : 'latest pain'} {latest.pain}/10
              {trend != null && trend !== 0 && (
                <span className={trend < 0 ? 'loop-trend-good' : 'loop-trend-bad'}>{trend < 0 ? ' ↓' : ' ↑'}{Math.abs(trend)}</span>
              )}
            </span>
          )}
        </div>
        <div className="log-row loop-pain-input">
          <select className="th-input" value={pain} onChange={(e) => setPain(e.target.value)} aria-label="pain">
            <option value="">{lang === 'zh' ? '疼痛 0–10' : 'pain 0–10'}</option>
            {Array.from({ length: 11 }, (_, n) => (<option key={n} value={n}>{n}</option>))}
          </select>
          <input className="th-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={lang === 'zh' ? '备注(可选)' : 'note (optional)'} />
          <button className="th-btn-ghost log-suggest" type="button" onClick={saveAssessment} disabled={busy || pain === ''}>
            {lang === 'zh' ? '记录' : 'Log'}
          </button>
        </div>
        {recentAssessments.length > 0 && (
          <div className="loop-pain-trend">
            {recentAssessments.map((a, idx) => (
              <span key={idx} className="loop-pain-chip" title={a.note}>{a.date.slice(5)} · {a.pain}</span>
            ))}
          </div>
        )}
      </div>

      {/* training response */}
      <div className="loop-response">
        <span>{lang === 'zh' ? '训练反应' : 'Response'}:</span>
        <span className="inj-stat">{response.count} {lang === 'zh' ? `次康复(近${RESPONSE_WINDOW_DAYS}天)` : `rehab logs (${RESPONSE_WINDOW_DAYS}d)`}</span>
        {response.lastDate && <span className="loop-last">{lang === 'zh' ? '最近' : 'last'} {response.lastDate}</span>}
        <span className="loop-hint-inline">{lang === 'zh' ? '在 Log 记录计划动作' : 'log plan moves in Log'}</span>
      </div>
    </div>
  )
}
