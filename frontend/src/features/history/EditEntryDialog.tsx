// Shared entry-edit modal — used by History cards (both layouts), the review
// stepper, and the Log screen's "logged this session" list. Swaps the exercise
// (same measure type), edits sets via SetEditor, re-parses the note (§5.3), and
// edits which split(s)/round the entry counts toward. Save writes through
// updateEntry; delete soft-deletes.
//
// The cycle data is loaded here rather than passed in, so any screen can open the
// dialog without threading cycles/rounds/assignments through its own props.
import { useEffect, useState } from 'react'
import {
  applyEntryCycleAssignments,
  getCycleRounds,
  getCycles,
  getEntryCycleAssignments,
  softDeleteEntry,
  updateEntry,
} from '../../db'
import { parseNote } from '../../translation'
import type { CycleRound, Exercise, ExerciseSet, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import { SetEditor } from '../log/SetEditor'
import { draftsToSetInputs, exerciseName, setToDraft, type SetDraft } from '../log/util'
import { EntryTargets, initialTargets, type UITarget } from './EntryTargets'
// The dialog is opened from Log too, which doesn't otherwise pull History's stylesheet
// — without this the split rows (and .hist-link) render unstyled there.
import './history.css'

export function EditEntryDialog({
  entry,
  exercise,
  allExercises,
  sets,
  lang,
  onChanged,
  onClose,
}: {
  entry: WorkoutEntry
  exercise: Exercise
  allExercises: Exercise[]
  sets: ExerciseSet[]
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const [drafts, setDrafts] = useState<SetDraft[]>(() =>
    sets.length ? sets.map((s) => setToDraft(s, exercise.duration_hm)) : [],
  )
  const [note, setNote] = useState(entry.note_raw)
  const [swapId, setSwapId] = useState(entry.exercise_id)
  const [date, setDate] = useState(entry.date)
  const [busy, setBusy] = useState(false)
  const name = exerciseName(exercise, lang)

  // Cycle membership (§6B). `targets === null` = not loaded yet, so a save before the
  // load lands can't wipe the entry's existing assignments.
  const [cycles, setCycles] = useState<TrainingCycle[]>([])
  const [roundsByCycle, setRoundsByCycle] = useState<Record<string, CycleRound[]>>({})
  const [targets, setTargets] = useState<UITarget[] | null>(null)
  const [initial, setInitial] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [cs, assigns] = await Promise.all([getCycles(), getEntryCycleAssignments()])
      const pairs = await Promise.all(cs.map(async (c) => [c.id, await getCycleRounds(c.id)] as const))
      if (cancelled) return
      const rows = initialTargets(entry, assigns)
      setCycles(cs)
      setRoundsByCycle(Object.fromEntries(pairs))
      setTargets(rows)
      setInitial(JSON.stringify(rows))
    })()
    return () => { cancelled = true }
  }, [entry])

  async function save() {
    setBusy(true)
    // Allow swapping the entry onto a different exercise of the same measure type.
    const target = allExercises.find((e) => e.id === swapId) ?? exercise
    const parsed = parseNote(note)
    const inputs = draftsToSetInputs(drafts, target.measure_type, parsed, target.duration_hm)
    await updateEntry(
      entry.id,
      { date, exercise_id: target.id, note_raw: note, note_tags: parsed.tagKeys, is_superset: inputs.some((s) => s.set_type === 'superset') },
      inputs,
    )
    // Only rewrite memberships when they actually changed — the write soft-deletes and
    // re-creates the entry's assignment rows, so an untouched save would churn sync.
    if (targets && JSON.stringify(targets) !== initial) {
      await applyEntryCycleAssignments(date, cycles, { [entry.id]: targets.filter((t) => t.cycleId && t.dayLabel) })
    }
    setBusy(false)
    onClose()
    await onChanged()
  }

  async function remove() {
    if (!confirm(lang === 'zh' ? '删除这条记录?' : 'Delete this entry?')) return
    setBusy(true)
    await softDeleteEntry(entry.id)
    onClose()
    await onChanged()
  }

  return (
    <div className="log-dialog-backdrop" onClick={() => !busy && onClose()}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{name}</h3>
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '日期(写错可改)' : 'Date (fix if wrong)'}</label>
          <input className="th-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '动作(可改成其他)' : 'Exercise (swap)'}</label>
          <select className="th-input" value={swapId} onChange={(e) => setSwapId(e.target.value)}>
            {allExercises
              .filter((e) => e.measure_type === exercise.measure_type && !e.deleted)
              .map((e) => (<option key={e.id} value={e.id}>{exerciseName(e, lang)}</option>))}
          </select>
        </div>
        <SetEditor lang={lang} measureType={exercise.measure_type} durationHm={exercise.duration_hm} cardio={exercise.body_parts.includes('cardio')} sets={drafts} onChange={setDrafts} />
        <input className="th-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={lang === 'zh' ? '笔记' : 'note'} />
        {targets && cycles.length > 0 && (
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '分化归类 (可留空 = 自由训练)' : 'Split (leave empty = free training)'}</label>
            <EntryTargets cycles={cycles} roundsByCycle={roundsByCycle} targets={targets} lang={lang} onChange={setTargets} />
          </div>
        )}
        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={remove} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
          <button className="th-btn" type="button" onClick={save} disabled={busy}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
