// Export a date range of History as one long PNG (share-friendly). A dialog picks
// the range, whether to show set values + intimacy, and grouped vs list layout;
// the records render into an off-screen sheet that html-to-image snapshots.
//
// The sheet reuses History's own row components (./rows) in History's own
// structure, so the image matches what the user is looking at. It previously had a
// parallel simplified re-implementation, which drifted: circuits vanished, sports
// lost their level/detail fields, intimacy rows looked nothing like History's, and
// the module blocks were ad-hoc. Anything visual belongs in ./rows, not here.
import { useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type {
  CycleRound, EntryCycleAssignment, Exercise, ExerciseSet, OptionalTracker, Sport, SportSession, TrainingCycle, WorkoutEntry,
} from '../../supabase/types'
import { entrySortKey } from '../../db'
import { categoryLabel } from '../../categories'
import { cycleDayTitle } from '../cycle/day'
import { cycleMemberships } from '../cycle/rounds'
import {
  CircuitCard, EntryCard, IntimacyRow, SportRow, groupByModule, partitionCircuits, type LoopInfo,
} from './rows'
import './history.css'

interface DayGroup { date: string; items: WorkoutEntry[]; sports: SportSession[]; intimacy: OptionalTracker[] }

// Keep in sync with .hx-sheet's width in history.css.
const SHEET_W = 1080
const PREVIEW_SCALE = 0.34

export function ExportDialog({
  entries,
  setMap,
  exById,
  allExercises,
  sportById,
  sportSessions,
  intimacyRows,
  activeCycle,
  rounds,
  assignments,
  lang,
  onClose,
}: {
  entries: WorkoutEntry[]
  setMap: Record<string, ExerciseSet[]>
  exById: Record<string, Exercise>
  allExercises: Exercise[]
  sportById: Record<string, Sport>
  sportSessions: SportSession[]
  intimacyRows: OptionalTracker[]
  activeCycle: TrainingCycle | null
  rounds: CycleRound[]
  assignments: EntryCycleAssignment[]
  lang: 'en' | 'zh'
  onClose: () => void
}) {
  const allDates = useMemo(
    () => [...new Set([...entries.map((e) => e.date), ...sportSessions.map((s) => s.date)])].sort(),
    [entries, sportSessions],
  )
  const [from, setFrom] = useState(allDates[0] ?? '')
  const [to, setTo] = useState(allDates[allDates.length - 1] ?? '')
  const [showValues, setShowValues] = useState(true)
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [layout, setLayout] = useState<'grouped' | 'list'>('grouped')
  const [busy, setBusy] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  // "Show values" off === History's discreet mode. The row components already
  // implement it (set counts instead of weights; intimacy shows only that a
  // record exists, never the category or count), so it stays consistent.
  const discreet = !showValues

  const days = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>()
    const get = (d: string) => {
      let g = map.get(d)
      if (!g) { g = { date: d, items: [], sports: [], intimacy: [] }; map.set(d, g) }
      return g
    }
    for (const e of entries) if (e.date >= from && e.date <= to) get(e.date).items.push(e)
    for (const s of sportSessions) if (s.date >= from && s.date <= to) get(s.date).sports.push(s)
    if (showIntimacy) for (const r of intimacyRows) if (r.date >= from && r.date <= to) get(r.date).intimacy.push(r)
    // Same ordering as History: performed order within a day, newest day first.
    for (const g of map.values()) g.items.sort((a, b) => entrySortKey(a) - entrySortKey(b))
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [entries, sportSessions, intimacyRows, from, to, showIntimacy])

  // Mirrors HistoryScreen.loopInfo so exported days carry the same split/round
  // badges — derived from the M2M memberships of the date's entries.
  const loopInfo = (date: string, items: WorkoutEntry[]): LoopInfo | null => {
    if (!activeCycle) return null
    const dayByLabel = new Map(activeCycle.days.map((d) => [d.label, d]))
    const roundById = new Map(rounds.map((r) => [r.id, r]))
    const ids = new Set(items.map((e) => e.id))
    const mems = cycleMemberships(activeCycle, entries, assignments).filter((m) => ids.has(m.entryId))
    const seen = new Set<string>()
    const labels: { label: string; title: string }[] = []
    const roundIdxs = new Set<number>()
    for (const m of mems) {
      const day = dayByLabel.get(m.dayLabel)
      if (day && !seen.has(m.dayLabel)) {
        seen.add(m.dayLabel)
        labels.push({ label: m.dayLabel, title: cycleDayTitle(day, lang) })
      }
      const r = (m.roundId ? roundById.get(m.roundId) : undefined)
        ?? rounds.find((rr) => rr.started_on <= date && (rr.ended_on ?? '9999-12-31') >= date)
      if (r) roundIdxs.add(r.index)
    }
    if (labels.length === 0) return null
    return { labels, rounds: [...roundIdxs].sort((a, b) => a - b) }
  }

  async function generate() {
    if (!sheetRef.current) return
    setBusy(true)
    try {
      const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0c151c'
      const url = await toPng(sheetRef.current, { pixelRatio: 2, backgroundColor: bg, cacheBust: true })
      const a = document.createElement('a')
      a.href = url
      a.download = `training-hub_${from}_${to}.png`
      a.click()
      onClose()
    } catch {
      setBusy(false)
    }
  }

  // Static stand-ins for the interactive props; the sheet is a snapshot.
  const noop = () => {}
  const cardProps = (entry: WorkoutEntry, variant: 'row' | 'card') => ({
    entry,
    exercise: exById[entry.exercise_id],
    allExercises,
    sets: setMap[entry.id] ?? [],
    lang,
    onChanged: noop,
    selectMode: false,
    selected: false,
    onToggleSelect: noop,
    discreet,
    variant,
    onChooseModule: noop,
  })

  return (
    <div className="log-dialog-backdrop" onClick={() => !busy && onClose()}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{lang === 'zh' ? '导出长图' : 'Export image'}</h3>
        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '从' : 'From'}</label>
            <input className="th-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '到' : 'To'}</label>
            <input className="th-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="hx-opts">
          <label><input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} /> {lang === 'zh' ? '显示数值' : 'Show values'}</label>
          <label><input type="checkbox" checked={showIntimacy} onChange={(e) => setShowIntimacy(e.target.checked)} /> {lang === 'zh' ? '含私密' : 'Include intimacy'}</label>
        </div>
        <div className="hx-seg">
          <button type="button" className={layout === 'grouped' ? 'on' : ''} onClick={() => setLayout('grouped')}>{lang === 'zh' ? '网格' : 'Grid'}</button>
          <button type="button" className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')}>{lang === 'zh' ? '条形' : 'List'}</button>
        </div>
        {/* Scaled preview of the first day, so picking a layout visibly does something. */}
        {days.length > 0 && (
          <>
            <div className="hx-preview">
              <div className="hx-preview-inner" style={{ width: SHEET_W, transform: `scale(${PREVIEW_SCALE})` }}>
                <div className="hx-sheet" style={{ padding: 20 }}>{renderDay(days[0])}</div>
              </div>
            </div>
            <p className="hx-preview-cap">
              {lang === 'zh' ? `预览 · ${days[0].date}` : `Preview · ${days[0].date}`}
            </p>
          </>
        )}
        <p className="hx-count">{days.length} {lang === 'zh' ? '天' : 'days'}</p>
        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose} disabled={busy}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={generate} disabled={busy || days.length === 0}>
            {busy ? (lang === 'zh' ? '生成中…' : 'Generating…') : (lang === 'zh' ? '生成长图' : 'Generate')}
          </button>
        </div>
      </div>

      {/* Off-screen sheet that gets snapshotted — same structure as HistoryScreen. */}
      <div className="hx-holder" aria-hidden="true">
        <div ref={sheetRef} className="hx-sheet">
          <div className="hx-title">
            <strong>training·hub</strong>
            <span>{from} — {to}</span>
          </div>
          {days.map(renderDay)}
        </div>
      </div>
    </div>
  )

  function renderDay(day: DayGroup) {
    const { circuits, singles } = partitionCircuits(day.items)
    const loop = loopInfo(day.date, day.items)
    return (
      <section key={day.date} className="hist-session">
        <div className="hist-date-row">
          <h3 className="hist-date">{day.date}</h3>
          {loop && (
            <span className="hist-loop">
              {loop.labels.map((l) => (
                <span key={l.label} className="hist-loop-day"><b>{l.label}</b> {l.title}</span>
              ))}
              {loop.rounds.map((r) => <span key={r} className="hist-loop-round">R{r}</span>)}
            </span>
          )}
        </div>

        {layout === 'list' && circuits.map((members) => (
          <CircuitCard
            key={members[0].superset_group ?? members[0].id}
            members={members}
            exById={exById}
            setMap={setMap}
            lang={lang}
            discreet={discreet}
            onUnmerge={noop}
            variant="row"
          />
        ))}

        {layout === 'grouped' ? (
          <div className="hist-modules">
            {circuits.map((members) => (
              <CircuitCard
                key={members[0].superset_group ?? members[0].id}
                members={members}
                exById={exById}
                setMap={setMap}
                lang={lang}
                discreet={discreet}
                onUnmerge={noop}
              />
            ))}
            {groupByModule(singles, exById).map((g) => (
              <div key={g.key} className="hist-module" data-count={Math.min(g.items.length, 4)}>
                <div className="hist-module-head">{g.key === '__none' ? '—' : categoryLabel(g.key, lang)}</div>
                <div className="hist-cards">
                  {g.items.map((entry) => <EntryCard key={entry.id} {...cardProps(entry, 'card')} />)}
                </div>
              </div>
            ))}
            {(day.sports.length > 0 || (showIntimacy && day.intimacy.length > 0)) && (
              <div className="hist-entries">
                {day.sports.map((ss) => (
                  <SportRow key={ss.id} ss={ss} sport={sportById[ss.sport_id]} lang={lang}
                    selectMode={false} selected={false} onToggle={noop} onOpen={noop} />
                ))}
                {showIntimacy && day.intimacy.map((r) => (
                  <IntimacyRow key={r.id} r={r} lang={lang} discreet={discreet}
                    selectMode={false} selected={false} onToggle={noop} onOpen={noop} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="hist-entries">
            {singles.map((entry) => <EntryCard key={entry.id} {...cardProps(entry, 'row')} />)}
            {day.sports.map((ss) => (
              <SportRow key={ss.id} ss={ss} sport={sportById[ss.sport_id]} lang={lang}
                selectMode={false} selected={false} onToggle={noop} onOpen={noop} />
            ))}
            {showIntimacy && day.intimacy.map((r) => (
              <IntimacyRow key={r.id} r={r} lang={lang} discreet={discreet}
                selectMode={false} selected={false} onToggle={noop} onOpen={noop} />
            ))}
          </div>
        )}
      </section>
    )
  }
}
