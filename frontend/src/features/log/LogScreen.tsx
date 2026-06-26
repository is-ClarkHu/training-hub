// Log tab (SPEC §7.1): date → pick/add exercise → measure-type-aware set inputs
// (+ superset toggle) → note (recognized tags applied on save) → save. "Add
// another exercise" keeps the date. Local-first: writes hit Dexie immediately;
// the SyncEngine (later module) pushes them to Supabase.
import { useEffect, useState } from 'react'
import { createEntryWithSets, getExercises, getInjuries, today, type NewSetInput } from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import type { Exercise, Injury, InjuryModified } from '../../supabase/types'
import { ExercisePicker } from './ExercisePicker'
import { SetEditor } from './SetEditor'
import { AddExerciseDialog } from './AddExerciseDialog'
import { draftsToSetInputs, emptySet, exerciseName, type SetDraft } from './util'
import './log.css'

interface LoggedItem {
  id: string
  name: string
  detail: string
  tagKeys: string[]
}

export function LogScreen() {
  const { lang } = useLanguage()
  const [date, setDate] = useState(today())
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [sets, setSets] = useState<SetDraft[]>([emptySet()])
  const [note, setNote] = useState('')
  const [isSuperset, setIsSuperset] = useState(false)
  const [dialog, setDialog] = useState<{ open: boolean; name: string }>({ open: false, name: '' })
  const [logged, setLogged] = useState<LoggedItem[]>([])
  const [saving, setSaving] = useState(false)
  const [activeInjuries, setActiveInjuries] = useState<Injury[]>([])
  const [injuryMod, setInjuryMod] = useState<InjuryModified | 'none'>('none')
  const [injuryId, setInjuryId] = useState('')

  useEffect(() => {
    void getExercises().then(setExercises)
    void getInjuries().then((list) => setActiveInjuries(list.filter((i) => i.status !== 'recovered')))
  }, [])

  const parsed = parseNote(note)

  function selectExercise(ex: Exercise) {
    setExercise(ex)
    setSets([emptySet()])
    setIsSuperset(false)
  }

  function onExerciseCreated(ex: Exercise) {
    setExercises((prev) => [...prev, ex])
    setDialog({ open: false, name: '' })
    selectExercise(ex)
  }

  function buildSets(): NewSetInput[] {
    if (!exercise) return []
    return draftsToSetInputs(sets, exercise.measure_type, parsed, isSuperset)
  }

  const validSets = buildSets()
  const canSave = !!exercise && validSets.length > 0 && !saving

  async function onSave() {
    if (!exercise) return
    const setInputs = buildSets()
    if (setInputs.length === 0) return
    setSaving(true)
    await createEntryWithSets(
      {
        date,
        exercise_id: exercise.id,
        is_superset: isSuperset,
        note_raw: note,
        note_tags: parsed.tagKeys,
        injury_modified: injuryMod === 'none' ? null : injuryMod,
        injury_id: injuryMod === 'none' ? null : injuryId || null,
      },
      setInputs,
    )
    const detail = setInputs
      .map((s) =>
        exercise.measure_type === 'duration'
          ? `${s.duration_sec}s`
          : exercise.measure_type === 'reps_only'
            ? `${s.reps}${s.per_side ? '/side' : ''}`
            : `${s.weight ?? '–'}×${s.reps ?? '–'}`,
      )
      .join(', ')
    setLogged((prev) => [
      { id: crypto.randomUUID(), name: exerciseName(exercise, lang), detail, tagKeys: parsed.tagKeys },
      ...prev,
    ])
    // Keep the date; reset the rest for the next exercise (§7.1).
    setExercise(null)
    setSets([emptySet()])
    setNote('')
    setIsSuperset(false)
    setInjuryMod('none')
    setInjuryId('')
    setSaving(false)
  }

  return (
    <div className="log-screen">
      <header className="log-head">
        <div className="log-field">
          <label className="th-label" htmlFor="log-date">Date</label>
          <input id="log-date" className="th-input log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </header>

      <ExercisePicker
        lang={lang}
        exercises={exercises}
        selectedId={exercise?.id ?? null}
        onSelect={selectExercise}
        onAddNew={(name) => setDialog({ open: true, name })}
      />

      {exercise && (
        <section className="log-entry">
          <div className="log-entry-head">
            <h3>{exerciseName(exercise, lang)}</h3>
            <label className="log-superset">
              <input type="checkbox" checked={isSuperset} onChange={(e) => setIsSuperset(e.target.checked)} />
              {lang === 'zh' ? '超级组' : 'superset'}
            </label>
          </div>

          <SetEditor lang={lang} measureType={exercise.measure_type} sets={sets} onChange={setSets} />

          <div className="log-field">
            <label className="th-label" htmlFor="log-note">Note</label>
            <input
              id="log-note"
              className="th-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={lang === 'zh' ? '例如 每侧 / 热身 / 力竭' : 'e.g. 每侧 / 热身 / 力竭'}
            />
            {parsed.tagKeys.length > 0 && (
              <div className="log-tagchips">
                {parsed.tagKeys.map((k) => (
                  <span key={k} className="log-tagchip">{noteTagLabel(k, lang)}</span>
                ))}
              </div>
            )}
          </div>

          {activeInjuries.length > 0 && (
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '伤病影响' : 'Injury impact'}</label>
              <div className="log-row">
                <select
                  className="th-input"
                  value={injuryMod}
                  onChange={(e) => setInjuryMod(e.target.value as InjuryModified | 'none')}
                >
                  <option value="none">{lang === 'zh' ? '无' : 'none'}</option>
                  <option value="reduced">{lang === 'zh' ? '减量' : 'reduced'}</option>
                  <option value="paused">{lang === 'zh' ? '暂停' : 'paused'}</option>
                </select>
                {injuryMod !== 'none' && (
                  <select className="th-input" value={injuryId} onChange={(e) => setInjuryId(e.target.value)}>
                    <option value="">{lang === 'zh' ? '关联伤病…' : 'link injury…'}</option>
                    {activeInjuries.map((i) => (
                      <option key={i.id} value={i.id}>{i.body_area}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          <button className="th-btn" type="button" onClick={onSave} disabled={!canSave}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存' : 'Save exercise'}
          </button>
        </section>
      )}

      {logged.length > 0 && (
        <section className="log-session">
          <span className="th-label">Logged this session</span>
          <ul className="log-session-list">
            {logged.map((item) => (
              <li key={item.id} className="log-session-item">
                <span className="log-session-name">{item.name}</span>
                <span className="log-session-detail">{item.detail}</span>
                {item.tagKeys.map((k) => (
                  <span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog.open && (
        <AddExerciseDialog
          lang={lang}
          initialName={dialog.name}
          onCreated={onExerciseCreated}
          onClose={() => setDialog({ open: false, name: '' })}
        />
      )}
    </div>
  )
}
