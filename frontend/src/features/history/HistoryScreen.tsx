// History tab (SPEC §7.2): reverse-chronological sessions; tags localized;
// entries editable / deletable; needs_review and needs_translation surfaced for
// cleanup. Reads the local-first store; edits/deletes are soft (sync-safe, §3).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getEntries,
  getExercises,
  getSetsByEntryIds,
  softDeleteEntry,
  updateEntry,
} from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import type { Exercise, ExerciseSet, WorkoutEntry } from '../../supabase/types'
import { SetEditor } from '../log/SetEditor'
import {
  draftsToSetInputs,
  exerciseName,
  formatSet,
  setToDraft,
  type SetDraft,
} from '../log/util'
import './history.css'

export function HistoryScreen() {
  const { lang } = useLanguage()
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [setMap, setSetMap] = useState<Record<string, ExerciseSet[]>>({})
  const [exById, setExById] = useState<Record<string, Exercise>>({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [es, exs] = await Promise.all([getEntries(), getExercises()])
    const sets = await getSetsByEntryIds(es.map((e) => e.id))
    setEntries(es)
    setSetMap(sets)
    setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Group into sessions by date (entries already sorted newest-first).
  const sessions = useMemo(() => {
    const byDate: { date: string; items: WorkoutEntry[] }[] = []
    for (const e of entries) {
      const last = byDate[byDate.length - 1]
      if (last && last.date === e.date) last.items.push(e)
      else byDate.push({ date: e.date, items: [e] })
    }
    return byDate
  }, [entries])

  if (loading) return <p className="hist-empty">Loading…</p>
  if (entries.length === 0) {
    return <p className="hist-empty">No sessions logged yet. Head to the Log tab.</p>
  }

  return (
    <div className="hist-screen">
      {sessions.map((s) => (
        <section key={s.date} className="hist-session">
          <h3 className="hist-date">{s.date}</h3>
          <div className="hist-entries">
            {s.items.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                exercise={exById[entry.exercise_id]}
                sets={setMap[entry.id] ?? []}
                lang={lang}
                onChanged={reload}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function EntryCard({
  entry,
  exercise,
  sets,
  lang,
  onChanged,
}: {
  entry: WorkoutEntry
  exercise: Exercise | undefined
  sets: ExerciseSet[]
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<SetDraft[]>([])
  const [note, setNote] = useState(entry.note_raw)
  const [isSuperset, setIsSuperset] = useState(entry.is_superset)
  const [busy, setBusy] = useState(false)

  const needsAttention =
    entry.needs_review ||
    entry.needs_translation ||
    (exercise ? exercise.needs_translation || !exercise.name_en || !exercise.name_zh : false)

  function startEdit() {
    setDrafts(sets.length ? sets.map(setToDraft) : [])
    setNote(entry.note_raw)
    setIsSuperset(entry.is_superset)
    setEditing(true)
  }

  async function save() {
    if (!exercise) return
    setBusy(true)
    const parsed = parseNote(note)
    const inputs = draftsToSetInputs(drafts, exercise.measure_type, parsed, isSuperset)
    await updateEntry(
      entry.id,
      { note_raw: note, note_tags: parsed.tagKeys, is_superset: isSuperset },
      inputs,
    )
    setBusy(false)
    setEditing(false)
    await onChanged()
  }

  async function remove() {
    if (!confirm('Delete this entry?')) return
    setBusy(true)
    await softDeleteEntry(entry.id)
    await onChanged()
  }

  const name = exercise ? exerciseName(exercise, lang) : '(deleted exercise)'

  return (
    <div className={`hist-entry ${needsAttention ? 'needs' : ''}`}>
      <div className="hist-entry-head">
        <span className="hist-name">{name}</span>
        <div className="hist-actions">
          {exercise && !editing && (
            <button className="hist-link" type="button" onClick={startEdit} disabled={busy}>edit</button>
          )}
          <button className="hist-link danger" type="button" onClick={remove} disabled={busy}>delete</button>
        </div>
      </div>

      {needsAttention && (
        <div className="hist-badges">
          {entry.needs_review && <span className="hist-badge review">needs review</span>}
          {(entry.needs_translation || (exercise && (exercise.needs_translation || !exercise.name_en || !exercise.name_zh))) && (
            <span className="hist-badge translate">needs translation</span>
          )}
        </div>
      )}

      {editing && exercise ? (
        <div className="hist-edit">
          <SetEditor lang={lang} measureType={exercise.measure_type} sets={drafts} onChange={setDrafts} />
          <label className="hist-superset">
            <input type="checkbox" checked={isSuperset} onChange={(e) => setIsSuperset(e.target.checked)} />
            {lang === 'zh' ? '超级组' : 'superset'}
          </label>
          <input className="th-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={lang === 'zh' ? '笔记' : 'note'} />
          <div className="hist-edit-actions">
            <button className="th-btn-ghost" type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button className="th-btn" type="button" onClick={save} disabled={busy}>Save</button>
          </div>
        </div>
      ) : (
        <>
          <div className="hist-sets">
            {sets.map((s) => (
              <span key={s.id} className="hist-set">
                {exercise ? formatSet(s, exercise.measure_type) : '–'}
                {s.set_type !== 'normal' && <em className="hist-settype"> {s.set_type}</em>}
              </span>
            ))}
          </div>
          {entry.note_raw && <p className="hist-note">{entry.note_raw}</p>}
          {entry.note_tags.length > 0 && (
            <div className="hist-tags">
              {entry.note_tags.map((k) => (
                <span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
