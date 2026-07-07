// Cycle tab (SPEC §6B): define an N-day training loop (A/B/C/D…), see today/next
// from the last logged cycle day, and per-muscle "days since last trained".
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createCycle,
  createDefaultSplitCycle,
  getActiveCycle,
  getCycleRounds,
  getCycles,
  getEntries,
  getExercises,
  setActiveCycle,
  skipCycleRound,
  softDeleteCycle,
  updateCycle,
  withUndo,
} from '../../db'
import { useLanguage } from '../../i18n'
import { useUndo } from '../../undo'
import {
  type BodyPart,
  type CycleDay,
  type CycleRound,
  type Exercise,
  type TrainingCycle,
  type WorkoutEntry,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import { muscleRecovery } from '../dashboard/stats'
import { ExerciseManager } from '../log'
import { RehabLoop } from '../injuries'
import { CategoryManager } from './CategoryManager'
import { currentRound } from './rounds'
import './cycle.css'

export function CycleScreen() {
  const { lang } = useLanguage()
  const { push } = useUndo()
  const [cycles, setCycles] = useState<TrainingCycle[]>([])
  const [active, setActive] = useState<TrainingCycle | null>(null)
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [exById, setExById] = useState<Record<string, Exercise>>({})
  const [rounds, setRounds] = useState<CycleRound[]>([])
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)

  const reload = useCallback(async () => {
    const [cs, act, es, exs] = await Promise.all([getCycles(), getActiveCycle(), getEntries(), getExercises()])
    setCycles(cs)
    setActive(act)
    setEntries(es)
    setExercises(exs)
    setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
    setRounds(act ? await getCycleRounds(act.id) : [])
  }, [])

  const round = useMemo(() => (active ? currentRound(active, rounds) : null), [active, rounds])

  useEffect(() => {
    void reload()
  }, [reload])

  const recovery = useMemo(() => muscleRecovery(entries, exById), [entries, exById])

  // Today / Next from the last logged cycle-day label in the active cycle order.
  const todayNext = useMemo(() => {
    if (!active || active.days.length === 0) return null
    const labels = active.days.map((d) => d.label)
    const lastLabel =
      entries.filter((e) => e.cycle_day_label).sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.cycle_day_label ?? null
    const idx = lastLabel ? labels.indexOf(lastLabel) : -1
    const nextLabel = labels[(idx + 1) % labels.length]
    const nextDay = active.days.find((d) => d.label === nextLabel) ?? null
    return { lastLabel, nextLabel, nextDay }
  }, [active, entries])

  async function addCycle() {
    if (!newName.trim()) return
    const name = newName.trim()
    const { result: c, undo } = await withUndo(['training_cycle'], () => createCycle({ name, days: [], active: cycles.length === 0 }))
    setNewName('')
    await reload()
    setEditId(c.id)
    push(lang === 'zh' ? `已新建循环「${name}」` : `Added cycle “${name}”`, async () => { await undo(); setEditId(null); await reload() })
  }

  async function deleteCycle(c: TrainingCycle) {
    const { undo } = await withUndo(['training_cycle'], () => softDeleteCycle(c.id))
    await reload()
    push(lang === 'zh' ? `已删除循环「${c.name}」` : `Deleted cycle “${c.name}”`, async () => { await undo(); await reload() })
  }

  async function activateCycle(c: TrainingCycle) {
    const { undo } = await withUndo(['training_cycle'], () => setActiveCycle(c.id))
    await reload()
    push(lang === 'zh' ? `已启用循环「${c.name}」` : `Activated “${c.name}”`, async () => { await undo(); await reload() })
  }

  async function addDefaultSplit() {
    const { undo } = await withUndo(['training_cycle'], () => createDefaultSplitCycle())
    await reload()
    push(lang === 'zh' ? '已创建四分化循环' : 'Added 4-split cycle', async () => { await undo(); await reload() })
  }

  async function skipRound() {
    if (!active || !round) return
    const msg = lang === 'zh'
      ? `结束第 ${round.index} 轮?未完成的 ${round.remaining.join('/') || '—'} 会被跳过。`
      : `End round ${round.index}? Unfinished days (${round.remaining.join('/') || '—'}) will be skipped.`
    if (!confirm(msg)) return
    const idx = round.index
    const { result: ok, undo } = await withUndo(['cycle_rounds'], () => skipCycleRound(active.id))
    await reload()
    if (!ok) return
    push(lang === 'zh' ? `已结束第 ${idx} 轮` : `Ended round ${idx}`, async () => { await undo(); await reload() })
  }

  return (
    <div className="cyc-screen">
      <RehabLoop lang={lang} />

      {todayNext && (
        <section className="cyc-todaynext">
          <span className="th-label">{active?.name} · today / next</span>
          <div className="cyc-tn">
            <span className="cyc-tn-last">{lang === 'zh' ? '上次' : 'Last'}: {todayNext.lastLabel ?? '—'}</span>
            <span className="cyc-arrow">→</span>
            <span className="cyc-tn-next">{lang === 'zh' ? '下次' : 'Next'}: {todayNext.nextLabel}</span>
            {todayNext.nextDay && (
              <span className="cyc-tn-detail">
                {todayNext.nextDay.title} · {todayNext.nextDay.body_parts.map((bp) => categoryLabel(bp, lang)).join(' / ')}
              </span>
            )}
          </div>
        </section>
      )}

      {active && round && active.days.length > 0 && (
        <section className="cyc-round">
          <div className="cyc-round-head">
            <span className="th-label">{lang === 'zh' ? '当前轮次' : 'Current round'}</span>
            <span className="cyc-round-num">Round {round.index}</span>
            {round.open && (
              <button className="hist-link danger cyc-round-skip-btn" type="button" onClick={() => void skipRound()}>
                {lang === 'zh' ? '结束本轮' : 'Skip round'}
              </button>
            )}
          </div>
          <div className="cyc-round-days">
            {round.labels.map((l) => (
              <span key={l} className={`cyc-round-day ${round.completed.includes(l) ? 'done' : ''} ${round.open && l === round.nextLabel ? 'next' : ''}`}>{l}</span>
            ))}
          </div>
          <span className="cyc-round-hint">
            {round.open
              ? (lang === 'zh' ? `还差 ${round.remaining.join(' / ') || '—'}` : `remaining: ${round.remaining.join(' / ') || '—'}`)
              : (lang === 'zh' ? '下一轮未开始 — 在 Log 里记录带循环日的训练即可开启' : 'next round not started — log a cycle-day workout to begin')}
          </span>
        </section>
      )}

      {active && rounds.length > 0 && (
        <section className="cyc-rounds-hist">
          <span className="th-label">{lang === 'zh' ? '轮次历史' : 'Round history'}</span>
          <ul className="cyc-rounds-list">
            {[...rounds].reverse().map((r) => (
              <li key={r.id} className="cyc-round-row">
                <span className="cyc-round-row-idx">R{r.index}</span>
                <span className="cyc-round-row-dates">{r.started_on} → {r.ended_on ?? '…'}</span>
                <span className="cyc-round-row-days">{r.completed_labels.join('') || '—'}</span>
                {r.skipped && <span className="cyc-round-badge skip">{lang === 'zh' ? '跳过' : 'skipped'}</span>}
                {!r.ended_on && <span className="cyc-round-badge open">{lang === 'zh' ? '进行中' : 'open'}</span>}
                {r.ended_on && !r.skipped && <span className="cyc-round-badge done">{lang === 'zh' ? '完成' : 'done'}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cyc-recovery">
        <span className="th-label">{lang === 'zh' ? '各肌群距上次训练' : 'Days since last trained'}</span>
        <div className="cyc-rec-grid">
          {recovery.map((r) => (
            <div key={r.bodyPart} className={`cyc-rec ${r.daysAgo != null && r.daysAgo >= 7 ? 'overdue' : ''}`}>
              <span className="cyc-rec-bp">{categoryLabel(r.bodyPart, lang)}</span>
              <span className="cyc-rec-days">{r.daysAgo == null ? '—' : `${r.daysAgo}d`}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cyc-categories">
        <span className="th-label">{lang === 'zh' ? '分类(部位)' : 'Categories'}</span>
        <CategoryManager lang={lang} />
      </section>

      <section className="cyc-library">
        <button className="cyc-lib-toggle" type="button" onClick={() => setShowLibrary((v) => !v)}>
          {lang === 'zh' ? '动作库(增删改查)' : 'Exercise library (manage)'} {showLibrary ? '▲' : '▼'}
        </button>
        {showLibrary && <ExerciseManager lang={lang} onChanged={reload} />}
      </section>

      <section className="cyc-cycles">
        <div className="cyc-add">
          <input className="th-input" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder={lang === 'zh' ? '新循环名,如 A/B/C/D' : 'New cycle, e.g. A/B/C/D'} />
          <button className="th-btn-ghost cyc-add-btn" type="button" onClick={addCycle} disabled={!newName.trim()}>+ Cycle</button>
        </div>
        <button className="th-btn-ghost cyc-tmpl-btn" type="button" onClick={() => void addDefaultSplit()}>
          {lang === 'zh' ? '+ 四分化模板 (A胸腹/B背二头/C腿腹/D肩三头)' : '+ 4-split template (A/B/C/D)'}
        </button>

        {cycles.map((c) =>
          editId === c.id ? (
            <CycleDaysEditor key={c.id} cycle={c} lang={lang} exercises={exercises}
              onSaved={async () => { setEditId(null); await reload() }}
              onCancel={() => setEditId(null)} />
          ) : (
            <div key={c.id} className="cyc-card">
              <div className="cyc-card-head">
                <span className="cyc-name">{c.name}</span>
                {c.active ? (
                  <span className="cyc-active-badge">active</span>
                ) : (
                  <button className="hist-link" type="button" onClick={() => void activateCycle(c)}>set active</button>
                )}
                <div className="cyc-card-actions">
                  <button className="hist-link" type="button" onClick={() => setEditId(c.id)}>edit</button>
                  <button className="hist-link danger" type="button" onClick={() => void deleteCycle(c)}>delete</button>
                </div>
              </div>
              <div className="cyc-days">
                {c.days.length === 0 ? (
                  <span className="cyc-empty">No days — click edit.</span>
                ) : (
                  c.days.map((d) => (
                    <span key={d.label} className="cyc-day">
                      <strong>{d.label}</strong> {d.title} · {d.body_parts.map((bp) => categoryLabel(bp, lang)).join('/')}
                    </span>
                  ))
                )}
              </div>
            </div>
          ),
        )}
      </section>
    </div>
  )
}

function CycleDaysEditor({
  cycle,
  lang,
  exercises,
  onSaved,
  onCancel,
}: {
  cycle: TrainingCycle
  lang: 'en' | 'zh'
  exercises: Exercise[]
  onSaved: () => void
  onCancel: () => void
}) {
  const cats = useCategories()
  const { push } = useUndo()
  const [name, setName] = useState(cycle.name)
  const [days, setDays] = useState<CycleDay[]>(
    cycle.days.map((d) => ({ ...d, body_parts: [...d.body_parts], exercise_ids: [...(d.exercise_ids ?? [])] })),
  )

  function setDay(i: number, patch: Partial<CycleDay>) {
    setDays((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }
  function toggleBp(i: number, bp: BodyPart) {
    setDays((ds) =>
      ds.map((d, idx) =>
        idx === i
          ? { ...d, body_parts: d.body_parts.includes(bp) ? d.body_parts.filter((x) => x !== bp) : [...d.body_parts, bp] }
          : d,
      ),
    )
  }
  function toggleEx(i: number, exId: string) {
    setDays((ds) =>
      ds.map((d, idx) => {
        if (idx !== i) return d
        const cur = d.exercise_ids ?? []
        return { ...d, exercise_ids: cur.includes(exId) ? cur.filter((x) => x !== exId) : [...cur, exId] }
      }),
    )
  }
  function addDay() {
    const label = String.fromCharCode(65 + days.length) // A, B, C…
    setDays((ds) => [...ds, { label, title: '', body_parts: [], exercise_ids: [] }])
  }

  const exName = (e: Exercise) => (lang === 'zh' ? e.name_zh : e.name_en) || e.name_zh || e.name_en

  async function save() {
    const { undo } = await withUndo(['training_cycle'], () => updateCycle(cycle.id, { name, days }))
    onSaved()
    push(lang === 'zh' ? `已保存循环「${name}」` : `Saved cycle “${name}”`, async () => { await undo(); onSaved() })
  }

  return (
    <div className="cyc-editor">
      <input className="th-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="cycle name" />
      {days.map((d, i) => {
        const dayExercises = exercises.filter((e) => !e.is_warmup && !e.is_rehab && e.body_parts.some((bp) => d.body_parts.includes(bp)))
        const warmups = exercises.filter((e) => e.is_warmup)
        return (
          <div key={i} className="cyc-edit-day">
            <div className="cyc-edit-row">
              <input className="th-input cyc-label" value={d.label} onChange={(e) => setDay(i, { label: e.target.value })} placeholder="A" />
              <input className="th-input" value={d.title} onChange={(e) => setDay(i, { title: e.target.value })} placeholder={lang === 'zh' ? '标题,如 胸+腹' : 'title, e.g. Chest+Abs'} />
              <button className="cyc-del" type="button" onClick={() => setDays((ds) => ds.filter((_, idx) => idx !== i))}>×</button>
            </div>
            <div className="cyc-bp-row">
              {cats.map((c) => (
                <button key={c.key} type="button" className={`cyc-bp ${d.body_parts.includes(c.key) ? 'on' : ''}`} onClick={() => toggleBp(i, c.key)}>
                  {categoryLabel(c.key, lang)}
                </button>
              ))}
            </div>
            {warmups.length > 0 && (
              <div className="cyc-ex-pick">
                <span className="cyc-ex-hint">{lang === 'zh' ? '热身:' : 'Warmup:'}</span>
                {warmups.map((e) => (
                  <button key={e.id} type="button" className={`cyc-ex ${(d.exercise_ids ?? []).includes(e.id) ? 'on' : ''}`} onClick={() => toggleEx(i, e.id)}>
                    {exName(e)}
                  </button>
                ))}
              </div>
            )}
            {d.body_parts.length > 0 && (
              <div className="cyc-ex-pick">
                <span className="cyc-ex-hint">{lang === 'zh' ? '挂动作:' : 'Attach exercises:'}</span>
                {dayExercises.length === 0 ? (
                  <span className="cyc-empty">{lang === 'zh' ? '该部位还没动作(去 Log 加)' : 'no exercises for these parts yet'}</span>
                ) : (
                  dayExercises.map((e) => (
                    <button key={e.id} type="button" className={`cyc-ex ${(d.exercise_ids ?? []).includes(e.id) ? 'on' : ''}`} onClick={() => toggleEx(i, e.id)}>
                      {exName(e)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
      <button className="th-btn-ghost cyc-add-day" type="button" onClick={addDay}>+ day</button>
      <div className="cyc-editor-actions">
        <button className="th-btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="th-btn" type="button" onClick={() => void save()}>Save</button>
      </div>
    </div>
  )
}
