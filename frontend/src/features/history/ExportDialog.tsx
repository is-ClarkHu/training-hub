// Export a date range of History as one long PNG (share-friendly). A dialog picks
// the range, whether to show set values + intimacy, and grid vs list layout; the
// records render into an off-screen sheet that html-to-image snapshots.
import { useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { Exercise, ExerciseSet, OptionalTracker, Sport, SportSession, WorkoutEntry } from '../../supabase/types'
import { categoryLabel } from '../../categories'
import { exerciseName, formatSetLine, primaryCategory } from '../log/util'
import { sportName } from '../sports'
import { intimacyCategory, intimacyLabel } from '../intimacy'
import './history.css'

interface DayGroup { date: string; items: WorkoutEntry[]; sports: SportSession[]; intimacy: OptionalTracker[] }

export function ExportDialog({
  entries,
  setMap,
  exById,
  sportById,
  sportSessions,
  intimacyRows,
  lang,
  onClose,
}: {
  entries: WorkoutEntry[]
  setMap: Record<string, ExerciseSet[]>
  exById: Record<string, Exercise>
  sportById: Record<string, Sport>
  sportSessions: SportSession[]
  intimacyRows: OptionalTracker[]
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
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [busy, setBusy] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

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
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first
  }, [entries, sportSessions, intimacyRows, from, to, showIntimacy])

  const setText = (e: WorkoutEntry): string => {
    const ex = exById[e.exercise_id]
    const sets = (setMap[e.id] ?? []).filter((s) => s.set_type !== 'warmup')
    if (!showValues) return `${sets.length} ${lang === 'zh' ? '组' : 'sets'}`
    if (!ex) return `${sets.length}`
    return sets.map((s) => formatSetLine(s, ex.measure_type, lang, ex.duration_hm)).join(' · ')
  }

  const modulesOf = (its: WorkoutEntry[]) => {
    const groups = new Map<string, WorkoutEntry[]>()
    for (const e of its) {
      const ex = exById[e.exercise_id]
      const key = e.module_part ?? (ex ? primaryCategory(ex) : null) ?? '__none'
      let arr = groups.get(key)
      if (!arr) { arr = []; groups.set(key, arr) }
      arr.push(e)
    }
    return [...groups.entries()]
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

  const entryRow = (e: WorkoutEntry) => {
    const ex = exById[e.exercise_id]
    return (
      <div key={e.id} className="hx-entry">
        <span className="hx-ex">{ex ? exerciseName(ex, lang) : '—'}</span>
        <span className="hx-sets">{setText(e)}</span>
      </div>
    )
  }

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
        <div className="cyc-seg hx-seg">
          <button type="button" className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')}>{lang === 'zh' ? '网格' : 'Grid'}</button>
          <button type="button" className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')}>{lang === 'zh' ? '条形' : 'List'}</button>
        </div>
        <p className="hx-count">{days.length} {lang === 'zh' ? '天' : 'days'}</p>
        <div className="log-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose} disabled={busy}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={generate} disabled={busy || days.length === 0}>
            {busy ? (lang === 'zh' ? '生成中…' : 'Generating…') : (lang === 'zh' ? '生成长图' : 'Generate')}
          </button>
        </div>
      </div>

      {/* off-screen sheet that gets snapshotted */}
      <div className="hx-holder" aria-hidden="true">
        <div ref={sheetRef} className="hx-sheet">
          <div className="hx-title">
            <strong>training·hub</strong>
            <span>{from} — {to}</span>
          </div>
          {days.map((day) => (
            <section key={day.date} className="hx-day">
              <div className="hx-daydate">{day.date}</div>
              {day.items.length > 0 && (
                layout === 'grid' ? (
                  <div className="hx-modules">
                    {modulesOf(day.items).map(([key, its]) => (
                      <div key={key} className="hx-module">
                        <div className="hx-modhead">{key === '__none' ? '—' : categoryLabel(key, lang)}</div>
                        {its.map(entryRow)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="hx-listwrap">{day.items.map(entryRow)}</div>
                )
              )}
              {day.sports.map((s) => (
                <div key={s.id} className="hx-entry hx-sport">
                  <span className="hx-ex">🏃 {sportById[s.sport_id] ? sportName(sportById[s.sport_id], lang) : (lang === 'zh' ? '运动' : 'sport')}</span>
                  <span className="hx-sets">{s.hours}h</span>
                </div>
              ))}
              {showIntimacy && day.intimacy.map((r) => (
                <div key={r.id} className="hx-entry hx-intim">
                  <span className="hx-ex">💗 {intimacyLabel(intimacyCategory(r), lang, true)}</span>
                  <span className="hx-sets">×{r.count}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
