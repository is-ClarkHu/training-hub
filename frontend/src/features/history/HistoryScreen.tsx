// History tab (SPEC §7.2): reverse-chronological sessions; tags localized;
// entries editable / deletable; needs_review and needs_translation surfaced for
// cleanup. Two layouts (list / grouped-by-module, toggled top-right); a guided
// review stepper; per-date loop badges. Reads the local-first store; edits/deletes
// are soft (sync-safe, §3).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  getActiveCycle,
  getCycles,
  getCycleRounds,
  getEntries,
  getExercises,
  getSetsByEntryIds,
  getSportSessions,
  getSports,
  getTrackerEntries,
  newId,
  patchEntry,
  moveDayEntries,
  refreshCycleRoundsForAssignments,
  assignEntriesToCycleTargets,
  reorderEntries,
  entrySortKey,
  softDeleteEntry,
  softDeleteSportSession,
  deleteTrackerEntry,
  updateTrackerEntry,
  withUndo,
} from '../../db'
import { useUndo } from '../../undo'
import { categoryKeys, categoryLabel } from '../../categories'
import { useLanguage } from '../../i18n'
import type { CycleRound, Exercise, ExerciseSet, IntimacyCategory, OptionalTracker, Sport, SportSession, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import type { BodyPart } from '../../supabase/types'
import { cycleDayTitle } from '../cycle/day'
import { liveCompletedLabels, roundMetrics, roundRegionActivity, openRound } from '../cycle/rounds'
import { BodyModel, type RegionView } from '../cycle/BodyModel'
import { RoundRings, type RingChain } from '../dashboard/RoundRings'
import { SportSessionDialog } from '../sports'
import { INTIMACY_CATEGORIES, intimacyCategory, intimacyLabel, intimacyVisible } from '../intimacy'
import { exerciseName, primaryCategory } from '../log/util'
import {
  CircuitCard,
  EntryCard,
  IntimacyRow,
  SportRow,
  groupByModule as groupEntriesByModule,
  partitionCircuits,

  type LoopInfo,
} from './rows'
import { ExportDialog } from './ExportDialog'
import { ReviewFlow } from './ReviewFlow'
import './history.css'

type HistMode = 'list' | 'grouped'
const MODE_KEY = 'th.history.mode'

/** Immutable array move: element at `from` relocated to `to`. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice()
  const [x] = copy.splice(from, 1)
  copy.splice(to, 0, x)
  return copy
}

function setCountOf(setMap: Record<string, ExerciseSet[]>, id: string): number {
  return (setMap[id] ?? []).filter((s) => s.set_type !== 'warmup').length
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
  const [allCycles, setAllCycles] = useState<TrainingCycle[]>([])
  const [roundsByCycle, setRoundsByCycle] = useState<Record<string, CycleRound[]>>({})
  const [assignCycle, setAssignCycle] = useState<TrainingCycle | null>(null)
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sportEditing, setSportEditing] = useState<SportSession | null>(null)
  const [intimacyEditing, setIntimacyEditing] = useState<OptionalTracker | null>(null)
  const [moduleEditing, setModuleEditing] = useState<WorkoutEntry | null>(null)
  const [cycleAssigning, setCycleAssigning] = useState<{ date: string; items: WorkoutEntry[] } | null>(null)
  const [reviewIds, setReviewIds] = useState<string[] | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [discreet, setDiscreet] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [exporting, setExporting] = useState(false)
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
    // All cycles + their rounds — the assign flow lets you file a day into ANY split.
    const cs = await getCycles()
    setAllCycles(cs)
    const pairs = await Promise.all(cs.map(async (c) => [c.id, await getCycleRounds(c.id)] as const))
    setRoundsByCycle(Object.fromEntries(pairs))
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Move a whole mis-dated day's workouts to the correct date.
  const moveDay = useCallback(
    async (date: string) => {
      const to = window.prompt(
        lang === 'zh' ? `把 ${date} 的训练移到哪天?(YYYY-MM-DD)` : `Move ${date}'s workouts to (YYYY-MM-DD):`,
        date,
      )?.trim()
      if (!to || to === date) return
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        alert(lang === 'zh' ? '日期格式应为 YYYY-MM-DD' : 'Date must be YYYY-MM-DD')
        return
      }
      await moveDayEntries(date, to)
      if (activeCycle) await refreshCycleRoundsForAssignments(activeCycle)
      await reload()
    },
    [activeCycle, lang, reload],
  )

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
    // Within a day, order by performed order (sort_order asc) — first done, first shown.
    for (const g of map.values()) g.items.sort((a, b) => entrySortKey(a) - entrySortKey(b))
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [entries, sportSessions, intimacyRows, reviewOnly, showIntimacy, flagged])

  // The open round of the active cycle + which of its day labels are still to do.
  const currentRoundView = useMemo(() => {
    if (!activeCycle) return null
    const round = openRound(rounds)
    if (!round || round.skipped) return null
    const done = liveCompletedLabels(activeCycle, round, entries)
    const remaining = activeCycle.days.map((d) => d.label).filter((l) => !done.includes(l))
    return { round, done, remaining }
  }, [activeCycle, rounds, entries])

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
    // Prefer the round the day's entries are actually assigned to (cycle_round_id);
    // fall back to date-range matching only for legacy entries without an assignment.
    const roundId = items.find((e) => e.cycle_round_id && (!e.cycle_id || e.cycle_id === activeCycle.id))?.cycle_round_id
    const round = (roundId ? rounds.find((r) => r.id === roundId) : undefined)
      ?? rounds.find((r) => r.started_on <= date && (r.ended_on ?? '9999-12-31') >= date)
    return { labels, round: round?.index ?? null }
  }, [activeCycle, rounds, lang])

  const groupByModule = useCallback(
    (items: WorkoutEntry[]) => groupEntriesByModule(items, exById),
    [exById],
  )

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

  // ── Reorder within a module (grouped view): pointer-drag from a grip handle ──
  const { push } = useUndo()
  const [reorderMode, setReorderMode] = useState(false)
  const drag = useRef<{ modKey: string; ids: string[]; from: number; over: number } | null>(null)
  const [, bumpDrag] = useReducer((x: number) => x + 1, 0)
  function startDrag(modKey: string, ids: string[], id: string, ev: React.PointerEvent) {
    ev.preventDefault(); ev.stopPropagation()
    const state = { modKey, ids, from: ids.indexOf(id), over: ids.indexOf(id) }
    drag.current = state
    bumpDrag()
    const onMove = (e: PointerEvent) => {
      const card = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.hist-card') as HTMLElement | null
      const eid = card?.dataset.eid
      if (!eid) return
      const idx = state.ids.indexOf(eid)
      if (idx >= 0 && idx !== state.over) { state.over = idx; bumpDrag() }
    }
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      drag.current = null; bumpDrag()
      if (state.from === state.over) return
      const newIds = moveItem(state.ids, state.from, state.over)
      const { undo } = await withUndo(['workout_entries'], () => reorderEntries(newIds))
      await reload()
      push(lang === 'zh' ? '已调整顺序' : 'Reordered', async () => { await undo(); await reload() })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  // Apply the in-progress drag to a module's items for live feedback.
  const dragOrder = (modKey: string, items: WorkoutEntry[]): WorkoutEntry[] => {
    const d = drag.current
    return d && d.modKey === modKey ? moveItem(items, d.from, d.over) : items
  }

  if (loading) return <p className="hist-empty">Loading…</p>
  if (entries.length === 0 && sportSessions.length === 0 && intimacyRows.length === 0) {
    return <p className="hist-empty">No sessions logged yet. Head to the Log tab.</p>
  }

  const cardProps = (entry: WorkoutEntry, variant: 'row' | 'card') => ({
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
        <button className="th-pill" type="button" onClick={() => setExporting(true)}>
          🖼 {lang === 'zh' ? '导出' : 'Export'}
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
        {mode === 'grouped' && !selectMode && (
          <button className={`th-pill ${reorderMode ? 'on' : ''}`} type="button" onClick={() => { setReorderMode((v) => !v); drag.current = null }}>
            ↕ {reorderMode ? (lang === 'zh' ? '完成' : 'done') : (lang === 'zh' ? '排序' : 'reorder')}
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

      {/* Only the round in progress. This used to list every round ever run, which
          buried the one fact the header is for: where you are right now. Finished
          rounds stay reachable from the round picker + the Cycle screen. */}
      {activeCycle && currentRoundView && !reviewOnly && (
        <section className="hist-rounds">
          <div className="hist-rounds-head">
            <span className="th-label">{lang === 'zh' ? '当前轮次' : 'Current round'}</span>
            <span className="hist-rounds-cyc">{activeCycle.name}</span>
          </div>
          <ul className="hist-rounds-list">
            <li className="hist-round-row">
              <span className="hist-round-idx">R{currentRoundView.round.index}</span>
              <span className="hist-round-dates">{currentRoundView.round.started_on} → …</span>
              <span className="hist-round-days">{currentRoundView.done.join('') || '—'}</span>
              <span className="hist-round-badge open">{lang === 'zh' ? '进行中' : 'open'}</span>
            </li>
          </ul>
          {currentRoundView.remaining.length > 0 && (
            <p className="hist-rounds-left">
              {lang === 'zh' ? '还差 ' : 'Left: '}
              {currentRoundView.remaining.join(' · ')}
            </p>
          )}
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
              {!selectMode && s.items.length > 0 && (
                <button
                  className="hist-movedate"
                  type="button"
                  title={lang === 'zh' ? '移动这天的训练到别的日期' : "Move this day's workouts to another date"}
                  onClick={() => moveDay(s.date)}
                >
                  📅
                </button>
              )}
              {!selectMode && s.items.length > 0 && activeCycle && activeCycle.days.length > 0 && (
                <button
                  className="hist-daylabel"
                  type="button"
                  title={lang === 'zh' ? '归类到分化/轮次' : 'Assign to split/round'}
                  onClick={() => setCycleAssigning({ date: s.date, items: s.items })}
                >
                  {lang === 'zh' ? '分化' : 'split'}
                </button>
              )}
              {loop && (
                <span className="hist-loop">
                  {loop.labels.map((l) => (
                    <span key={l.label} className="hist-loop-day"><b>{l.label}</b> {l.title}</span>
                  ))}
                  {loop.round != null && <span className="hist-loop-round">R{loop.round}</span>}
                </span>
              )}
            </div>

            {/* List mode: circuits stack above the entries. Grouped mode: they flow
                inside .hist-modules so narrow ones pack onto a row with the modules. */}
            {mode === 'list' && circuits.map((members) => (
              <CircuitCard
                key={members[0].superset_group ?? members[0].id}
                members={members}
                exById={exById}
                setMap={setMap}
                lang={lang}
                discreet={discreet}
                onUnmerge={() => unmergeCircuit(members)}
                variant="row"
              />
            ))}

            {mode === 'grouped' ? (
              <div className="hist-modules">
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
                {groupByModule(singles).map((g) => {
                  const ids = g.items.map((e) => e.id)
                  return (
                    <div key={g.key} className="hist-module" data-count={Math.min(g.items.length, 4)}>
                      <div className="hist-module-head">{g.key === '__none' ? '—' : categoryLabel(g.key, lang)}</div>
                      <div className="hist-cards">
                        {dragOrder(g.key, g.items).map((entry) => (
                          <EntryCard
                            key={entry.id}
                            {...cardProps(entry, 'card')}
                            reorderMode={reorderMode}
                            onDragStart={(ev) => startDrag(g.key, ids, entry.id, ev)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
                {(s.sports.length > 0 || (showIntimacy && s.intimacy.length > 0)) && (
                  <div className="hist-entries">
                    {s.sports.map((ss) => <SportRow key={ss.id} ss={ss} sport={sportById[ss.sport_id]} lang={lang} selectMode={selectMode} selected={selected.has(ss.id)} onToggle={() => toggleSel(ss.id)} onOpen={() => setSportEditing(ss)} />)}
                    {showIntimacy && s.intimacy.map((r) => <IntimacyRow key={r.id} r={r} lang={lang} discreet={discreet} selectMode={selectMode} selected={selected.has(r.id)} onToggle={() => toggleSel(r.id)} onOpen={() => setIntimacyEditing(r)} />)}
                  </div>
                )}
              </div>
            ) : (
              <div className="hist-entries">
                {singles.map((entry) => <EntryCard key={entry.id} {...cardProps(entry, 'row')} />)}
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

      {exporting && (
        <ExportDialog
          entries={entries}
          setMap={setMap}
          exById={exById}
          allExercises={allExercises}
          sportById={sportById}
          sportSessions={sportSessions}
          intimacyRows={intimacyRows}
          activeCycle={activeCycle}
          rounds={rounds}
          lang={lang}
          onClose={() => setExporting(false)}
        />
      )}

      {cycleAssigning && !assignCycle && (
        <CyclePickerDialog
          cycles={allCycles}
          roundsByCycle={roundsByCycle}
          entries={entries}
          exById={exById}
          setMap={setMap}
          lang={lang}
          onPick={(c) => setAssignCycle(c)}
          onClose={() => setCycleAssigning(null)}
        />
      )}
      {cycleAssigning && assignCycle && (
        <CycleAssignDialog
          date={cycleAssigning.date}
          items={cycleAssigning.items}
          cycle={assignCycle}
          rounds={roundsByCycle[assignCycle.id] ?? []}
          allEntries={entries}
          exById={exById}
          setMap={setMap}
          lang={lang}
          onSaved={() => { setAssignCycle(null); setCycleAssigning(null); void reload() }}
          onClose={() => setAssignCycle(null)}
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

// Step 1 of assigning a day: pick which split (a day can span several). Each split
// shows its latest round as a body map (body mode) or a day-loop (circle mode).
function CyclePickerDialog({
  cycles,
  roundsByCycle,
  entries,
  exById,
  setMap,
  lang,
  onPick,
  onClose,
}: {
  cycles: TrainingCycle[]
  roundsByCycle: Record<string, CycleRound[]>
  entries: WorkoutEntry[]
  exById: Record<string, Exercise>
  setMap: Record<string, ExerciseSet[]>
  lang: 'en' | 'zh'
  onPick: (cycle: TrainingCycle) => void
  onClose: () => void
}) {
  const countSets = (id: string) => setCountOf(setMap, id)
  return (
    <div className="log-dialog-backdrop" onClick={onClose}>
      <div className="log-dialog hist-cyclepick" onClick={(e) => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '归到哪个分化?' : 'Assign to which split?'}</h3>
        <p className="hist-cyclepick-hint">
          {lang === 'zh' ? '一天可以跨多个分化 — 先选一个,存完可以再选另一个归类剩下的。' : 'A day can span splits — pick one, save, then pick another for the rest.'}
        </p>
        {cycles.length === 0 ? (
          <p className="hist-empty">{lang === 'zh' ? '还没有分化框架(去 Cycle 页新建)。' : 'No splits yet (create one in Cycle).'}</p>
        ) : (
          <div className="hist-cyclepick-grid">
            {cycles.map((c) => {
              const rs = roundsByCycle[c.id] ?? []
              const round = openRound(rs) ?? [...rs].sort((a, b) => b.index - a.index)[0] ?? null
              const mode = c.display_mode ?? 'circle'
              const activity: Record<string, RegionView> = {}
              if (round && mode === 'body') {
                const ra = roundRegionActivity(c, round, entries, countSets)
                for (const [region, a] of Object.entries(ra)) {
                  const byEx = new Map<string, { name: string; sets: number; day: string; date: string | null }>()
                  for (const it of a.items) {
                    const ex = exById[it.exId]
                    const cur = byEx.get(it.exId) ?? { name: ex ? exerciseName(ex, lang) : '?', sets: 0, day: it.day, date: null as string | null }
                    cur.sets += it.sets
                    if (it.date && (!cur.date || it.date > cur.date)) cur.date = it.date
                    byEx.set(it.exId, cur)
                  }
                  activity[region] = { sets: a.sets, items: [...byEx.values()] }
                }
              }
              const done = round ? new Set(liveCompletedLabels(c, round, entries)) : new Set<string>()
              return (
                <div key={c.id} role="button" tabIndex={0} className="hist-cyclepick-card" onClick={() => onPick(c)}>
                  <span className="hist-cyclepick-name">{c.name}{round ? ` · R${round.index}` : ''}</span>
                  {mode === 'body' ? (
                    <div className="hist-cyclepick-body"><BodyModel activity={activity} lang={lang} showBack={false} compact /></div>
                  ) : (
                    <span className="hist-cyclepick-loop">
                      {c.days.map((d) => (
                        <span key={d.label} className={`hist-cyclepick-day ${done.has(d.label) ? 'done' : ''}`}>{d.label}</span>
                      ))}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}

interface EntryTarget { roundId: string | null; dayLabel: string; modulePart: BodyPart | '' }

function CycleAssignDialog({
  date,
  items,
  cycle,
  rounds,
  allEntries,
  exById,
  setMap,
  lang,
  onSaved,
  onClose,
}: {
  date: string
  items: WorkoutEntry[]
  cycle: TrainingCycle
  rounds: CycleRound[]
  allEntries: WorkoutEntry[]
  exById: Record<string, Exercise>
  setMap: Record<string, ExerciseSet[]>
  lang: 'en' | 'zh'
  onSaved: () => void
  onClose: () => void
}) {
  // Default to the day's existing assignment, else the LATEST not-yet-full round
  // (highest-index, still open, not skipped) — the round you're currently filling;
  // else null = start a new round.
  const latestOpen = [...rounds].sort((a, b) => b.index - a.index).find((r) => !r.ended_on && !r.skipped)
  // Per-entry target so one date can split across rounds/days (leg lifts → R2's leg
  // day, chest lifts → R3's chest day). Each entry keeps its own (round, day).
  const [targets, setTargets] = useState<Record<string, EntryTarget>>(() =>
    Object.fromEntries(items.map((e) => [e.id, {
      roundId: e.cycle_round_id ?? latestOpen?.id ?? null,
      dayLabel: e.cycle_day_label ?? '',
      modulePart: (e.module_part ?? '') as BodyPart | '',
    }])),
  )
  const setTarget = (id: string, patch: Partial<EntryTarget>) =>
    setTargets((t) => ({ ...t, [id]: { ...t[id], ...patch } }))
  const countSets = useMemo(() => (id: string) => setCountOf(setMap, id), [setMap])
  const orderedRounds = useMemo(() => [...rounds].sort((a, b) => b.index - a.index), [rounds])
  // The round whose body map is previewed — a reference while assigning, not the target.
  const [focusRoundId, setFocusRoundId] = useState<string | null>(latestOpen?.id ?? null)
  const focusRound = focusRoundId ? rounds.find((r) => r.id === focusRoundId) ?? null : null
  const volumeGoal = Math.max(20, cycle.days.length * 12)

  function ringFor(round: CycleRound): RingChain[] {
    const m = roundMetrics(cycle, round, allEntries, countSets)
    return [
      { id: 'complete', label: lang === 'zh' ? '完成' : 'Done', color: '#8ab4f8', value: m.completedDays, goal: m.totalDays || 1 },
      { id: 'volume', label: lang === 'zh' ? '容量' : 'Volume', color: '#ff8a5c', value: m.sets, goal: volumeGoal },
      {
        id: 'balance', label: lang === 'zh' ? '均衡' : 'Balance', color: '#7dd3a0',
        value: m.balance, goal: 100, display: `${m.balance}%`,
      },
    ]
  }

  const body = useMemo<Record<string, RegionView>>(() => {
    if (!focusRound) return {}
    const activity = roundRegionActivity(cycle, focusRound, allEntries, countSets)
    const out: Record<string, RegionView> = {}
    for (const [region, a] of Object.entries(activity)) {
      const byEx = new Map<string, { name: string; sets: number; day: string; date: string | null }>()
      for (const it of a.items) {
        const ex = exById[it.exId]
        const cur = byEx.get(it.exId) ?? { name: ex ? exerciseName(ex, lang) : '?', sets: 0, day: it.day, date: null as string | null }
        cur.sets += it.sets
        if (it.date && (!cur.date || it.date > cur.date)) cur.date = it.date
        byEx.set(it.exId, cur)
      }
      out[region] = { sets: a.sets, items: [...byEx.values()].sort((a, b) => b.sets - a.sets) }
    }
    return out
  }, [allEntries, countSets, cycle, exById, lang, focusRound])

  const anyAssigned = items.some((e) => targets[e.id]?.dayLabel)

  async function save() {
    await assignEntriesToCycleTargets(cycle, date, items.map((e) => ({
      entryId: e.id,
      roundId: targets[e.id].roundId,
      dayLabel: targets[e.id].dayLabel,
      modulePart: targets[e.id].modulePart ? (targets[e.id].modulePart as BodyPart) : null,
    })))
    onSaved()
  }

  return (
    <div className="hist-assign-backdrop" onClick={onClose}>
      <div className="hist-assign" onClick={(e) => e.stopPropagation()}>
        <div className="hist-assign-head">
          <div>
            <span className="th-label">{lang === 'zh' ? '分化归类' : 'Cycle assignment'}</span>
            <h3>{date} · {cycle.name}</h3>
          </div>
          <button className="cyc-dialog-x" type="button" onClick={onClose} aria-label="close">×</button>
        </div>

        <div className="hist-assign-grid">
          <section className="hist-assign-panel">
            <span className="th-label">{lang === 'zh' ? '已有轮次(参考)' : 'Existing rounds (reference)'}</span>
            <div className="hist-assign-rounds">
              {orderedRounds.map((r) => (
                <RoundRings key={r.id} mini chains={ringFor(r)} centerLabel={`R${r.index}`} active={focusRoundId === r.id} onClick={() => setFocusRoundId(r.id)} />
              ))}
            </div>
            {focusRound
              ? <BodyModel activity={body} lang={lang} compact />
              : <p className="hist-assign-hint">{lang === 'zh' ? '点上面的轮次查看身体图' : 'Tap a round to preview its body map'}</p>}
          </section>

          <section className="hist-assign-panel">
            <span className="th-label">{lang === 'zh' ? '逐个归类(可各不相同)' : 'Per entry (can differ)'}</span>
            <div className="hist-assign-entries">
              {items.map((e) => {
                const ex = exById[e.exercise_id]
                const tg = targets[e.id]
                return (
                  <div key={e.id} className={`hist-assign-row ${tg.dayLabel ? 'on' : ''}`}>
                    <span className="hist-assign-nm">{ex ? exerciseName(ex, lang) : '?'}</span>
                    <small>{countSets(e.id)} {lang === 'zh' ? '组' : 'sets'}</small>
                    <select className="th-input" value={tg.roundId ?? ''} onChange={(ev) => setTarget(e.id, { roundId: ev.target.value || null })}>
                      <option value="">{lang === 'zh' ? '新一轮' : 'New'}</option>
                      {orderedRounds.map((r) => <option key={r.id} value={r.id}>R{r.index}</option>)}
                    </select>
                    <select className="th-input" value={tg.dayLabel} onChange={(ev) => setTarget(e.id, { dayLabel: ev.target.value })}>
                      <option value="">{lang === 'zh' ? '不归类' : 'skip'}</option>
                      {cycle.days.map((d) => <option key={d.label} value={d.label}>{d.label} · {cycleDayTitle(d, lang)}</option>)}
                    </select>
                    <select className="th-input" value={tg.modulePart} onChange={(ev) => setTarget(e.id, { modulePart: ev.target.value as BodyPart | '' })}>
                      <option value="">{lang === 'zh' ? '默认肌群' : 'default'}</option>
                      {categoryKeys().map((k) => <option key={k} value={k}>{categoryLabel(k, lang)}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <div className="hist-assign-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={() => void save()} disabled={!anyAssigned}>
            {lang === 'zh' ? '保存归类' : 'Save'}
          </button>
        </div>
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
