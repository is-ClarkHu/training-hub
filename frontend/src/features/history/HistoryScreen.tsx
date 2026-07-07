// History tab (SPEC §7.2): reverse-chronological sessions; tags localized;
// entries editable / deletable; needs_review and needs_translation surfaced for
// cleanup. Reads the local-first store; edits/deletes are soft (sync-safe, §3).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getActiveCycle,
  getCycleRounds,
  getEntries,
  getExercises,
  getSetsByEntryIds,
  getSportSessions,
  getSports,
  getTrackerEntries,
  softDeleteEntry,
  softDeleteSportSession,
  deleteTrackerEntry,
  updateEntry,
} from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import type { CycleRound, Exercise, ExerciseSet, OptionalTracker, Sport, SportSession, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import { SetEditor } from '../log/SetEditor'
import { sportName, attrLabel, SportSessionDialog } from '../sports'
import { intimacyCategory, intimacyLabel, intimacyVisible } from '../intimacy'
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
  const [intimacyRows, setIntimacyRows] = useState<OptionalTracker[]>([])
  const [activeCycle, setActiveCycle] = useState<TrainingCycle | null>(null)
  const [rounds, setRounds] = useState<CycleRound[]>([])
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sportEditing, setSportEditing] = useState<SportSession | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [discreet, setDiscreet] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)

  function flagged(e: WorkoutEntry): boolean {
    const ex = exById[e.exercise_id]
    return e.needs_review || e.needs_translation || (ex ? ex.needs_translation || !ex.name_en || !ex.name_zh : false)
  }

  const reload = useCallback(async () => {
    const visible = intimacyVisible()
    const [es, exs, ss, sp, ir] = await Promise.all([
      getEntries(), getExercises(), getSportSessions(), getSports(), visible ? getTrackerEntries('intimacy') : Promise.resolve([]),
    ])
    const sets = await getSetsByEntryIds(es.map((e) => e.id))
    setEntries(es)
    setSetMap(sets)
    setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
    setSportSessions(ss)
    setSportById(Object.fromEntries(sp.map((s) => [s.id, s])))
    setIntimacyRows(ir)
    setShowIntimacy(visible)
    const cyc = await getActiveCycle()
    setActiveCycle(cyc)
    setRounds(cyc ? await getCycleRounds(cyc.id) : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Group entries + sport sessions by date (newest first).
  const sessions = useMemo(() => {
    const map = new Map<string, { date: string; items: WorkoutEntry[]; sports: SportSession[]; intimacy: OptionalTracker[] }>()
    const get = (d: string) => {
      let g = map.get(d)
      if (!g) { g = { date: d, items: [], sports: [], intimacy: [] }; map.set(d, g) }
      return g
    }
    for (const e of entries) {
      if (reviewOnly && !flagged(e)) continue
      get(e.date).items.push(e)
    }
    if (!reviewOnly) for (const s of sportSessions) get(s.date).sports.push(s)
    if (!reviewOnly && showIntimacy) for (const r of intimacyRows) get(r.date).intimacy.push(r)
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sportSessions, intimacyRows, reviewOnly, exById, showIntimacy])

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // All selectable ids in this view = entries + sport sessions (respecting filters).
  const selectableIds = useMemo(
    () => [
      ...sessions.flatMap((s) => s.items.map((e) => e.id)),
      ...sessions.flatMap((s) => s.sports.map((ss) => ss.id)),
      ...sessions.flatMap((s) => s.intimacy.map((r) => r.id)),
    ],
    [sessions],
  )
  const sportIdSet = useMemo(() => new Set(sportSessions.map((s) => s.id)), [sportSessions])
  const intimacyIdSet = useMemo(() => new Set(intimacyRows.map((r) => r.id)), [intimacyRows])

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === selectableIds.length ? new Set() : new Set(selectableIds)))
  }
  async function deleteSelected() {
    if (selected.size === 0) return
    if (!confirm(lang === 'zh' ? `删除选中的 ${selected.size} 条?` : `Delete ${selected.size} selected?`)) return
    for (const id of selected) {
      if (sportIdSet.has(id)) await softDeleteSportSession(id)
      else if (intimacyIdSet.has(id)) await deleteTrackerEntry(id)
      else await softDeleteEntry(id)
    }
    setSelected(new Set())
    setSelectMode(false)
    await reload()
  }


  async function delIntimacy(id: string) {
    if (!confirm(lang === 'zh' ? '隐藏这条私密记录?' : 'Hide this private record?')) return
    await deleteTrackerEntry(id)
    await reload()
  }

  if (loading) return <p className="hist-empty">Loading…</p>
  if (entries.length === 0 && sportSessions.length === 0 && intimacyRows.length === 0) {
    return <p className="hist-empty">No sessions logged yet. Head to the Log tab.</p>
  }

  return (
    <div className="hist-screen">
      <div className="hist-toolbar">
        <button className={`th-pill ${reviewOnly ? 'on' : ''}`} type="button" onClick={() => setReviewOnly((v) => !v)}>
          ⚑ {lang === 'zh' ? '待复核' : 'review'}
        </button>
        <button className={`th-pill ${discreet ? 'on' : ''}`} type="button" onClick={() => setDiscreet((v) => !v)}>
          {discreet ? '🙈' : '👁'} {lang === 'zh' ? '数值' : 'values'}
        </button>
        <button className={`th-pill ${selectMode ? 'on' : ''}`} type="button" onClick={() => { setSelectMode((v) => !v); setSelected(new Set()) }}>
          {selectMode ? (lang === 'zh' ? '取消' : 'cancel') : (lang === 'zh' ? '选择' : 'select')}
        </button>
        {selectMode && (
          <button className="th-pill" type="button" onClick={toggleSelectAll}>
            {selected.size === selectableIds.length ? (lang === 'zh' ? '全不选' : 'none') : (lang === 'zh' ? '全选' : 'all')}
          </button>
        )}
        {selectMode && (
          <button className="th-pill danger" type="button" onClick={deleteSelected} disabled={selected.size === 0}>
            🗑 {lang === 'zh' ? `删除 ${selected.size}` : `delete ${selected.size}`}
          </button>
        )}
      </div>

      {activeCycle && rounds.length > 0 && !reviewOnly && (
        <section className="hist-rounds">
          <div className="hist-rounds-head">
            <span className="th-label">{lang === 'zh' ? '循环轮次' : 'Cycle rounds'}</span>
            <span className="hist-rounds-cyc">{activeCycle.name}</span>
          </div>
          <ul className="hist-rounds-list">
            {[...rounds].reverse().map((r) => (
              <li key={r.id} className="hist-round-row">
                <span className="hist-round-idx">R{r.index}</span>
                <span className="hist-round-dates">{r.started_on} → {r.ended_on ?? '…'}</span>
                <span className="hist-round-days">{r.completed_labels.join('') || '—'}</span>
                {r.skipped && <span className="hist-round-badge skip">{lang === 'zh' ? '跳过' : 'skipped'}</span>}
                {!r.ended_on && <span className="hist-round-badge open">{lang === 'zh' ? '进行中' : 'open'}</span>}
                {r.ended_on && !r.skipped && <span className="hist-round-badge done">{lang === 'zh' ? '完成' : 'done'}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

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
                <div
                  key={ss.id}
                  className={`hist-row hist-sport ${selected.has(ss.id) ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`}
                  onClick={() => (selectMode ? toggleSel(ss.id) : setSportEditing(ss))}
                >
                  {selectMode && (
                    <input type="checkbox" className="hist-check" checked={selected.has(ss.id)} onChange={() => toggleSel(ss.id)} onClick={(e) => e.stopPropagation()} aria-label="select" />
                  )}
                  <div className="hist-row-main">
                    <div className="hist-row-top">
                      <span className="hist-name">🏃 {sp ? sportName(sp, lang) : '(sport)'}</span>
                      {ss.injury && <span className="hist-badge injury">{lang === 'zh' ? '带伤' : 'injury'}</span>}
                    </div>
                    <div className="hist-sets">
                      <span className="hist-set">{formatHours(ss.hours)}</span>
                      {(sp?.fields ?? []).map((f) => ss.attributes?.[f.key] && (
                        <span key={f.key} className="hist-settype">{attrLabel(f, ss.attributes[f.key], lang)}</span>
                      ))}
                    </div>
                    {ss.note_raw && <div className="hist-tags"><span className="hist-note-inline">{ss.note_raw}</span></div>}
                  </div>
                </div>
              )
            })}
            {showIntimacy && s.intimacy.map((r) => (
              <div key={r.id} className={`hist-entry hist-intimacy ${selected.has(r.id) ? 'sel' : ''}`}>
                <div className="hist-entry-head">
                  {selectMode && (
                    <input type="checkbox" className="hist-check" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label="select" />
                  )}
                  <span className="hist-name">{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</span>
                  {!selectMode && (
                    <div className="hist-actions">
                      <button className="hist-link danger" type="button" onClick={() => void delIntimacy(r.id)}>
                        {lang === 'zh' ? '隐藏' : 'hide'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="hist-sets">
                  <span className="hist-intimacy-pill">{intimacyLabel(intimacyCategory(r), lang)}</span>
                  <span className="hist-set">×{r.count}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {sportEditing && (
        <SportSessionDialog
          lang={lang}
          sport={sportById[sportEditing.sport_id]}
          session={sportEditing}
          onSaved={() => { setSportEditing(null); void reload() }}
          onClose={() => setSportEditing(null)}
        />
      )}
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
    <>
      <div
        className={`hist-row ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`}
        onClick={() => (selectMode ? onToggleSelect() : exercise && startEdit())}
      >
        {selectMode && (
          <input type="checkbox" className="hist-check" checked={selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} aria-label="select" />
        )}
        <div className="hist-row-main">
          <div className="hist-row-top">
            <span className="hist-name">{name}</span>
            {entry.injury_modified && (
              <span className="hist-badge injury">{entry.injury_modified === 'paused' ? (lang === 'zh' ? '因伤暂停' : 'paused') : (lang === 'zh' ? '因伤减量' : 'reduced')}</span>
            )}
            {entry.needs_review && <span className="hist-badge review">{lang === 'zh' ? '待复核' : 'review'}</span>}
            {(entry.needs_translation || (exercise && (exercise.needs_translation || !exercise.name_en || !exercise.name_zh))) && (
              <span className="hist-badge translate">{lang === 'zh' ? '待翻译' : 'translate'}</span>
            )}
          </div>
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
          {(entry.note_raw || entry.note_tags.length > 0) && (
            <div className="hist-tags">
              {entry.note_tags.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
              {entry.note_raw && <span className="hist-note-inline">{entry.note_raw}</span>}
            </div>
          )}
        </div>
      </div>

      {editing && exercise && (
        <div className="log-dialog-backdrop" onClick={() => !busy && setEditing(false)}>
          <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{name}</h3>
            <SetEditor lang={lang} measureType={exercise.measure_type} sets={drafts} onChange={setDrafts} />
            <input className="th-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={lang === 'zh' ? '笔记' : 'note'} />
            <div className="log-dialog-actions">
              <button className="th-btn-ghost" type="button" onClick={remove} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
              <button className="th-btn" type="button" onClick={save} disabled={busy}>{lang === 'zh' ? '保存' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
