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
  assignEntriesToCycleRound,
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
import { noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import type { CycleRound, Exercise, ExerciseSet, IntimacyCategory, OptionalTracker, Sport, SportSession, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import type { BodyPart } from '../../supabase/types'
import { cycleDayTitle } from '../cycle/day'
import { liveCompletedLabels, roundMetrics, roundRegionActivity, openRound } from '../cycle/rounds'
import { BodyModel, type RegionView } from '../cycle/BodyModel'
import { RoundRings, type RingChain } from '../dashboard/RoundRings'
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
import { ExportDialog } from './ExportDialog'
import { ReviewFlow } from './ReviewFlow'
import './history.css'

type HistMode = 'list' | 'grouped'
const MODE_KEY = 'th.history.mode'

/** Loop context for a date: which split day(s) were trained, and the round. */
interface LoopInfo {
  labels: { label: string; title: string }[]
  round: number | null
}

/** Immutable array move: element at `from` relocated to `to`. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice()
  const [x] = copy.splice(from, 1)
  copy.splice(to, 0, x)
  return copy
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

function setSummary(sets: ExerciseSet[], lang: 'en' | 'zh'): string {
  const base = `${sets.length} ${lang === 'zh' ? '组' : sets.length === 1 ? 'set' : 'sets'}`
  const extras = [
    ['superset', sets.filter((s) => s.set_type === 'superset').length],
    ['dropset', sets.filter((s) => s.set_type === 'dropset').length],
  ] as const
  const shown = extras.filter(([, n]) => n > 0)
  if (shown.length === 0) return base
  const suffix = shown.map(([type, n]) => {
    if (lang === 'zh') return `${n}组${type === 'superset' ? '超级组' : '递减组'}`
    return `${n} ${type}${n === 1 ? '' : 's'}`
  }).join(lang === 'zh' ? '、' : ', ')
  return lang === 'zh' ? `${base}（含${suffix}）` : `${base} (${suffix})`
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

      {activeCycle && rounds.length > 0 && !reviewOnly && (
        <section className="hist-rounds">
          <div className="hist-rounds-head">
            <span className="th-label">{lang === 'zh' ? '循环轮次' : 'Cycle rounds'}</span>
            <span className="hist-rounds-cyc">{activeCycle.name}</span>
          </div>
          <ul className="hist-rounds-list">
            {[...rounds].filter((r) => !r.skipped).reverse().map((r) => {
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
          sportById={sportById}
          sportSessions={sportSessions}
          intimacyRows={intimacyRows}
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
  const existingRound = items.find((e) => e.cycle_round_id)?.cycle_round_id ?? latestOpen?.id ?? null
  const [roundId, setRoundId] = useState<string | null>(existingRound)
  const [dayLabel, setDayLabel] = useState(items.find((e) => e.cycle_day_label)?.cycle_day_label ?? cycle.days[0]?.label ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((e) => e.id)))
  const [moduleById, setModuleById] = useState<Record<string, BodyPart | ''>>(() => Object.fromEntries(items.map((e) => [e.id, e.module_part ?? ''])))
  const countSets = useMemo(() => (id: string) => setCountOf(setMap, id), [setMap])
  const orderedRounds = useMemo(() => [...rounds].sort((a, b) => b.index - a.index), [rounds])
  const previewRound = roundId ? rounds.find((r) => r.id === roundId) ?? null : null
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
    if (!previewRound) return {}
    const activity = roundRegionActivity(cycle, previewRound, allEntries, countSets)
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
  }, [allEntries, countSets, cycle, exById, lang, previewRound])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    await assignEntriesToCycleRound(cycle, {
      date,
      dayLabel,
      roundId,
      entries: [...selected].map((entryId) => ({
        entryId,
        modulePart: moduleById[entryId] ? moduleById[entryId] as BodyPart : null,
      })),
    })
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
            <span className="th-label">{lang === 'zh' ? '第几轮' : 'Round'}</span>
            <div className="hist-assign-rounds">
              <button type="button" className={`hist-round-pick ${roundId === null ? 'on' : ''}`} onClick={() => setRoundId(null)}>
                <span>R{rounds.reduce((m, r) => Math.max(m, r.index), 0) + 1}</span>
                <small>{lang === 'zh' ? '新一轮' : 'new'}</small>
              </button>
              {orderedRounds.map((r) => (
                <RoundRings key={r.id} mini chains={ringFor(r)} centerLabel={`R${r.index}`} active={roundId === r.id} onClick={() => setRoundId(r.id)} />
              ))}
            </div>
            {previewRound ? <BodyModel activity={body} lang={lang} compact /> : <p className="hist-assign-hint">{lang === 'zh' ? '保存时创建新一轮' : 'Saving creates a new round'}</p>}
          </section>

          <section className="hist-assign-panel">
            <span className="th-label">{lang === 'zh' ? '分化部分' : 'Split day'}</span>
            <div className="hist-assign-days">
              {cycle.days.map((d) => (
                <button key={d.label} type="button" className={`hist-day-pick ${dayLabel === d.label ? 'on' : ''}`} onClick={() => setDayLabel(d.label)}>
                  <b>{d.label}</b>
                  <span>{cycleDayTitle(d, lang)}</span>
                </button>
              ))}
            </div>

            <span className="th-label">{lang === 'zh' ? '动作归入' : 'Entries'}</span>
            <div className="hist-assign-entries">
              {items.map((e) => {
                const ex = exById[e.exercise_id]
                return (
                  <label key={e.id} className={`hist-assign-entry ${selected.has(e.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    <span>{ex ? exerciseName(ex, lang) : '?'}</span>
                    <small>{countSets(e.id)} {lang === 'zh' ? '组' : 'sets'}</small>
                    <select
                      className="th-input"
                      value={moduleById[e.id] ?? ''}
                      onChange={(ev) => setModuleById((m) => ({ ...m, [e.id]: ev.target.value as BodyPart | '' }))}
                    >
                      <option value="">{lang === 'zh' ? '默认肌群' : 'default'}</option>
                      {categoryKeys().map((k) => <option key={k} value={k}>{categoryLabel(k, lang)}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          </section>
        </div>

        <div className="hist-assign-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={() => void save()} disabled={!dayLabel || selected.size === 0}>
            {lang === 'zh' ? '保存归类' : 'Save'}
          </button>
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
  const levelField = sport?.fields?.find((f) => f.type === 'select' && ss.attributes?.[f.key])
  const level = levelField ? attrLabel(levelField, ss.attributes[levelField.key], lang) : null
  const detailFields = (sport?.fields ?? []).filter((f) => f.key !== levelField?.key)
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
          {level && <span className="hist-sport-level">{level}</span>}
          {ss.injury && <span className="hist-badge injury">{lang === 'zh' ? '带伤' : 'injury'}</span>}
        </div>
        <div className="hist-sets">
          <span className="hist-set">{formatHours(ss.hours)}{formatMetrics(ss)}</span>
          {detailFields.map((f) => ss.attributes?.[f.key] && (
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
  variant = 'card',
}: {
  members: WorkoutEntry[]
  exById: Record<string, Exercise>
  setMap: Record<string, ExerciseSet[]>
  lang: 'en' | 'zh'
  discreet: boolean
  onUnmerge: () => void
  variant?: 'row' | 'card'
}) {
  const cols = members.map((e) => ({ ex: exById[e.exercise_id], sets: setMap[e.id] ?? [] }))
  const maxRounds = Math.max(0, ...cols.map((c) => c.sets.length))
  // Body parts this circuit trains = the displayed part of each member (its chosen
  // module_part, else the exercise's primary category), deduped.
  const parts = [
    ...new Set(
      members
        .map((e) => e.module_part ?? (exById[e.exercise_id] ? primaryCategory(exById[e.exercise_id]) : null))
        .filter((p): p is string => !!p),
    ),
  ]
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
    <div className={`hist-circuit ${variant === 'row' ? 'wide' : ''}`}>
      <div className="hist-circuit-top">
        <span className="hist-dot" style={{ background: ACTIVITY_COLORS.bodyweight }} />
        <span className="hist-name">{lang === 'zh' ? '循环 · 交替' : 'Circuit'}</span>
        {parts.length > 0 && (
          <span className="hist-circuit-bp">
            {parts.map((p) => (
              <span key={p} className="hist-bpchip">{categoryLabel(p, lang)}</span>
            ))}
          </span>
        )}
        <button type="button" className="hist-circuit-split" onClick={onUnmerge}>{lang === 'zh' ? '拆开' : 'split'}</button>
      </div>
      {variant === 'row' ? (
        // List/bar mode: full-width 2-row table — headers = movements, row below = what
        // was done (each set stacked under its movement; just set counts when discreet).
        <div className="hist-circuit-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c, i) => (
            <div key={`h${i}`} className="hist-circuit-col-head">{c.ex ? exerciseName(c.ex, lang) : '–'}</div>
          ))}
          {cols.map((c, i) => (
            <div key={`v${i}`} className="hist-circuit-col-sets">
              {discreet ? (
                <span className="hist-set">{c.sets.length} {lang === 'zh' ? '组' : 'sets'}</span>
              ) : (
                c.sets.map((s) => (
                  <span key={s.id} className="hist-set">{c.ex ? formatSetLine(s, c.ex.measure_type, lang, c.ex.duration_hm) : '–'}</span>
                ))
              )}
            </div>
          ))}
        </div>
      ) : discreet ? (
        // Grouped/card compact: which movements + how many sets each, no reps/weights.
        <div className="hist-circuit-flat">
          {cols.map((c, i) =>
            c.ex ? (
              <div key={i} className="hist-circuit-line">
                <span className="hist-circuit-nm">{exerciseName(c.ex, lang)}</span>
                <span className="hist-set">{c.sets.length} {lang === 'zh' ? '组' : 'sets'}</span>
              </div>
            ) : null,
          )}
        </div>
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
  reorderMode = false,
  onDragStart,
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
  reorderMode?: boolean
  onDragStart?: (ev: React.PointerEvent) => void
}) {
  const [editing, setEditing] = useState(false)

  const needsAttention =
    entry.needs_review ||
    entry.needs_translation ||
    (exercise ? exercise.needs_translation || !exercise.name_en || !exercise.name_zh : false)

  const name = exercise ? exerciseName(exercise, lang) : '(deleted exercise)'
  // Hidden during select mode so the ⇄ chip doesn't collide with the checkbox.
  const canChooseModule = variant === 'card' && !selectMode && !reorderMode && !!exercise && exercise.body_parts.length > 1

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
    <span className="hist-set">{setSummary(sets, lang)}</span>
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
        <div
          data-eid={entry.id}
          className={`hist-card ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''} ${!selectMode && !reorderMode ? 'clickable' : ''} ${reorderMode ? 'reordering' : ''}`}
          onClick={reorderMode ? undefined : onClick}
        >
          <div className="hist-card-top">
            {reorderMode && (
              <button type="button" className="hist-drag" aria-label={lang === 'zh' ? '拖动排序' : 'drag to reorder'}
                onPointerDown={onDragStart} onClick={(e) => e.stopPropagation()} style={{ touchAction: 'none' }}>⠿</button>
            )}
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
