// Log tab (SPEC §7.1, redesigned): one place to log everything. Pick an activity
// — a strength exercise (→ per-set inputs) or a sport (→ tier + hours). Date is
// shared; when an active training cycle is set you can tag the cycle day and the
// day's planned exercises appear as a quick-pick. Local-first writes.
import { useEffect, useState } from 'react'
import {
  createEntryWithSets,
  createSportSession,
  getActiveCycle,
  getExercises,
  getInjuries,
  getSports,
  today,
  type NewSetInput,
} from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import { tierLabel } from '../sports'
import type {
  Exercise,
  Injury,
  InjuryModified,
  Sport,
  TierLevel,
  TrainingCycle,
} from '../../supabase/types'
import { ExercisePicker } from './ExercisePicker'
import { SetEditor } from './SetEditor'
import { AddExerciseDialog } from './AddExerciseDialog'
import { draftsToSetInputs, emptySet, exerciseName, toNumber, type SetDraft } from './util'
import './log.css'

type Selection =
  | { kind: 'exercise'; ex: Exercise }
  | { kind: 'sport'; sport: Sport }
  | null

interface LoggedItem { id: string; name: string; detail: string; tagKeys: string[] }

export function LogScreen() {
  const { lang } = useLanguage()
  const [date, setDate] = useState(today())
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [activeInjuries, setActiveInjuries] = useState<Injury[]>([])
  const [activeCycle, setActiveCycle] = useState<TrainingCycle | null>(null)
  const [cycleDay, setCycleDay] = useState('')

  const [sel, setSel] = useState<Selection>(null)
  const [dialog, setDialog] = useState<{ open: boolean; name: string }>({ open: false, name: '' })
  const [logged, setLogged] = useState<LoggedItem[]>([])
  const [saving, setSaving] = useState(false)

  // exercise form
  const [sets, setSets] = useState<SetDraft[]>([emptySet()])
  const [isSuperset, setIsSuperset] = useState(false)
  const [injuryMod, setInjuryMod] = useState<InjuryModified | 'none'>('none')
  const [injuryId, setInjuryId] = useState('')
  // sport form
  const [tier, setTier] = useState<TierLevel>(1)
  const [hours, setHours] = useState('')
  const [sInjury, setSInjury] = useState(false)
  const [sEstimated, setSEstimated] = useState(false)
  // shared
  const [note, setNote] = useState('')

  useEffect(() => {
    void getExercises().then(setExercises)
    void getSports().then(setSports)
    void getInjuries().then((l) => setActiveInjuries(l.filter((i) => i.status !== 'recovered')))
    void getActiveCycle().then(setActiveCycle)
  }, [])

  const parsed = parseNote(note)

  function resetForms() {
    setSets([emptySet()])
    setIsSuperset(false)
    setInjuryMod('none')
    setInjuryId('')
    setTier(1)
    setHours('')
    setSInjury(false)
    setSEstimated(false)
    setNote('')
  }
  function selectExercise(ex: Exercise) {
    setSel({ kind: 'exercise', ex })
    resetForms()
  }
  function selectSport(sport: Sport) {
    setSel({ kind: 'sport', sport })
    resetForms()
  }
  function onExerciseCreated(ex: Exercise) {
    setExercises((prev) => [...prev, ex])
    setDialog({ open: false, name: '' })
    selectExercise(ex)
  }

  // day's planned exercises (§6B) as a quick-pick
  const planExercises: Exercise[] = (() => {
    const day = activeCycle?.days.find((d) => d.label === cycleDay)
    if (!day?.exercise_ids?.length) return []
    return day.exercise_ids.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e)
  })()

  function buildSets(): NewSetInput[] {
    if (sel?.kind !== 'exercise') return []
    return draftsToSetInputs(sets, sel.ex.measure_type, parsed, isSuperset)
  }

  const canSaveExercise = sel?.kind === 'exercise' && buildSets().length > 0 && !saving
  const canSaveSport = sel?.kind === 'sport' && (toNumber(hours) ?? 0) > 0 && !saving

  async function saveExercise() {
    if (sel?.kind !== 'exercise') return
    const setInputs = buildSets()
    if (setInputs.length === 0) return
    setSaving(true)
    await createEntryWithSets(
      {
        date,
        exercise_id: sel.ex.id,
        is_superset: isSuperset,
        note_raw: note,
        note_tags: parsed.tagKeys,
        cycle_day_label: cycleDay || null,
        injury_modified: injuryMod === 'none' ? null : injuryMod,
        injury_id: injuryMod === 'none' ? null : injuryId || null,
      },
      setInputs,
    )
    const detail = setInputs
      .map((s) =>
        sel.ex.measure_type === 'duration'
          ? `${s.duration_sec}s`
          : sel.ex.measure_type === 'reps_only'
            ? `${s.reps}${s.per_side ? '/side' : ''}`
            : `${s.weight ?? '–'}×${s.reps ?? '–'}`,
      )
      .join(', ')
    finishSave(exerciseName(sel.ex, lang), detail)
  }

  async function saveSport() {
    if (sel?.kind !== 'sport') return
    const h = toNumber(hours)
    if (!h || h <= 0) return
    setSaving(true)
    await createSportSession({
      date,
      sport_id: sel.sport.id,
      tier,
      hours: h,
      injury: sInjury,
      estimated: sEstimated,
      note_raw: note,
      note_tags: parsed.tagKeys,
    })
    finishSave(
      (lang === 'zh' ? sel.sport.name_zh : sel.sport.name_en) || sel.sport.name_zh,
      `${h}h · ${tierLabel(sel.sport, tier, lang)}${sInjury ? ' · injury' : ''}`,
    )
  }

  function finishSave(name: string, detail: string) {
    setLogged((prev) => [{ id: crypto.randomUUID(), name, detail, tagKeys: parsed.tagKeys }, ...prev])
    setSel(null)
    resetForms()
    setSaving(false)
  }

  return (
    <div className="log-screen">
      <header className="log-head">
        <div className="log-field">
          <label className="th-label" htmlFor="log-date">{lang === 'zh' ? '日期' : 'Date'}</label>
          <input id="log-date" className="th-input log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {activeCycle && activeCycle.days.length > 0 && (
          <div className="log-field">
            <label className="th-label" htmlFor="log-cd">{lang === 'zh' ? '循环日' : 'Cycle day'}</label>
            <select id="log-cd" className="th-input log-cycleday" value={cycleDay} onChange={(e) => setCycleDay(e.target.value)}>
              <option value="">—</option>
              {activeCycle.days.map((d) => (
                <option key={d.label} value={d.label}>{d.label}{d.title ? ` · ${d.title}` : ''}</option>
              ))}
            </select>
          </div>
        )}
      </header>

      {planExercises.length > 0 && (
        <div className="log-plan">
          <span className="log-group-label">{lang === 'zh' ? '今日计划' : 'Today’s plan'}</span>
          <div className="log-chips">
            {planExercises.map((ex) => (
              <button key={ex.id} type="button" className={`log-chip ${sel?.kind === 'exercise' && sel.ex.id === ex.id ? 'is-selected' : ''}`} onClick={() => selectExercise(ex)}>
                {exerciseName(ex, lang)}
              </button>
            ))}
          </div>
        </div>
      )}

      <ExercisePicker
        lang={lang}
        exercises={exercises}
        sports={sports}
        selectedId={sel ? (sel.kind === 'exercise' ? sel.ex.id : sel.sport.id) : null}
        onSelect={selectExercise}
        onSelectSport={selectSport}
        onAddNew={(name) => setDialog({ open: true, name })}
      />

      {sel?.kind === 'exercise' && (
        <section className="log-entry">
          <div className="log-entry-head">
            <h3>{exerciseName(sel.ex, lang)}</h3>
            <label className="log-superset">
              <input type="checkbox" checked={isSuperset} onChange={(e) => setIsSuperset(e.target.checked)} />
              {lang === 'zh' ? '超级组' : 'superset'}
            </label>
          </div>

          <SetEditor lang={lang} measureType={sel.ex.measure_type} sets={sets} onChange={setSets} />

          <NoteField lang={lang} note={note} setNote={setNote} tagKeys={parsed.tagKeys} />

          {activeInjuries.length > 0 && (
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '伤病影响' : 'Injury impact'}</label>
              <div className="log-row">
                <select className="th-input" value={injuryMod} onChange={(e) => setInjuryMod(e.target.value as InjuryModified | 'none')}>
                  <option value="none">{lang === 'zh' ? '无' : 'none'}</option>
                  <option value="reduced">{lang === 'zh' ? '减量' : 'reduced'}</option>
                  <option value="paused">{lang === 'zh' ? '暂停' : 'paused'}</option>
                </select>
                {injuryMod !== 'none' && (
                  <select className="th-input" value={injuryId} onChange={(e) => setInjuryId(e.target.value)}>
                    <option value="">{lang === 'zh' ? '关联伤病…' : 'link injury…'}</option>
                    {activeInjuries.map((i) => (<option key={i.id} value={i.id}>{i.body_area}</option>))}
                  </select>
                )}
              </div>
            </div>
          )}

          <button className="th-btn" type="button" onClick={saveExercise} disabled={!canSaveExercise}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存' : 'Save exercise'}
          </button>
        </section>
      )}

      {sel?.kind === 'sport' && (
        <section className="log-entry">
          <div className="log-entry-head">
            <h3>{(lang === 'zh' ? sel.sport.name_zh : sel.sport.name_en) || sel.sport.name_zh}</h3>
          </div>
          <div className="log-grid2">
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '档位' : 'Tier'}</label>
              <select className="th-input" value={tier} onChange={(e) => setTier(Number(e.target.value) as TierLevel)}>
                {[1, 2, 3, 4].map((tv) => (<option key={tv} value={tv}>{tv} · {tierLabel(sel.sport, tv, lang)}</option>))}
              </select>
            </div>
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '时长(小时)' : 'Hours'}</label>
              <input className="th-input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="2" />
            </div>
          </div>
          <div className="log-row">
            <label className="log-superset"><input type="checkbox" checked={sInjury} onChange={(e) => setSInjury(e.target.checked)} />{lang === 'zh' ? '伤病' : 'injury'}</label>
            <label className="log-superset"><input type="checkbox" checked={sEstimated} onChange={(e) => setSEstimated(e.target.checked)} />{lang === 'zh' ? '估算' : 'estimated'}</label>
          </div>
          <NoteField lang={lang} note={note} setNote={setNote} tagKeys={parsed.tagKeys} />
          <button className="th-btn" type="button" onClick={saveSport} disabled={!canSaveSport}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存场次' : 'Save session'}
          </button>
        </section>
      )}

      {logged.length > 0 && (
        <section className="log-session">
          <span className="th-label">{lang === 'zh' ? '本次已记录' : 'Logged this session'}</span>
          <ul className="log-session-list">
            {logged.map((item) => (
              <li key={item.id} className="log-session-item">
                <span className="log-session-name">{item.name}</span>
                <span className="log-session-detail">{item.detail}</span>
                {item.tagKeys.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog.open && (
        <AddExerciseDialog lang={lang} initialName={dialog.name} onCreated={onExerciseCreated} onClose={() => setDialog({ open: false, name: '' })} />
      )}
    </div>
  )
}

function NoteField({ lang, note, setNote, tagKeys }: { lang: 'en' | 'zh'; note: string; setNote: (v: string) => void; tagKeys: string[] }) {
  return (
    <div className="log-field">
      <label className="th-label" htmlFor="log-note">{lang === 'zh' ? '笔记' : 'Note'}</label>
      <input id="log-note" className="th-input" value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={lang === 'zh' ? '例如 每侧 / 热身 / 力竭' : 'e.g. 每侧 / 热身 / 力竭'} />
      {tagKeys.length > 0 && (
        <div className="log-tagchips">
          {tagKeys.map((k) => (<span key={k} className="log-tagchip">{noteTagLabel(k, lang)}</span>))}
        </div>
      )}
    </div>
  )
}
