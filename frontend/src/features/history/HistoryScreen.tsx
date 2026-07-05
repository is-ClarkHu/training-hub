// History tab (SPEC §7.2): reverse-chronological sessions; tags localized;
// entries editable / deletable; needs_review and needs_translation surfaced for
// cleanup. Reads the local-first store; edits/deletes are soft (sync-safe, §3).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getEntries,
  getExercises,
  getSetsByEntryIds,
  getSportSessions,
  getSports,
  softDeleteEntry,
  softDeleteSportSession,
  updateEntry,
} from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import type { Exercise, ExerciseSet, Sport, SportSession, WorkoutEntry } from '../../supabase/types'
import { SetEditor } from '../log/SetEditor'
import { sportName, attrLabel } from '../sports'
import {
  draftsToSetInputs,
  exerciseName,
  formatHours,
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
  const [sportSessions, setSportSessions] = useState<SportSession[]>([])
  const [sportById, setSportById] = useState<Record<string, Sport>>({})
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [discreet, setDiscreet] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)

  function flagged(e: WorkoutEntry): boolean {
    const ex = exById[e.exercise_id]
    return e.needs_review || e.needs_translation || (ex ? ex.needs_translation || !ex.name_en || !ex.name_zh : false)
  }

  const reload = useCallback(async () => {
    const [es, exs, ss, sp] = await Promise.all([getEntries(), getExercises(), getSportSessions(), getSports()])
    const sets = await getSetsByEntryIds(es.map((e) => e.id))
    setEntries(es)
    setSetMap(sets)
    setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
    setSportSessions(ss)
    setSportById(Object.fromEntries(sp.map((s) => [s.id, s])))
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Group entries + sport sessions by date (newest first).
  const sessions = useMemo(() => {
    const map = new Map<string, { date: string; items: WorkoutEntry[]; sports: SportSession[] }>()
    const get = (d: string) => {
      let g = map.get(d)
      if (!g) { g = { date: d, items: [], sports: [] }; map.set(d, g) }
      return g
    }
    for (const e of entries) {
      if (reviewOnly && !flagged(e)) continue
      get(e.date).items.push(e)
    }
    if (!reviewOnly) for (const s of sportSessions) get(s.date).sports.push(s)
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sportSessions, reviewOnly, exById])

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))))
  }
  async function deleteSelected() {
    if (selected.size === 0) return
    if (!confirm(lang === 'zh' ? `删除选中的 ${selected.size} 条?` : `Delete ${selected.size} selected?`)) return
    for (const id of selected) await softDeleteEntry(id)
    setSelected(new Set())
    setSelectMode(false)
    await reload()
  }

  async function delSport(id: string) {
    if (!confirm(lang === 'zh' ? '删除这条运动记录?' : 'Delete this session?')) return
    await softDeleteSportSession(id)
    await reload()
  }

  if (loading) return <p className="hist-empty">Loading…</p>
  if (entries.length === 0 && sportSessions.length === 0) {
    return <p className="hist-empty">No sessions logged yet. Head to the Log tab.</p>
  }

  return (
    <div className="hist-screen">
      <div className="hist-toolbar">
        <button className={`hist-link ${reviewOnly ? 'on' : ''}`} type="button" onClick={() => setReviewOnly((v) => !v)}>
          {lang === 'zh' ? '只看待复核' : 'review only'}
        </button>
        <button className="hist-link" type="button" onClick={() => setDiscreet((v) => !v)}>
          {discreet ? (lang === 'zh' ? '显示数值' : 'show values') : (lang === 'zh' ? '隐藏数值' : 'hide values')}
        </button>
        <button className="hist-link" type="button" onClick={() => { setSelectMode((v) => !v); setSelected(new Set()) }}>
          {selectMode ? (lang === 'zh' ? '取消' : 'cancel') : (lang === 'zh' ? '批量选择' : 'select')}
        </button>
        {selectMode && (
          <button className="hist-link" type="button" onClick={toggleSelectAll}>
            {selected.size === entries.length ? (lang === 'zh' ? '全不选' : 'none') : (lang === 'zh' ? '全选' : 'all')}
          </button>
        )}
        {selectMode && (
          <button className="hist-link danger" type="button" onClick={deleteSelected} disabled={selected.size === 0}>
            {lang === 'zh' ? `删除 (${selected.size})` : `delete (${selected.size})`}
          </button>
        )}
      </div>
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
                selectMode={selectMode}
                selected={selected.has(entry.id)}
                onToggleSelect={() => toggleSel(entry.id)}
                discreet={discreet}
              />
            ))}
            {s.sports.map((ss) => {
              const sp = sportById[ss.sport_id]
              return (
                <div key={ss.id} className="hist-entry hist-sport">
                  <div className="hist-entry-head">
                    <span className="hist-name">🏃 {sp ? sportName(sp, lang) : '(sport)'}</span>
                    {!selectMode && (
                      <div className="hist-actions">
                        <button className="hist-link danger" type="button" onClick={() => void delSport(ss.id)}>delete</button>
                      </div>
                    )}
                  </div>
                  <div className="hist-sets">
                    <span className="hist-set">{formatHours(ss.hours)}</span>
                    {(sp?.fields ?? []).map((f) => ss.attributes?.[f.key] && (
                      <span key={f.key} className="hist-settype">{attrLabel(f, ss.attributes[f.key], lang)}</span>
                    ))}
                    {ss.injury && <span className="hist-badge injury">injury</span>}
                  </div>
                  {ss.note_raw && <p className="hist-note">{ss.note_raw}</p>}
                </div>
              )
            })}
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
  selectMode,
  selected,
  onToggleSelect,
  discreet,
}: {
  entry: WorkoutEntry
  exercise: Exercise | undefined
  sets: ExerciseSet[]
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  discreet: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<SetDraft[]>([])
  const [note, setNote] = useState(entry.note_raw)
  const [busy, setBusy] = useState(false)

  const needsAttention =
    entry.needs_review ||
    entry.needs_translation ||
    (exercise ? exercise.needs_translation || !exercise.name_en || !exercise.name_zh : false)

  function startEdit() {
    setDrafts(sets.length ? sets.map(setToDraft) : [])
    setNote(entry.note_raw)
    setEditing(true)
  }

  async function save() {
    if (!exercise) return
    setBusy(true)
    const parsed = parseNote(note)
    const inputs = draftsToSetInputs(drafts, exercise.measure_type, parsed)
    await updateEntry(
      entry.id,
      { note_raw: note, note_tags: parsed.tagKeys, is_superset: inputs.some((s) => s.set_type === 'superset') },
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
    <div className={`hist-entry ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''}`}>
      <div className="hist-entry-head">
        {selectMode && (
          <input type="checkbox" className="hist-check" checked={selected} onChange={onToggleSelect} aria-label="select" />
        )}
        <span className="hist-name">{name}</span>
        {!selectMode && (
          <div className="hist-actions">
            {exercise && !editing && (
              <button className="hist-link" type="button" onClick={startEdit} disabled={busy}>edit</button>
            )}
            <button className="hist-link danger" type="button" onClick={remove} disabled={busy}>delete</button>
          </div>
        )}
      </div>

      {entry.injury_modified && (
        <div className="hist-badges">
          <span className="hist-badge injury">
            {entry.injury_modified === 'paused'
              ? lang === 'zh' ? '因伤暂停' : 'paused (injury)'
              : lang === 'zh' ? '因伤减量' : 'reduced (injury)'}
          </span>
        </div>
      )}

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
            {discreet ? (
              <span className="hist-set">{sets.length} {lang === 'zh' ? '组' : sets.length === 1 ? 'set' : 'sets'}</span>
            ) : (
              sets.map((s) => (
                <span key={s.id} className="hist-set">
                  {exercise ? formatSet(s, exercise.measure_type) : '–'}
                  {s.set_type !== 'normal' && <em className="hist-settype"> {s.set_type}</em>}
                  {s.note && <em className="hist-setnote"> · {s.note}</em>}
                </span>
              ))
            )}
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
