// History tab (SPEC §7.2): reverse-chronological sessions; tags localized;
// entries editable / deletable; needs_review and needs_translation surfaced for
// cleanup. Two layouts (list / grouped-by-module, toggled top-right); a guided
// review stepper; per-date loop badges. Reads the local-first store; edits/deletes
// are soft (sync-safe, §3).
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
  newId,
  patchEntry,
  softDeleteEntry,
  softDeleteSportSession,
  deleteTrackerEntry,
  updateTrackerEntry,
} from '../../db'
import { categoryKeys, categoryLabel } from '../../categories'
import { noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import type { CycleRound, Exercise, ExerciseSet, IntimacyCategory, OptionalTracker, Sport, SportSession, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import { cycleDayTitle } from '../cycle/day'
import { liveCompletedLabels } from '../cycle/rounds'
import { sportName, attrLabel, SportSessionDialog } from '../sports'
import { INTIMACY_CATEGORIES, intimacyCategory, intimacyLabel, intimacyVisible } from '../intimacy'
import {
  ACTIVITY_COLORS,
  displayNote,
  exerciseKind,
  exerciseName,
  formatHours,
  formatMetrics,
  formatSetLine,
  primaryCategory,
} from '../log/util'
import { EditEntryDialog } from './EditEntryDialog'
import { ReviewFlow } from './ReviewFlow'
import './history.css'

type HistMode = 'list' | 'grouped'
const MODE_KEY = 'th.history.mode'

/** Loop context for a date: which split day(s) were trained, and the round. */
interface LoopInfo {
  labels: { label: string; title: string }[]
  round: number | null
}

/** Split a date's entries into circuits (≥2 entries sharing a superset_group —
 *  alternating/交替 movements) and standalone singles. */
function partitionCircuits(items: WorkoutEntry[]): { circuits: WorkoutEntry[][]; singles: WorkoutEntry[] } {
  const groups = new Map<string, WorkoutEntry[]>()
  const singles: WorkoutEntry[] = []
  for (const e of items) {
    if (e.superset_group) {
      const g = groups.get(e.superset_group)
      if (g) g.push(e); else groups.set(e.superset_group, [e])
    } else singles.push(e)
  }
  const circuits: WorkoutEntry[][] = []
  for (const g of groups.values()) { if (g.length >= 2) circuits.push(g); else singles.push(...g) }
  return { circuits, singles }
}

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
  const [intimacyEditing, setIntimacyEditing] = useState<OptionalTracker | null>(null)
  const [moduleEditing, setModuleEditing] = useState<WorkoutEntry | null>(null)
  const [reviewIds, setReviewIds] = useState<string[] | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [discreet, setDiscreet] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [mode, setMode] = useState<HistMode>(() => (localStorage.getItem(MODE_KEY) === 'grouped' ? 'grouped' : 'list'))

  useEffect(() => { localStorage.setItem(MODE_KEY, mode) }, [mode])

  const flagged = useCallback((e: WorkoutEntry): boolean => {
    const ex = exById[e.exercise_id]
    return e.needs_review || e.needs_translation || (ex ? ex.needs_translation || !ex.name_en || !ex.name_zh : false)
  }, [exById])

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

  const entriesById = useMemo(() => Object.fromEntries(entries.map((e) => [e.id, e])), [entries])
  const allExercises = useMemo(() => Object.values(exById), [exById])
  const pendingIds = useMemo(() => entries.filter(flagged).map((e) => e.id), [entries, flagged])

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
  }, [entries, sportSessions, intimacyRows, reviewOnly, showIntimacy, flagged])

  // Which split day(s) + round a date belongs to (active cycle only).
  const loopInfo = useCallback((date: string, items: WorkoutEntry[]): LoopInfo | null => {
    if (!activeCycle) return null
    const dayByLabel = new Map(activeCycle.days.map((d) => [d.label, d]))
    const seen = new Set<string>()
    const labels: { label: string; title: string }[] = []
    for (const e of items) {
      if (!e.cycle_day_label || seen.has(e.cycle_day_label)) continue
      if (e.cycle_id && e.cycle_id !== activeCycle.id) continue
      const day = dayByLabel.get(e.cycle_day_label)
      if (!day) continue
      seen.add(e.cycle_day_label)
      labels.push({ label: e.cycle_day_label, title: cycleDayTitle(day, lang) })
    }
    if (labels.length === 0) return null
    const round = rounds.find((r) => r.started_on <= date && (r.ended_on ?? '9999-12-31') >= date)
    return { labels, round: round?.index ?? null }
  }, [activeCycle, rounds, lang])

  // Group a date's entries into category modules (mode-2), ordered by category order.
  const groupByModule = useCallback((items: WorkoutEntry[]): { key: string; items: WorkoutEntry[] }[] => {
    const order = categoryKeys()
    const groups = new Map<string, WorkoutEntry[]>()
    for (const e of items) {
      const ex = exById[e.exercise_id]
      const key = e.module_part ?? (ex ? primaryCategory(ex) : null) ?? '__none'
      const arr = groups.get(key)
      if (arr) arr.push(e)
      else groups.set(key, [e])
    }
    return [...groups.entries()]
      .map(([key, its]) => ({ key, items: its }))
      .sort((a, b) => {
        const ai = order.indexOf(a.key); const bi = order.indexOf(b.key)
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
      })
  }, [exById])

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

  // Selected workout entries (excludes sports/intimacy). A circuit must be one day.
  const selWorkout = useMemo(() => [...selected].map((id) => entriesById[id]).filter(Boolean), [selected, entriesById])
  const canMerge = selWorkout.length >= 2 && new Set(selWorkout.map((e) => e.date)).size === 1
  async function mergeCircuit() {
    if (!canMerge) return
    const gid = newId()
    for (const e of selWorkout) await patchEntry(e.id, { superset_group: gid })
    setSelected(new Set())
    setSelectMode(false)
    await reload()
  }
  async function unmergeCircuit(members: WorkoutEntry[]) {
    for (const e of members) await patchEntry(e.id, { superset_group: null })
    await reload()
  }

  if (loading) return <p className="hist-empty">Loading…</p>
  if (entries.length === 0 && sportSessions.length === 0 && intimacyRows.length === 0) {
    return <p className="hist-empty">No sessions logged yet. Head to the Log tab.</p>
  }

  const cardProps = (entry: WorkoutEntry, variant: 'row' | 'card') => ({
    key: entry.id,
    entry,
    exercise: exById[entry.exercise_id],
    allExercises,
    sets: setMap[entry.id] ?? [],
    lang,
    onChanged: reload,
    selectMode,
    selected: selected.has(entry.id),
    onToggleSelect: () => toggleSel(entry.id),
    discreet,
    variant,
    onChooseModule: () => setModuleEditing(entry),
  })

  return (
    <div className="hist-screen">
      <div className="hist-toolbar">
        <button className={`th-pill ${reviewOnly ? 'on' : ''}`} type="button" onClick={() => setReviewOnly((v) => !v)}>
          ⚑ {lang === 'zh' ? '待复核' : 'review'}{pendingIds.length > 0 ? ` ${pendingIds.length}` : ''}
        </button>
        {pendingIds.length > 0 && (
          <button className="th-pill accent" type="button" onClick={() => setReviewIds(pendingIds)}>
            ▶ {lang === 'zh' ? '开始复核' : 'start review'}
          </button>
        )}
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
        {selectMode && canMerge && (
          <button className="th-pill accent" type="button" onClick={mergeCircuit}>
            ⛓ {lang === 'zh' ? '合并为循环' : 'merge circuit'}
          </button>
        )}
        {selectMode && (
          <button className="th-pill danger" type="button" onClick={deleteSelected} disabled={selected.size === 0}>
            🗑 {lang === 'zh' ? `删除 ${selected.size}` : `delete ${selected.size}`}
          </button>
        )}
        <button
          className="hist-mode-btn"
          type="button"
          title={mode === 'list' ? (lang === 'zh' ? '切换为模块视图' : 'Grouped view') : (lang === 'zh' ? '切换为列表视图' : 'List view')}
          onClick={() => setMode((m) => (m === 'list' ? 'grouped' : 'list'))}
        >
          {mode === 'list' ? '▦' : '☰'}
        </button>
      </div>

      {activeCycle && rounds.length > 0 && !reviewOnly && (
        <section className="hist-rounds">
          <div className="hist-rounds-head">
            <span className="th-label">{lang === 'zh' ? '循环轮次' : 'Cycle rounds'}</span>
            <span className="hist-rounds-cyc">{activeCycle.name}</span>
          </div>
          <ul className="hist-rounds-list">
            {[...rounds].reverse().map((r) => {
              const done = liveCompletedLabels(activeCycle, r, entries)
              const allDone = done.length === activeCycle.days.length
              return (
                <li key={r.id} className="hist-round-row">
                  <span className="hist-round-idx">R{r.index}</span>
                  <span className="hist-round-dates">{r.started_on} → {r.ended_on ?? '…'}</span>
                  <span className="hist-round-days">{done.join('') || '—'}</span>
                  {r.skipped ? <span className="hist-round-badge skip">{lang === 'zh' ? '跳过' : 'skipped'}</span>
                    : allDone ? <span className="hist-round-badge done">{lang === 'zh' ? '完成' : 'done'}</span>
                    : !r.ended_on ? <span className="hist-round-badge open">{lang === 'zh' ? '进行中' : 'open'}</span>
                    : null}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {sessions.map((s) => {
        const loop = loopInfo(s.date, s.items)
        // Fold circuits into round-major blocks only when NOT selecting (select mode
        // keeps every entry individually clickable for select / delete / merge).
        const { circuits, singles } = selectMode ? { circuits: [], singles: s.items } : partitionCircuits(s.items)
        return (
          <section key={s.date} className="hist-session">
            <div className="hist-date-row">
              <h3 className="hist-date">{s.date}</h3>
              {loop && (
                <span className="hist-loop">
                  {loop.labels.map((l) => (
                    <span key={l.label} className="hist-loop-day"><b>{l.label}</b> {l.title}</span>
                  ))}
                  {loop.round != null && <span className="hist-loop-round">R{loop.round}</span>}
                </span>
              )}
            </div>

            {circuits.map((members) => (
              <CircuitCard
                key={members[0].superset_group ?? members[0].id}
                members={members}
                exById={exById}
                setMap={setMap}
                lang={lang}
                discreet={discreet}
                onUnmerge={() => unmergeCircuit(members)}
              />
            ))}

            {mode === 'grouped' ? (
              <div className="hist-modules">
                {groupByModule(singles).map((g) => (
                  <div key={g.key} className="hist-module">
                    <div className="hist-module-head">{g.key === '__none' ? '—' : categoryLabel(g.key, lang)}</div>
                    <div className="hist-cards">
                      {g.items.map((entry) => <EntryCard {...cardProps(entry, 'card')} />)}
                    </div>
                  </div>
                ))}
                {(s.sports.length > 0 || (showIntimacy && s.intimacy.length > 0)) && (
                  <div className="hist-entries">
                    {s.sports.map((ss) => <SportRow key={ss.id} ss={ss} sport={sportById[ss.sport_id]} lang={lang} selectMode={selectMode} selected={selected.has(ss.id)} onToggle={() => toggleSel(ss.id)} onOpen={() => setSportEditing(ss)} />)}
                    {showIntimacy && s.intimacy.map((r) => <IntimacyRow key={r.id} r={r} lang={lang} discreet={discreet} selectMode={selectMode} selected={selected.has(r.id)} onToggle={() => toggleSel(r.id)} onOpen={() => setIntimacyEditing(r)} />)}
                  </div>
                )}
              </div>
            ) : (
              <div className="hist-entries">
                {singles.map((entry) => <EntryCard {...cardProps(entry, 'row')} />)}
                {s.sports.map((ss) => <SportRow key={ss.id} ss={ss} sport={sportById[ss.sport_id]} lang={lang} selectMode={selectMode} selected={selected.has(ss.id)} onToggle={() => toggleSel(ss.id)} onOpen={() => setSportEditing(ss)} />)}
                {showIntimacy && s.intimacy.map((r) => <IntimacyRow key={r.id} r={r} lang={lang} discreet={discreet} selectMode={selectMode} selected={selected.has(r.id)} onToggle={() => toggleSel(r.id)} onOpen={() => setIntimacyEditing(r)} />)}
              </div>
            )}
          </section>
        )
      })}

      {sportEditing && (
        <SportSessionDialog
          lang={lang}
          sport={sportById[sportEditing.sport_id]}
          session={sportEditing}
          onSaved={() => { setSportEditing(null); void reload() }}
          onClose={() => setSportEditing(null)}
        />
      )}

      {intimacyEditing && (
        <IntimacyDialog
          lang={lang}
          entry={intimacyEditing}
          onSaved={() => { setIntimacyEditing(null); void reload() }}
          onClose={() => setIntimacyEditing(null)}
        />
      )}

      {moduleEditing && exById[moduleEditing.exercise_id] && (
        <ModuleChooser
          entry={moduleEditing}
          exercise={exById[moduleEditing.exercise_id]}
          lang={lang}
          onChanged={reload}
          onClose={() => setModuleEditing(null)}
        />
      )}

      {reviewIds && reviewIds.length > 0 && (
        <ReviewFlow
          ids={reviewIds}
          entriesById={entriesById}
          exById={exById}
          setMap={setMap}
          allExercises={allExercises}
          lang={lang}
          onChanged={reload}
          onClose={() => setReviewIds(null)}
        />
      )}
    </div>
  )
}

/** Per-occurrence module override — pick which of the movement's own categories
 *  this entry files under in the grouped view (§ module agency). */
function ModuleChooser({
  entry,
  exercise,
  lang,
  onChanged,
  onClose,
}: {
  entry: WorkoutEntry
  exercise: Exercise
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const primary = primaryCategory(exercise)
  const current = entry.module_part ?? primary
  async function pick(p: string) {
    await patchEntry(entry.id, { module_part: p === primary ? null : p })
    onClose()
    await onChanged()
  }
  return (
    <div className="log-dialog-backdrop" onClick={onClose}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '归到哪个模块' : 'File under'}</h3>
        <div className="mod-choices">
          {exercise.body_parts.map((p) => (
            <button
              key={p}
              type="button"
              className={`mod-choice ${p === current ? 'on' : ''}`}
              onClick={() => pick(p)}
            >
              {categoryLabel(p, lang)}
              {p === primary && <em className="mod-default"> · {lang === 'zh' ? '默认' : 'default'}</em>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SportRow({
  ss, sport, lang, selectMode, selected, onToggle, onOpen,
}: {
  ss: SportSession
  sport: Sport | undefined
  lang: 'en' | 'zh'
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={`hist-row hist-sport ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`}
      onClick={() => (selectMode ? onToggle() : onOpen())}
    >
      {selectMode && (
        <input type="checkbox" className="hist-check" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="select" />
      )}
      <div className="hist-row-main">
        <div className="hist-row-top">
          <span className="hist-dot" style={{ background: ACTIVITY_COLORS.sport }} />
          <span className="hist-name">🏃 {sport ? sportName(sport, lang) : '(sport)'}</span>
          {ss.injury && <span className="hist-badge injury">{lang === 'zh' ? '带伤' : 'injury'}</span>}
        </div>
        <div className="hist-sets">
          <span className="hist-set">{formatHours(ss.hours)}{formatMetrics(ss)}</span>
          {(sport?.fields ?? []).map((f) => ss.attributes?.[f.key] && (
            <span key={f.key} className="hist-settype">{attrLabel(f, ss.attributes[f.key], lang)}</span>
          ))}
        </div>
        {ss.note_raw && <div className="hist-tags"><span className="hist-note-inline">{ss.note_raw}</span></div>}
      </div>
    </div>
  )
}

function IntimacyRow({
  r, lang, discreet, selectMode, selected, onToggle, onOpen,
}: {
  r: OptionalTracker
  lang: 'en' | 'zh'
  discreet: boolean
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={`hist-row hist-intimacy ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`}
      onClick={() => (selectMode ? onToggle() : onOpen())}
    >
      {selectMode && (
        <input type="checkbox" className="hist-check" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="select" />
      )}
      <div className="hist-row-main">
        <div className="hist-row-top">
          <span className="hist-dot" style={{ background: '#f472b6' }} />
          <span className="hist-name">{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</span>
        </div>
        {!discreet && (
          <div className="hist-sets">
            <span className="hist-intimacy-pill">{intimacyLabel(intimacyCategory(r), lang)}</span>
            <span className="hist-set">×{r.count}</span>
            {r.note && <em className="hist-setnote"> · {r.note}</em>}
          </div>
        )}
      </div>
    </div>
  )
}

function IntimacyDialog({
  lang,
  entry,
  onSaved,
  onClose,
}: {
  lang: 'en' | 'zh'
  entry: OptionalTracker
  onSaved: () => void
  onClose: () => void
}) {
  const [cat, setCat] = useState<IntimacyCategory>(intimacyCategory(entry))
  const [count, setCount] = useState(String(entry.count))
  const [note, setNote] = useState(entry.note ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    const n = parseInt(count, 10)
    if (!Number.isFinite(n) || n <= 0) return
    setBusy(true)
    await updateTrackerEntry(entry.id, { category: cat, count: n, note: note.trim() || null })
    setBusy(false)
    onSaved()
  }
  async function del() {
    if (!confirm(lang === 'zh' ? '删除这条私密记录?' : 'Delete this private record?')) return
    setBusy(true)
    await deleteTrackerEntry(entry.id)
    onSaved()
  }

  return (
    <div className="log-dialog-backdrop" onClick={() => !busy && onClose()}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</h3>
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '类型' : 'Type'}</label>
          <select className="th-input" value={cat} onChange={(e) => setCat(e.target.value as IntimacyCategory)}>
            {INTIMACY_CATEGORIES.map((c) => (<option key={c} value={c}>{intimacyLabel(c, lang)}</option>))}
          </select>
        </div>
        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '次数' : 'Count'}</label>
            <input className="th-input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
        </div>
        <div className="log-field">
          <label className="th-label">{lang === 'zh' ? '备注' : 'Note'}</label>
          <input className="th-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={lang === 'zh' ? '可选' : 'optional'} />
        </div>
        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={del} disabled={busy}>{lang === 'zh' ? '删除' : 'Delete'}</button>
          <button className="th-btn" type="button" onClick={save} disabled={busy}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

/** A circuit (alternating movements). No round concept — every set is its own
 *  line ("movement value"), stacked vertically in performed (interleaved) order,
 *  so it stays narrow and handles uneven / all-different sets. */
function CircuitCard({
  members,
  exById,
  setMap,
  lang,
  discreet,
  onUnmerge,
}: {
  members: WorkoutEntry[]
  exById: Record<string, Exercise>
  setMap: Record<string, ExerciseSet[]>
  lang: 'en' | 'zh'
  discreet: boolean
  onUnmerge: () => void
}) {
  const cols = members.map((e) => ({ ex: exById[e.exercise_id], sets: setMap[e.id] ?? [] }))
  const maxRounds = Math.max(0, ...cols.map((c) => c.sets.length))
  // Flatten to one line per set, in the order performed (set 1 of each movement,
  // then set 2, …). Uneven set counts just contribute fewer lines.
  const lines: { name: string; set: ExerciseSet; ex: Exercise }[] = []
  for (let r = 0; r < maxRounds; r++) {
    for (const c of cols) {
      const st = c.sets[r]
      if (st && c.ex) lines.push({ name: exerciseName(c.ex, lang), set: st, ex: c.ex })
    }
  }
  return (
    <div className="hist-circuit">
      <div className="hist-circuit-top">
        <span className="hist-dot" style={{ background: ACTIVITY_COLORS.bodyweight }} />
        <span className="hist-name">{lang === 'zh' ? '循环 · 交替' : 'Circuit'}</span>
        <button type="button" className="hist-circuit-split" onClick={onUnmerge}>{lang === 'zh' ? '拆开' : 'split'}</button>
      </div>
      {discreet ? (
        <div className="hist-circuit-flat"><span className="hist-set">{lines.length} {lang === 'zh' ? '组' : 'sets'}</span></div>
      ) : (
        <div className="hist-circuit-flat">
          {lines.map((ln, i) => (
            <div key={i} className="hist-circuit-line">
              <span className="hist-circuit-nm">{ln.name}</span>
              <span className="hist-set">{formatSetLine(ln.set, ln.ex.measure_type, lang, ln.ex.duration_hm)}</span>
              {ln.set.note && <em className="hist-setnote"> · {ln.set.note}</em>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EntryCard({
  entry,
  exercise,
  allExercises,
  sets,
  lang,
  onChanged,
  selectMode,
  selected,
  onToggleSelect,
  discreet,
  variant,
  onChooseModule,
}: {
  entry: WorkoutEntry
  exercise: Exercise | undefined
  allExercises: Exercise[]
  sets: ExerciseSet[]
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  discreet: boolean
  variant: 'row' | 'card'
  onChooseModule: () => void
}) {
  const [editing, setEditing] = useState(false)

  const needsAttention =
    entry.needs_review ||
    entry.needs_translation ||
    (exercise ? exercise.needs_translation || !exercise.name_en || !exercise.name_zh : false)

  const name = exercise ? exerciseName(exercise, lang) : '(deleted exercise)'
  // Hidden during select mode so the ⇄ chip doesn't collide with the checkbox.
  const canChooseModule = variant === 'card' && !selectMode && !!exercise && exercise.body_parts.length > 1

  const badges = (
    <>
      {entry.injury_modified && (
        <span className="hist-badge injury">{entry.injury_modified === 'paused' ? (lang === 'zh' ? '因伤暂停' : 'paused') : (lang === 'zh' ? '因伤减量' : 'reduced')}</span>
      )}
      {entry.needs_review && <span className="hist-badge review">{lang === 'zh' ? '待复核' : 'review'}</span>}
      {(entry.needs_translation || (exercise && (exercise.needs_translation || !exercise.name_en || !exercise.name_zh))) && (
        <span className="hist-badge translate">{lang === 'zh' ? '待翻译' : 'translate'}</span>
      )}
    </>
  )

  const setsBlock = discreet ? (
    <span className="hist-set">{sets.length} {lang === 'zh' ? '组' : sets.length === 1 ? 'set' : 'sets'}</span>
  ) : (
    sets.map((s) => (
      <span key={s.id} className="hist-set">
        {exercise ? formatSetLine(s, exercise.measure_type, lang, exercise.duration_hm) : '–'}
        {s.set_type !== 'normal' && <em className="hist-settype"> {s.set_type}</em>}
        {s.note && <em className="hist-setnote"> · {s.note}</em>}
      </span>
    ))
  )

  // Note-tag chips + the raw note (with any legacy "lb；" unit prefix stripped).
  const shownNote = displayNote(entry.note_raw)
  const notesBlock = (shownNote || entry.note_tags.length > 0) && (
    <div className="hist-tags">
      {entry.note_tags.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
      {shownNote && <span className="hist-note-inline">{shownNote}</span>}
    </div>
  )

  const onClick = () => (selectMode ? onToggleSelect() : exercise && setEditing(true))

  const dialog = editing && exercise && (
    <EditEntryDialog
      entry={entry}
      exercise={exercise}
      allExercises={allExercises}
      sets={sets}
      lang={lang}
      onChanged={onChanged}
      onClose={() => setEditing(false)}
    />
  )

  if (variant === 'card') {
    return (
      <>
        <div className={`hist-card ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`} onClick={onClick}>
          <div className="hist-card-top">
            <span className="hist-dot" style={{ background: exercise ? ACTIVITY_COLORS[exerciseKind(exercise)] : 'var(--text-dim)' }} />
            <span className="hist-name">{name}</span>
            {selectMode && (
              <input type="checkbox" className="hist-check" checked={selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} aria-label="select" />
            )}
          </div>
          <div className="hist-card-badges">{badges}</div>
          <div className="hist-card-sets">{setsBlock}</div>
          {notesBlock}
          {canChooseModule && (
            <button
              type="button"
              className="hist-module-chip"
              title={lang === 'zh' ? '改归到其他模块' : 'File under another module'}
              onClick={(e) => { e.stopPropagation(); onChooseModule() }}
            >
              ⇄
            </button>
          )}
        </div>
        {dialog}
      </>
    )
  }

  return (
    <>
      <div className={`hist-row ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`} onClick={onClick}>
        {selectMode && (
          <input type="checkbox" className="hist-check" checked={selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} aria-label="select" />
        )}
        <div className="hist-row-main">
          <div className="hist-row-top">
            <span className="hist-dot" style={{ background: exercise ? ACTIVITY_COLORS[exerciseKind(exercise)] : 'var(--text-dim)' }} />
            <span className="hist-name">{name}</span>
            {badges}
          </div>
          <div className="hist-sets">{setsBlock}</div>
          {notesBlock}
        </div>
      </div>
      {dialog}
    </>
  )
}
