// Cycle tab (SPEC §6B): define an N-day training loop (A/B/C/D…), see today/next
// from the last logged cycle day, and per-muscle "days since last trained".
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createCycle,
  createDefaultSplitCycle,
  getActiveCycle,
  getCycleRounds,
  getCycles,
  getEntries,
  getEntryCycleAssignments,
  getExercises,
  getSetsByEntryIds,
  getSports,
  getSportSessions,
  getTrackerEntries,
  setActiveCycle,
  skipCycleRound,
  reopenCycleRound,
  deleteCycleRound,
  softDeleteCycle,
  updateCycle,
  withUndo,
} from '../../db'
import { useLanguage } from '../../i18n'
import { useUndo } from '../../undo'
import {
  type BodyPart,
  type CycleDay,
  type CycleRound,
  type EntryCycleAssignment,
  type Exercise,
  type OptionalTracker,
  type Sport,
  type SportSession,
  type TrainingCycle,
  type WorkoutEntry,
} from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import { muscleRecovery } from '../dashboard/stats'
import { daysSince } from '../injuries/util'
import { sportName } from '../sports'
import { ExerciseManager } from '../log'
import { CategoryManager } from './CategoryManager'
import { currentRound, cycleMemberships, liveCompletedLabels, roundLiveSpan } from './rounds'
import { BodyModel, type RegionView } from './BodyModel'
import { REGIONS, regionLabel, type RegionId } from './anatomy'
import { cycleDayTitle } from './day'
import { exerciseName } from '../log/util'
import { intimacyCategory, intimacyLabel, intimacyVisible } from '../intimacy'
import './cycle.css'

export function CycleScreen() {
  const { lang } = useLanguage()
  const { push } = useUndo()
  const [cycles, setCycles] = useState<TrainingCycle[]>([])
  const [active, setActive] = useState<TrainingCycle | null>(null)
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [assignments, setAssignments] = useState<EntryCycleAssignment[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [exById, setExById] = useState<Record<string, Exercise>>({})
  const [sports, setSports] = useState<Sport[]>([])
  const [sportSessions, setSportSessions] = useState<SportSession[]>([])
  const [roundsByCycle, setRoundsByCycle] = useState<Record<string, CycleRound[]>>({})
  const [setCounts, setSetCounts] = useState<Record<string, number>>({})
  const [intimacyRows, setIntimacyRows] = useState<OptionalTracker[]>([])
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; cycle?: TrainingCycle } | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [hoveredSideCycleId, setHoveredSideCycleId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const visible = intimacyVisible()
    const [cs, act, es, exs, sp, ss, intimacy] = await Promise.all([
      getCycles(),
      getActiveCycle(),
      getEntries(),
      getExercises(),
      getSports(),
      getSportSessions(),
      visible ? getTrackerEntries('intimacy') : Promise.resolve([]),
    ])
    setCycles(cs)
    setActive(act)
    setEntries(es)
    setExercises(exs)
    setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
    setSports(sp)
    setSportSessions(ss)
    setShowIntimacy(visible)
    setIntimacyRows(intimacy)
    const pairs = await Promise.all(cs.map(async (c) => [c.id, await getCycleRounds(c.id)] as const))
    setRoundsByCycle(Object.fromEntries(pairs))
    setAssignments(await getEntryCycleAssignments())
    const sm = await getSetsByEntryIds(es.map((e) => e.id))
    const counts: Record<string, number> = {}
    for (const [eid, list] of Object.entries(sm)) counts[eid] = list.filter((s) => s.set_type !== 'warmup').length
    setSetCounts(counts)
  }, [])

  const rounds = active ? roundsByCycle[active.id] ?? [] : []

  function daySummary(cycle: TrainingCycle, day: CycleDay): CycleDaySummary {
    const exerciseNames = (day.exercise_ids ?? [])
      .map((id) => exById[id])
      .filter((ex): ex is Exercise => !!ex)
      .map((ex) => exerciseName(ex, lang))
    const loggedEntries = entries
      .filter((e) => e.cycle_day_label === day.label && (!e.cycle_id || e.cycle_id === cycle.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    const loggedNames = loggedEntries
      .map((e) => exById[e.exercise_id])
      .filter((ex): ex is Exercise => !!ex)
      .map((ex) => exerciseName(ex, lang))
    return {
      title: dayTitle(day, lang),
      exercises: exerciseNames.length ? exerciseNames : [...new Set(loggedNames)].slice(0, 6),
      lastDate: loggedEntries[0]?.date ?? null,
    }
  }

  function bodyActivityFor(c: TrainingCycle, rv: ReturnType<typeof currentRound>): Record<string, RegionView> {
    const out: Record<string, RegionView> = {}
    if (!rv.open) return out
    const open = (roundsByCycle[c.id] ?? []).find((r) => r.ended_on == null && r.index === rv.index)
    if (!open) return out
    // Real loop brightness: sets actually logged this round, routed through each
    // day's region bindings. Per region we keep a per-exercise breakdown so the
    // hover box shows what drove the glow (brighter = more sets).
    const dayRegions = new Map(c.days.map((d) => [d.label, (d.regions ?? []) as RegionId[]]))
    const perRegion = new Map<RegionId, Map<string, { name: string; sets: number; day: string; date: string | null }>>()
    // Iterate M2M memberships (assignment rows, with legacy-column fallback) so an
    // entry shared across splits lights each split's regions.
    for (const m of cycleMemberships(c, entries, assignments)) {
      const inRound = m.roundId ? m.roundId === open.id : m.date >= open.started_on && (!open.ended_on || m.date <= open.ended_on)
      if (!inRound) continue
      const regions = dayRegions.get(m.dayLabel) as RegionId[] | undefined
      if (!regions || regions.length === 0) continue
      const n = setCounts[m.entryId] ?? 0
      if (n <= 0) continue
      const ex = exById[m.exId]
      const name = ex ? exerciseName(ex, lang) : '?'
      for (const region of regions) {
        const byEx = perRegion.get(region) ?? new Map()
        const k = `${m.dayLabel}:${m.exId}`
        const cur = byEx.get(k) ?? { name, sets: 0, day: m.dayLabel, date: null as string | null }
        cur.sets += n
        if (!cur.date || m.date > cur.date) cur.date = m.date
        byEx.set(k, cur)
        perRegion.set(region, byEx)
      }
    }
    for (const [region, byEx] of perRegion) {
      const items = [...byEx.values()].sort((a, b) => b.sets - a.sets)
      out[region] = { sets: items.reduce((s, it) => s + it.sets, 0), items }
    }
    if (showIntimacy) {
      const open = (roundsByCycle[c.id] ?? []).find((r) => r.ended_on == null && r.index === rv.index)
      const rows = open ? intimacyRows.filter((r) => r.date >= open.started_on) : []
      const sets = rows.reduce((sum, r) => sum + r.count, 0)
      if (sets > 0) {
        const byCat = new Map<string, { name: string; sets: number; date: string | null }>()
        for (const row of rows) {
          const cat = intimacyCategory(row)
          const cur = byCat.get(cat) ?? { name: intimacyLabel(cat, lang, true), sets: 0, date: null }
          cur.sets += row.count
          if (!cur.date || row.date > cur.date) cur.date = row.date
          byCat.set(cat, cur)
        }
        out.genitals = {
          sets,
          items: [...byCat.values()].map((it) => ({ name: it.name, sets: it.sets, day: null, date: it.date })),
        }
      }
    }
    return out
  }

  const mainCycle = active ?? cycles[0] ?? null
  const sideCycles = mainCycle ? cycles.filter((c) => c.id !== mainCycle.id) : []

  useEffect(() => {
    void reload()
  }, [reload])

  const recovery = useMemo(() => muscleRecovery(entries, exById), [entries, exById])
  // Days since last session per sport the user does (§6B) — shown next to muscles.
  const sportRecovery = useMemo(() => {
    return sports.map((s) => {
      const last = sportSessions
        .filter((ss) => ss.sport_id === s.id)
        .reduce<string | null>((m, ss) => (!m || ss.date > m ? ss.date : m), null)
      return { id: s.id, name: sportName(s, lang), daysAgo: last ? daysSince(last) : null }
    })
  }, [sports, sportSessions, lang])

  async function addCycle(input: NewCycleForm) {
    const { undo } = await withUndo(['training_cycle'], () => createCycle({ ...input, active: cycles.length === 0 }))
    setDialog(null)
    await reload()
    push(lang === 'zh' ? `已新建循环「${input.name}」` : `Added cycle “${input.name}”`, async () => { await undo(); await reload() })
  }

  async function saveCycle(c: TrainingCycle, input: NewCycleForm) {
    const { undo } = await withUndo(['training_cycle'], () => updateCycle(c.id, input))
    setDialog(null)
    await reload()
    push(lang === 'zh' ? `已保存循环「${input.name}」` : `Saved cycle “${input.name}”`, async () => { await undo(); await reload() })
  }

  async function deleteCycle(c: TrainingCycle) {
    const { undo } = await withUndo(['training_cycle'], () => softDeleteCycle(c.id))
    await reload()
    push(lang === 'zh' ? `已删除循环「${c.name}」` : `Deleted cycle “${c.name}”`, async () => { await undo(); await reload() })
  }

  async function activateCycle(c: TrainingCycle) {
    const { undo } = await withUndo(['training_cycle'], () => setActiveCycle(c.id))
    await reload()
    push(lang === 'zh' ? `已启用循环「${c.name}」` : `Activated “${c.name}”`, async () => { await undo(); await reload() })
  }

  async function addDefaultSplit() {
    const { undo } = await withUndo(['training_cycle'], () => createDefaultSplitCycle())
    await reload()
    push(lang === 'zh' ? '已创建四分化循环' : 'Added 4-split cycle', async () => { await undo(); await reload() })
  }

  async function skipRoundFor(c: TrainingCycle, rv: ReturnType<typeof currentRound>) {
    if (!rv.open) return
    const msg = lang === 'zh'
      ? `结束「${c.name}」第 ${rv.index} 轮?未完成的 ${rv.remaining.join('/') || '—'} 会被跳过。`
      : `End ${c.name} round ${rv.index}? Unfinished days (${rv.remaining.join('/') || '—'}) will be skipped.`
    if (!confirm(msg)) return
    const idx = rv.index
    const { result: ok, undo } = await withUndo(['cycle_rounds'], () => skipCycleRound(c.id))
    await reload()
    if (!ok) return
    push(lang === 'zh' ? `已结束「${c.name}」第 ${idx} 轮` : `Ended ${c.name} round ${idx}`, async () => { await undo(); await reload() })
  }

  async function reopenRound(id: string) {
    await reopenCycleRound(id)
    await reload()
  }
  async function deleteRound(id: string) {
    if (!confirm(lang === 'zh' ? '删除这一轮的记录?(不影响训练记录本身)' : 'Delete this round record? (your workouts are untouched)')) return
    await deleteCycleRound(id)
    await reload()
  }

  return (
    <div className="cyc-screen">
      {mainCycle && (
        <section className={`cyc-loop-board ${sideCycles.length ? 'has-side' : ''}`}>
          <CycleVisualCard
            cycle={mainCycle}
            round={currentRound(mainCycle, roundsByCycle[mainCycle.id] ?? [], entries, assignments)}
            activity={bodyActivityFor(mainCycle, currentRound(mainCycle, roundsByCycle[mainCycle.id] ?? [], entries, assignments))}
            getDaySummary={daySummary}
            lang={lang}
            adult={showIntimacy}
            primary
            onSkip={(c, rv) => void skipRoundFor(c, rv)}
            onEdit={(c) => setDialog({ mode: 'edit', cycle: c })}
          />
          {sideCycles.length > 0 && (
            <div className="cyc-loop-side">
              {sideCycles.map((c) => {
                const rv = currentRound(c, roundsByCycle[c.id] ?? [], entries, assignments)
                return (
                  <CycleVisualCard
                    key={c.id}
                    cycle={c}
                    round={rv}
                    activity={bodyActivityFor(c, rv)}
                    getDaySummary={daySummary}
                    lang={lang}
                    adult={showIntimacy}
                    onHoverChange={(hovered) => setHoveredSideCycleId(hovered ? c.id : null)}
                    onSkip={(cyc, r) => void skipRoundFor(cyc, r)}
                    onEdit={(c) => setDialog({ mode: 'edit', cycle: c })}
                  />
                )
              })}
            </div>
          )}
        </section>
      )}

      {cycles.length > 0 && (
        <CyclePlanMatrix
          cycles={cycles}
          roundsByCycle={roundsByCycle}
          entries={entries}
          assignments={assignments}
          getDaySummary={daySummary}
          sideCycleId={hoveredSideCycleId}
          lang={lang}
        />
      )}

      {active && rounds.length > 0 && (
        <section className="cyc-rounds-hist">
          <span className="th-label">{lang === 'zh' ? '轮次历史' : 'Round history'}</span>
          <ul className="cyc-rounds-list">
            {[...rounds].reverse().map((r) => {
              const done = liveCompletedLabels(active, r, entries, assignments)
              const allDone = done.length === active.days.length
              const span = roundLiveSpan(active, r, entries, assignments)
              return (
                <li key={r.id} className="cyc-round-row">
                  <span className="cyc-round-row-idx">R{r.index}</span>
                  <span className="cyc-round-row-dates">{span.first ?? r.started_on} → {r.ended_on == null ? '…' : (span.last ?? r.ended_on)}</span>
                  <span className="cyc-round-row-days">{done.join('') || '—'}</span>
                  {r.skipped ? <span className="cyc-round-badge skip">{lang === 'zh' ? '跳过' : 'skipped'}</span>
                    : allDone ? <span className="cyc-round-badge done">{lang === 'zh' ? '完成' : 'done'}</span>
                    : !r.ended_on ? <span className="cyc-round-badge open">{lang === 'zh' ? '进行中' : 'open'}</span>
                    : null}
                  <span className="cyc-round-actions">
                    {r.ended_on && (
                      <button type="button" title={lang === 'zh' ? '重开这一轮(撤销跳过/结束)' : 'Reopen (undo skip/close)'} onClick={() => void reopenRound(r.id)}>↩</button>
                    )}
                    <button type="button" title={lang === 'zh' ? '删除这一轮' : 'Delete round'} onClick={() => void deleteRound(r.id)}>🗑</button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="cyc-recovery">
        <span className="th-label">{lang === 'zh' ? '各肌群距上次训练' : 'Days since last trained'}</span>
        <div className="cyc-rec-grid">
          {recovery.map((r) => (
            <div key={r.bodyPart} className={`cyc-rec ${r.daysAgo != null && r.daysAgo >= 7 ? 'overdue' : ''}`}>
              <span className="cyc-rec-bp">{categoryLabel(r.bodyPart, lang)}</span>
              <span className="cyc-rec-days">{r.daysAgo == null ? '—' : `${r.daysAgo}d`}</span>
            </div>
          ))}
          {sportRecovery.map((s) => (
            <div key={s.id} className={`cyc-rec sport ${s.daysAgo != null && s.daysAgo >= 7 ? 'overdue' : ''}`}>
              <span className="cyc-rec-bp">🏃 {s.name}</span>
              <span className="cyc-rec-days">{s.daysAgo == null ? '—' : `${s.daysAgo}d`}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cyc-categories">
        <span className="th-label">{lang === 'zh' ? '分类(部位)' : 'Categories'}</span>
        <CategoryManager lang={lang} />
      </section>

      <section className="cyc-library">
        <button className="cyc-lib-toggle" type="button" onClick={() => setShowLibrary((v) => !v)}>
          {lang === 'zh' ? '动作库(增删改查)' : 'Exercise library (manage)'} {showLibrary ? '▲' : '▼'}
        </button>
        {showLibrary && <ExerciseManager lang={lang} onChanged={reload} />}
      </section>

      <section className="cyc-cycles">
        <button className="th-btn cyc-add-btn" type="button" onClick={() => setDialog({ mode: 'create' })}>
          {lang === 'zh' ? '+ 新建分化框架' : '+ New split framework'}
        </button>
        <button className="th-btn-ghost cyc-tmpl-btn" type="button" onClick={() => void addDefaultSplit()}>
          {lang === 'zh' ? '+ 四分化模板 (A胸腹/B背二头/C腿腹/D肩三头)' : '+ 4-split template (A/B/C/D)'}
        </button>

        {cycles.map((c) => (
          <div key={c.id} className="cyc-card">
            <div className="cyc-card-head">
              <span className="cyc-name">{c.name}</span>
              <span className="cyc-mode-badge">{c.display_mode === 'body' ? (lang === 'zh' ? '身体图' : 'Body') : (lang === 'zh' ? '圆环' : 'Circle')}</span>
              {c.active ? (
                <span className="cyc-active-badge">{lang === 'zh' ? '主分化' : 'active'}</span>
              ) : (
                <button className="hist-link" type="button" onClick={() => void activateCycle(c)}>{lang === 'zh' ? '设为主分化' : 'set active'}</button>
              )}
              <div className="cyc-card-actions">
                <button className="hist-link" type="button" onClick={() => setDialog({ mode: 'edit', cycle: c })}>{lang === 'zh' ? '编辑' : 'edit'}</button>
                <button className="hist-link danger" type="button" onClick={() => void deleteCycle(c)}>{lang === 'zh' ? '删除' : 'delete'}</button>
              </div>
            </div>
            <div className="cyc-days">
              {c.days.length === 0 ? (
                <span className="cyc-empty">{lang === 'zh' ? '还没有训练日 - 点编辑添加。' : 'No days - edit to add them.'}</span>
              ) : (
                c.days.map((d) => (
                  <span key={d.label} className="cyc-day">
                    <strong>{d.label}</strong> {cycleDayTitle(d, lang)}
                    {c.display_mode === 'body' && d.regions?.length ? <em>{d.regions.map((r) => regionLabel(r as RegionId, lang)).join('/')}</em> : null}
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </section>

      {dialog && (
        <CycleDialog
          mode={dialog.mode}
          cycle={dialog.cycle}
          lang={lang}
          exercises={exercises}
          onSave={(input) => dialog.mode === 'create' ? void addCycle(input) : dialog.cycle ? void saveCycle(dialog.cycle, input) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

interface NewCycleForm {
  name: string
  days: CycleDay[]
  display_mode: TrainingCycle['display_mode']
}

interface CycleDaySummary {
  title: string
  exercises: string[]
  lastDate: string | null
}

function shortDate(date: string | null): string {
  return date ? date.slice(5) : '—'
}

function dayTitle(day: CycleDay, lang: 'en' | 'zh'): string {
  return cycleDayTitle(day, lang)
}

function CyclePlanMatrix({
  cycles,
  roundsByCycle,
  entries,
  assignments,
  getDaySummary,
  sideCycleId,
  lang,
}: {
  cycles: TrainingCycle[]
  roundsByCycle: Record<string, CycleRound[]>
  entries: WorkoutEntry[]
  assignments: EntryCycleAssignment[]
  getDaySummary: (cycle: TrainingCycle, day: CycleDay) => CycleDaySummary
  sideCycleId: string | null
  lang: 'en' | 'zh'
}) {
  const main = cycles.find((c) => c.active) ?? cycles[0]
  const side = cycles.find((c) => c.id === sideCycleId && c.id !== main.id) ?? null
  return (
    <section className="cyc-plan">
      <div className="cyc-plan-head">
        <span className="th-label">{lang === 'zh' ? '分化框架' : 'Split frameworks'}</span>
      </div>
      <div className={`cyc-plan-grid ${side ? 'has-side-detail' : ''}`}>
        <PlanCycleCard
          cycle={main}
          round={currentRound(main, roundsByCycle[main.id] ?? [], entries, assignments)}
          getDaySummary={getDaySummary}
          lang={lang}
          primary
        />
        {side && (
          <aside className="cyc-plan-side">
            <PlanCycleCard
              cycle={side}
              round={currentRound(side, roundsByCycle[side.id] ?? [], entries, assignments)}
              getDaySummary={getDaySummary}
              lang={lang}
            />
          </aside>
        )}
      </div>
    </section>
  )
}

function PlanCycleCard({
  cycle,
  round,
  getDaySummary,
  lang,
  primary = false,
}: {
  cycle: TrainingCycle
  round: ReturnType<typeof currentRound>
  getDaySummary: (cycle: TrainingCycle, day: CycleDay) => CycleDaySummary
  lang: 'en' | 'zh'
  primary?: boolean
}) {
  const done = new Set(round.completed)
  const [hovered, setHovered] = useState<CycleDay | null>(null)
  const hoverSummary = hovered ? getDaySummary(cycle, hovered) : null
  return (
    <article className={`cyc-plan-card ${cycle.active ? 'active' : ''} ${primary ? 'primary' : 'side'}`}>
      <div className="cyc-plan-title">
        <strong>{cycle.name}</strong>
        <span>{cycle.active ? (lang === 'zh' ? '主分化' : 'main') : (lang === 'zh' ? '专项' : 'side')}</span>
      </div>
      <div className="cyc-plan-table">
        {cycle.days.map((day) => {
          const summary = getDaySummary(cycle, day)
          const isDone = done.has(day.label)
          return (
            <div
              key={day.label}
              className={`cyc-plan-row ${isDone ? 'done' : ''}`}
              onMouseEnter={() => setHovered(day)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="cyc-plan-label">{day.label}</span>
              <span className="cyc-plan-main">
                <strong>{summary.title}</strong>
                {primary && <em>{summary.exercises.length ? summary.exercises.join(' · ') : (lang === 'zh' ? '未绑定动作' : 'No exercises linked')}</em>}
              </span>
              <span className="cyc-plan-state">{isDone ? (lang === 'zh' ? '已做' : 'done') : '—'}</span>
              <time className="cyc-plan-date">{shortDate(summary.lastDate)}</time>
            </div>
          )
        })}
      </div>
      {!primary && hovered && hoverSummary && (
        <div className="cyc-plan-hover">
          <strong>{hovered.label} · {hoverSummary.title}</strong>
          <span>{lang === 'zh' ? '时间' : 'time'}: {shortDate(hoverSummary.lastDate)}</span>
          <em>{hoverSummary.exercises.length ? hoverSummary.exercises.join(' · ') : (lang === 'zh' ? '未绑定动作' : 'No exercises linked')}</em>
        </div>
      )}
    </article>
  )
}

function CycleVisualCard({
  cycle,
  round,
  activity,
  getDaySummary,
  lang,
  adult = false,
  primary = false,
  onHoverChange,
  onSkip,
  onEdit,
}: {
  cycle: TrainingCycle
  round: ReturnType<typeof currentRound>
  activity: Record<string, RegionView>
  getDaySummary: (cycle: TrainingCycle, day: CycleDay) => CycleDaySummary
  lang: 'en' | 'zh'
  adult?: boolean
  primary?: boolean
  onHoverChange?: (hovered: boolean) => void
  onSkip?: (cycle: TrainingCycle, round: ReturnType<typeof currentRound>) => void
  onEdit?: (cycle: TrainingCycle) => void
}) {
  const mode = cycle.display_mode ?? 'circle'
  return (
    <div
      className={`cyc-visual ${primary ? 'primary' : 'secondary'} ${mode}`}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div className="cyc-visual-head">
        <div>
          <span className="th-label">{primary ? (lang === 'zh' ? '主分化' : 'Main split') : (lang === 'zh' ? '专项 loop' : 'Side loop')}</span>
          <h3>{cycle.name}</h3>
        </div>
        <span className="cyc-visual-round">R{round.index}</span>
      </div>
      <div className="cyc-visual-body">
        {mode === 'body' ? (
          <BodyModel activity={activity} lang={lang} adult={adult} compact={!primary} />
        ) : (
          <CircleLoop cycle={cycle} round={round} getDaySummary={getDaySummary} lang={lang} compact={!primary} />
        )}
      </div>
      <div className="cyc-visual-foot">
        <span>{round.open ? (lang === 'zh' ? '进行中' : 'open') : (lang === 'zh' ? '待开始' : 'pending')}</span>
        <span>{lang === 'zh' ? '剩余' : 'remaining'} {round.remaining.join('/') || '—'}</span>
        {onEdit && (
          <button className="hist-link cyc-visual-edit" type="button" onClick={() => onEdit(cycle)}>
            {lang === 'zh' ? '编辑框架' : 'Edit'}
          </button>
        )}
        {round.open && onSkip && (
          <button className="hist-link danger cyc-visual-skip" type="button" onClick={() => onSkip(cycle, round)}>
            {lang === 'zh' ? '跳过本轮' : 'Skip round'}
          </button>
        )}
      </div>
    </div>
  )
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg - 90) * Math.PI / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function slicePath(i: number, n: number): string {
  const cx = 50
  const cy = 50
  const r = 47
  const gap = n > 1 ? 1.2 : 0
  const start = (360 / n) * i + gap
  const end = (360 / n) * (i + 1) - gap
  const [x1, y1] = polar(cx, cy, r, start)
  const [x2, y2] = polar(cx, cy, r, end)
  const large = end - start > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`
}

function CircleLoop({
  cycle,
  round,
  getDaySummary,
  lang,
  compact = false,
}: {
  cycle: TrainingCycle
  round: ReturnType<typeof currentRound>
  getDaySummary: (cycle: TrainingCycle, day: CycleDay) => CycleDaySummary
  lang: 'en' | 'zh'
  compact?: boolean
}) {
  const n = Math.max(1, cycle.days.length)
  const completed = new Set(round.completed)
  const [hovered, setHovered] = useState<CycleDay | null>(null)
  const centerDay = hovered ?? cycle.days.find((d) => d.label === round.nextLabel) ?? null
  return (
    <div className={`cyc-pie ${compact ? 'compact' : ''}`}>
      <svg className="cyc-pie-svg" viewBox="0 0 100 100" role="img" aria-label={`${cycle.name} loop`}>
      {cycle.days.map((d, i) => {
        const mid = (360 / n) * (i + 0.5)
        const [lx, ly] = polar(50, 50, 31, mid)
        const done = completed.has(d.label)
        const next = round.nextLabel === d.label
        return (
          <g
            key={d.label}
            className="cyc-pie-part"
            onMouseEnter={() => setHovered(d)}
            onMouseLeave={() => setHovered(null)}
          >
            <path
              className={`cyc-pie-slice ${done ? 'done' : ''} ${next ? 'next' : ''} ${hovered?.label === d.label ? 'is-hover' : ''}`}
              d={slicePath(i, n)}
            >
              <title>{`${d.label} · ${cycleDayTitle(d, lang)}`}</title>
            </path>
            <text
              className={`cyc-pie-label ${done ? 'done' : ''}`}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {d.label}
            </text>
          </g>
        )
      })}
        <circle className="cyc-pie-hole" cx="50" cy="50" r="18" />
        <text className="cyc-pie-center" x="50" y="45" textAnchor="middle" dominantBaseline="central">{centerDay?.label ?? `R${round.index}`}</text>
        {!compact && <text className="cyc-pie-caption" x="50" y="58" textAnchor="middle" dominantBaseline="central">{centerDay ? dayTitle(centerDay, lang) : (lang === 'zh' ? '循环' : 'loop')}</text>}
      </svg>
      {hovered && (
        <div className="cyc-pie-tip">
          <strong>{hovered.label} · {getDaySummary(cycle, hovered).title}</strong>
          <span>{completed.has(hovered.label) ? (lang === 'zh' ? '本轮已完成' : 'done this round') : (lang === 'zh' ? '本轮未完成' : 'not done this round')}</span>
          <span>{lang === 'zh' ? '时间' : 'time'}: {shortDate(getDaySummary(cycle, hovered).lastDate)}</span>
          <em>{getDaySummary(cycle, hovered).exercises.length ? getDaySummary(cycle, hovered).exercises.join(' · ') : (lang === 'zh' ? '未绑定动作' : 'No exercises linked')}</em>
        </div>
      )}
    </div>
  )
}

const SPLIT_COUNTS = [2, 3, 4, 5, 6, 7]

function labelForIndex(i: number): string {
  return String.fromCharCode(65 + i)
}

function templateDays(count: number): CycleDay[] {
  if (count === 4) {
    return [
      { label: 'A', title: '', body_parts: ['chest', 'core'], regions: ['chest', 'abs'], exercise_ids: [] },
      { label: 'B', title: '', body_parts: ['back', 'biceps'], regions: ['back', 'biceps', 'forearms'], exercise_ids: [] },
      { label: 'C', title: '', body_parts: ['legs', 'core'], regions: ['glutes', 'quads', 'hamstrings', 'calves', 'adductors', 'abs'], exercise_ids: [] },
      { label: 'D', title: '', body_parts: ['shoulders', 'triceps'], regions: ['shoulders', 'triceps'], exercise_ids: [] },
    ]
  }
  return Array.from({ length: count }, (_, i) => ({ label: labelForIndex(i), title: '', body_parts: [], regions: [], exercise_ids: [] }))
}

function CycleDialog({
  mode,
  cycle,
  lang,
  exercises,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit'
  cycle?: TrainingCycle
  lang: 'en' | 'zh'
  exercises: Exercise[]
  onSave: (input: NewCycleForm) => void
  onClose: () => void
}) {
  const cats = useCategories()
  const initialCount = cycle?.days.length || 4
  const [splitCount, setSplitCount] = useState(initialCount)
  const [name, setName] = useState(cycle?.name ?? `${initialCount}-Split`)
  const [displayMode, setDisplayMode] = useState<TrainingCycle['display_mode']>(cycle?.display_mode ?? 'body')
  const [days, setDays] = useState<CycleDay[]>(
    cycle?.days.map((d) => ({
      ...d,
      title_zh: d.title_zh ?? '',
      title_en: d.title_en ?? '',
      body_parts: [...d.body_parts],
      regions: [...(d.regions ?? [])],
      exercise_ids: [...(d.exercise_ids ?? [])],
    })) ?? templateDays(initialCount),
  )

  function applySplitCount(n: number) {
    setSplitCount(n)
    setName((cur) => (mode === 'create' && /^(\d+)-Split$/.test(cur) ? `${n}-Split` : cur))
    setDays((cur) => {
      if (mode === 'create') return templateDays(n)
      if (n > cur.length) return [...cur, ...Array.from({ length: n - cur.length }, (_, i) => ({ label: labelForIndex(cur.length + i), title: '', body_parts: [], regions: [], exercise_ids: [] }))]
      return cur.slice(0, n)
    })
  }
  function setDay(i: number, patch: Partial<CycleDay>) {
    setDays((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }
  function toggleBp(i: number, bp: BodyPart) {
    setDays((ds) =>
      ds.map((d, idx) =>
        idx === i
          ? { ...d, body_parts: d.body_parts.includes(bp) ? d.body_parts.filter((x) => x !== bp) : [...d.body_parts, bp] }
          : d,
      ),
    )
  }
  function toggleRegion(i: number, r: RegionId) {
    setDays((ds) =>
      ds.map((d, idx) => {
        if (idx !== i) return d
        const cur = (d.regions ?? []) as RegionId[]
        return { ...d, regions: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] }
      }),
    )
  }
  function toggleEx(i: number, exId: string) {
    setDays((ds) =>
      ds.map((d, idx) => {
        if (idx !== i) return d
        const cur = d.exercise_ids ?? []
        return { ...d, exercise_ids: cur.includes(exId) ? cur.filter((x) => x !== exId) : [...cur, exId] }
      }),
    )
  }
  function addDay() {
    const label = String.fromCharCode(65 + days.length) // A, B, C…
    setDays((ds) => [...ds, { label, title: '', body_parts: [], exercise_ids: [] }])
    setSplitCount((n) => n + 1)
  }

  const exName = (e: Exercise) => (lang === 'zh' ? e.name_zh : e.name_en) || e.name_zh || e.name_en

  function save() {
    if (!name.trim() || days.length === 0) return
    onSave({
      name: name.trim(),
      display_mode: displayMode ?? 'circle',
      days: days.map((d) => ({ ...d, title: d.title_zh || d.title_en || d.title || '' })),
    })
  }

  return (
    <div className="cyc-dialog-backdrop" onClick={onClose}>
      <div className="cyc-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cyc-dialog-head">
          <h3>{mode === 'create' ? (lang === 'zh' ? '新建分化框架' : 'New split framework') : (lang === 'zh' ? '编辑分化框架' : 'Edit split framework')}</h3>
          <button className="cyc-dialog-x" type="button" onClick={onClose} aria-label="close">×</button>
        </div>
        <input className="th-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={lang === 'zh' ? '框架名称' : 'Framework name'} />
        <div className="cyc-dialog-controls">
          <div className="cyc-seg">
            {SPLIT_COUNTS.map((n) => (
              <button key={n} type="button" className={splitCount === n ? 'on' : ''} onClick={() => applySplitCount(n)}>
                {Array.from({ length: n }, (_, i) => labelForIndex(i)).join('')}
              </button>
            ))}
          </div>
          <div className="cyc-seg">
            <button type="button" className={displayMode === 'body' ? 'on' : ''} onClick={() => setDisplayMode('body')}>{lang === 'zh' ? '身体图' : 'Body'}</button>
            <button type="button" className={displayMode === 'circle' ? 'on' : ''} onClick={() => setDisplayMode('circle')}>{lang === 'zh' ? '圆环' : 'Circle'}</button>
          </div>
        </div>
        <div className="cyc-editor">
          {days.map((d, i) => {
            const dayExercises = exercises.filter((e) => !e.is_warmup && !e.is_rehab && e.body_parts.some((bp) => d.body_parts.includes(bp)))
            const warmups = exercises.filter((e) => e.is_warmup)
            return (
              <div key={i} className="cyc-edit-day">
                <div className="cyc-edit-row">
                  <input className="th-input cyc-label" value={d.label} onChange={(e) => setDay(i, { label: e.target.value })} placeholder="A" />
                  <input className="th-input" value={d.title_zh ?? ''} onChange={(e) => setDay(i, { title_zh: e.target.value })} placeholder="中文标题, 如 胸 + 核心" />
                  <input className="th-input" value={d.title_en ?? ''} onChange={(e) => setDay(i, { title_en: e.target.value })} placeholder="English title, e.g. Chest + Core" />
                  <button className="cyc-del" type="button" onClick={() => { setDays((ds) => ds.filter((_, idx) => idx !== i)); setSplitCount((n) => Math.max(0, n - 1)) }}>×</button>
                </div>
                <div className="cyc-bp-row">
                  {cats.map((c) => (
                    <button key={c.key} type="button" className={`cyc-bp ${d.body_parts.includes(c.key) ? 'on' : ''}`} onClick={() => toggleBp(i, c.key)}>
                      {categoryLabel(c.key, lang)}
                    </button>
                  ))}
                </div>
                {displayMode === 'body' && (
                  <div className="cyc-region-row">
                    <span className="cyc-ex-hint">{lang === 'zh' ? '身体区域:' : 'Body regions:'}</span>
                    {REGIONS.map((r) => (
                      <button key={r.id} type="button" className={`cyc-region ${(d.regions ?? []).includes(r.id) ? 'on' : ''}`} onClick={() => toggleRegion(i, r.id)}>
                        {regionLabel(r.id, lang)}
                      </button>
                    ))}
                  </div>
                )}
                {warmups.length > 0 && (
                  <div className="cyc-ex-pick">
                    <span className="cyc-ex-hint">{lang === 'zh' ? '热身:' : 'Warm-up:'}</span>
                    {warmups.map((e) => (
                      <button key={e.id} type="button" className={`cyc-ex ${(d.exercise_ids ?? []).includes(e.id) ? 'on' : ''}`} onClick={() => toggleEx(i, e.id)}>
                        {exName(e)}
                      </button>
                    ))}
                  </div>
                )}
                {d.body_parts.length > 0 && (
                  <div className="cyc-ex-pick">
                    <span className="cyc-ex-hint">{lang === 'zh' ? '绑定动作:' : 'Linked exercises:'}</span>
                    {dayExercises.length === 0 ? (
                      <span className="cyc-empty">{lang === 'zh' ? '该部位还没动作(去 Log 加)' : 'no exercises for these parts yet'}</span>
                    ) : (
                      dayExercises.map((e) => (
                        <button key={e.id} type="button" className={`cyc-ex ${(d.exercise_ids ?? []).includes(e.id) ? 'on' : ''}`} onClick={() => toggleEx(i, e.id)}>
                          {exName(e)}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <button className="th-btn-ghost cyc-add-day" type="button" onClick={addDay}>{lang === 'zh' ? '+ 训练日' : '+ Day'}</button>
          <div className="cyc-editor-actions">
            <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
            <button className="th-btn" type="button" onClick={save} disabled={!name.trim() || days.length === 0}>{lang === 'zh' ? '保存' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
