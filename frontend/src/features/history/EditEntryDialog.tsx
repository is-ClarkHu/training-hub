// Shared entry-edit modal — used by History cards (both layouts) and the review
// stepper. Swaps the exercise (same measure type), edits sets via SetEditor, and
// re-parses the note (§5.3). Save writes through updateEntry; delete soft-deletes.
import { useState } from 'react'
import { softDeleteEntry, updateEntry } from '../../db'
import { parseNote } from '../../translation'
import type { Exercise, ExerciseSet, WorkoutEntry } from '../../supabase/types'
import { SetEditor } from '../log/SetEditor'
import { draftsToSetInputs, exerciseName, setToDraft, type SetDraft } from '../log/util'

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
        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={remove} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
          <button className="th-btn" type="button" onClick={save} disabled={busy}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
