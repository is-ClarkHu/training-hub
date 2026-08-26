// Guided review stepper (§7.2). Walks a snapshot of pending items one at a time —
// each with the movement, its sets, and its flags — offering [编辑] (reuse the
// shared edit dialog) and [确认无误] (clear the review/translation flags, advance).
// Reads entry/set/exercise data LIVE from the parent maps so an edit shows fresh.
import { useState } from 'react'
import { patchEntry } from '../../db'
import type { Exercise, ExerciseSet, WorkoutEntry } from '../../supabase/types'
import { noteTagLabel } from '../../translation'
import { ACTIVITY_COLORS, displayNote, exerciseKind, exerciseName, exerciseNeedsTranslation, formatSetLine } from '../log/util'
import { EditEntryDialog } from './EditEntryDialog'

export function ReviewFlow({
  ids,
  entriesById,
  exById,
  setMap,
  allExercises,
  lang,
  onChanged,
  onClose,
}: {
  ids: string[]
  entriesById: Record<string, WorkoutEntry>
  exById: Record<string, Exercise>
  setMap: Record<string, ExerciseSet[]>
  allExercises: Exercise[]
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const id = ids[idx]
  const entry = id ? entriesById[id] : undefined
  const exercise = entry ? exById[entry.exercise_id] : undefined
  const sets = id ? setMap[id] ?? [] : []

  function advance() {
    setEditing(false)
    if (idx + 1 < ids.length) setIdx(idx + 1)
    else onClose()
  }

  async function confirm() {
    if (!entry) return advance()
    setBusy(true)
    await patchEntry(entry.id, { needs_review: false, needs_translation: false })
    setBusy(false)
    await onChanged()
    advance()
  }

  // An entry can vanish mid-flow (deleted while editing) — just skip it.
  if (!entry) {
    return (
      <div className="log-dialog-backdrop" onClick={onClose}>
        <div className="rev-card" onClick={(e) => e.stopPropagation()}>
          <div className="rev-head"><span className="rev-count">{lang === 'zh' ? '复核完成' : 'Review done'}</span></div>
          <div className="rev-actions"><button className="th-btn" type="button" onClick={onClose}>{lang === 'zh' ? '完成' : 'Done'}</button></div>
        </div>
      </div>
    )
  }

  const name = exercise ? exerciseName(exercise, lang) : '(deleted exercise)'
  const flags: string[] = []
  if (entry.needs_review) flags.push(lang === 'zh' ? '待复核' : 'review')
  if (entry.needs_translation || exerciseNeedsTranslation(exercise)) {
    flags.push(lang === 'zh' ? '待翻译' : 'translate')
  }

  return (
    <div className="log-dialog-backdrop" onClick={() => !busy && !editing && onClose()}>
      <div className="rev-card" onClick={(e) => e.stopPropagation()}>
        <div className="rev-head">
          <span className="rev-title">{lang === 'zh' ? '复核' : 'Review'}</span>
          <span className="rev-count">{idx + 1} / {ids.length}</span>
        </div>
        <div className="rev-date">{entry.date}</div>
        <div className="rev-row-top">
          <span className="hist-dot" style={{ background: exercise ? ACTIVITY_COLORS[exerciseKind(exercise)] : 'var(--text-dim)' }} />
          <span className="rev-name">{name}</span>
          {flags.map((f) => (<span key={f} className={`hist-badge ${f.includes('译') || f === 'translate' ? 'translate' : 'review'}`}>{f}</span>))}
        </div>
        <div className="rev-sets">
          {sets.length === 0 && <span className="hist-set">—</span>}
          {sets.map((s) => (
            <span key={s.id} className="hist-set">
              {exercise ? formatSetLine(s, exercise.measure_type, lang, exercise.duration_hm) : '–'}
              {s.set_type !== 'normal' && <em className="hist-settype"> {s.set_type}</em>}
              {s.note && <em className="hist-setnote"> · {s.note}</em>}
            </span>
          ))}
        </div>
        {(displayNote(entry.note_raw) || entry.note_tags.length > 0) && (
          <div className="rev-note">
            {entry.note_tags.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
            {displayNote(entry.note_raw) && <span className="hist-note-inline">{displayNote(entry.note_raw)}</span>}
          </div>
        )}
        <div className="rev-actions">
          <button className="th-btn-ghost" type="button" onClick={advance} disabled={busy}>{lang === 'zh' ? '跳过' : 'Skip'}</button>
          <button className="th-btn-ghost" type="button" onClick={() => setEditing(true)} disabled={busy || !exercise}>{lang === 'zh' ? '编辑' : 'Edit'}</button>
          <button className="th-btn" type="button" onClick={confirm} disabled={busy}>{lang === 'zh' ? '确认无误 →' : 'Looks good →'}</button>
        </div>
      </div>

      {editing && exercise && (
        <EditEntryDialog
          entry={entry}
          exercise={exercise}
          allExercises={allExercises}
          sets={sets}
          lang={lang}
          onChanged={onChanged}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
