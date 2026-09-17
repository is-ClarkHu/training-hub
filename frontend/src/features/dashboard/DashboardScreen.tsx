// Dashboard (SPEC §8) — replicates the legacy workout_dashboard.html coverage:
// KPI strip, intensity heatmap (signature), per-body-part progression, weekly
// volume, bodyweight trend, distributions, and per-sport charts. Fully bilingual.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart,
  ArcElement,
  BarElement,
  PointElement,
  LineElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { getActiveCycle, getCycleRounds, getEntryCycleAssignments, getEntries, getExercises, getSetsByEntryIds, getSportSessions, getInjuries, getSports, getTrackerEntries, reconcileCycleRounds } from '../../db'
import { useLanguage } from '../../i18n'
import {
  type Exercise,
  type ExerciseSet,
  type Injury,
  type OptionalTracker,
  type Sport,
  type SportSession,
  type WorkoutEntry,
} from '../../supabase/types'
import { getCategories, categoryLabel } from '../../categories'
import { roundMetrics, roundRegionActivity } from '../cycle/rounds'
import { BodyModel, type RegionView } from '../cycle/BodyModel'
import { RoundRings, type RingChain } from './RoundRings'
import type { CycleRound, EntryCycleAssignment, TrainingCycle } from '../../supabase/types'
import { ActiveInjuryBanner, bodyAreaLabel } from '../injuries'
import { INJURY_STATUS_LABELS, daysBetween, daysSince } from '../injuries/util'
import { SportCharts, sportName } from '../sports'
import { ACTIVITY_LABEL, exerciseKind, exerciseName, sortExercises } from '../log/util'
import {
  INTIMACY_CATEGORIES,
  INTIMACY_COLORS,
  intimacyCategory,
  intimacyLabel,
  intimacyVisible,
} from '../intimacy'
import {
  activityByMonth,
  bodyPartCounts,
  bodyweightVolume,
  intensityCalendar,
  yearGrid,
  yearsOf,
  muscleRecovery,
  totalBodyweightReps,
  weeklyEntryVolume,
  type ActivityKey,
  type CalendarMonth,
  type DayCell,
} from './stats'
import './dashboard.css'

Chart.register(ArcElement, BarElement, PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#8b93a3'
Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace"
Chart.defaults.font.size = 11
Chart.defaults.maintainAspectRatio = false
const GRID = 'rgba(120, 130, 150, 0.15)'
const TINTS = ['#8ab4f8', '#4fd1e0', '#7dd3a0', '#a78bfa', '#ff8a5c', '#f5b544', '#f472b6']
// Sequential blue ramp for "by month" stacks — light = oldest, dark = most recent, so
// the segments read as time (not a rainbow). Sliced to the number of months shown.
const MONTH_RAMP = ['#dbe7fb', '#b3ccf6', '#8ab0f1', '#6295ec', '#3b78dd', '#265fbf']
// Calendar squares carry tag text, so intensity can't own the whole background:
// the fill is a neutral ramp (readable under text, and theme-agnostic via --text)
// and the saturated single-hue ramp goes on the dot beside the date. Two channels
// — fill lightness AND dot depth — so the scale survives colour-blindness.
// The heat ramp. It used to be near-white at 5–24% because the squares carried
// text that had to stay readable on top; now that they don't, the fill IS the
// signal and gets the accent hue and enough contrast to read at 10px in the
// overview grid — four steps that are told apart at a glance, GitHub-style.
const LEVEL_FILL = [
  'transparent',
  'color-mix(in srgb, var(--cyan) 22%, transparent)',
  'color-mix(in srgb, var(--cyan) 42%, transparent)',
  'color-mix(in srgb, var(--cyan) 66%, transparent)',
  'var(--cyan)',
]
const LEVEL_DOT = [
  'transparent',
  'color-mix(in srgb, var(--cyan) 30%, transparent)',
  'color-mix(in srgb, var(--cyan) 55%, transparent)',
  'color-mix(in srgb, var(--cyan) 80%, transparent)',
  'var(--cyan)',
]
// Intimacy heart shade deepens with the day's total count (1 → light, 4+ → deep).
const HEART_SHADES = ['#f9a8d4', '#f472b6', '#ec4899', '#db2777']
const heartColor = (count: number): string => HEART_SHADES[Math.min(count, HEART_SHADES.length) - 1]

// A round's date span for the rounds list: "07-11 → 07-18" (open round → "07-11 → …").
const md = (iso: string): string => iso.slice(5)
// Uses the round's LIVE member dates (first/last) rather than the stored started_on/
// ended_on — those are dead scalars set at close time and drift out of sync when a
// member entry is later deleted or moved, which the rings/body model already ignore.
function roundDateRange(round: CycleRound, first: string | null, last: string | null): string {
  const start = md(first ?? round.started_on)
  if (round.ended_on == null) return `${start} → …`
  return `${start} → ${md(last ?? round.ended_on)}`
}

interface DayDetail {
  lifts: { name: string; sets: number }[]
  sports: { name: string; hours: number; level?: string }[]
  intimacy: string
}

export function DashboardScreen() {
  const { lang } = useLanguage()
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [setMap, setSetMap] = useState<Record<string, ExerciseSet[]>>({})
  const [exById, setExById] = useState<Record<string, Exercise>>({})
  const [sessions, setSessions] = useState<SportSession[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [intimacyRows, setIntimacyRows] = useState<OptionalTracker[]>([])
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [progCategory, setProgCategory] = useState('')
  const [progShowGym, setProgShowGym] = useState(true)
  const [progShowBodyweight, setProgShowBodyweight] = useState(true)
  const [calStrength, setCalStrength] = useState(true)
  const [calSport, setCalSport] = useState(true)
  const [actShowCount, setActShowCount] = useState(true)
  const [actShowVolume, setActShowVolume] = useState(true)
  const [sportId, setSportId] = useState('')
  const [activeCycle, setActiveCycle] = useState<TrainingCycle | null>(null)
  const [cycleRounds, setCycleRounds] = useState<CycleRound[]>([])
  const [assignments, setAssignments] = useState<EntryCycleAssignment[]>([])
  const [modalRoundId, setModalRoundId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const visible = intimacyVisible()
      const [es, exs, sess, inj, sp, ir] = await Promise.all([
        getEntries(), getExercises(), getSportSessions(), getInjuries(), getSports(),
        visible ? getTrackerEntries('intimacy') : Promise.resolve([]),
      ])
      const sm = await getSetsByEntryIds(es.map((e) => e.id))
      setEntries(es)
      setSetMap(sm)
      setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
      setSessions(sess)
      setInjuries(inj)
      setSports(sp)
      setIntimacyRows(ir)
      setShowIntimacy(visible)
      setSportId((prev) => prev || sp.find((s) => s.is_default)?.id || sp[0]?.id || '')
      const cyc = await getActiveCycle()
      setActiveCycle(cyc)
      // Heal any rounds whose stored span/labels drifted from live memberships (e.g. a
      // round closed on a date that was later deleted). Change-guarded → no-op once
      // consistent, so this is safe to run on every load.
      if (cyc) await reconcileCycleRounds(cyc)
      setCycleRounds(cyc ? await getCycleRounds(cyc.id) : [])
      setAssignments(cyc ? await getEntryCycleAssignments() : [])
    })()
  }, [])

  const allSets = useMemo(() => Object.values(setMap).flat(), [setMap])

  const setCount = useMemo(() => (id: string) => (setMap[id] ?? []).filter((s) => s.set_type !== 'warmup').length, [setMap])

  // Split-agnostic ring data per round (newest first). Works for any split / rehab.
  const roundData = useMemo(() => {
    if (!activeCycle || cycleRounds.length === 0) return null
    const volumeGoal = Math.max(20, activeCycle.days.length * 12)
    const list = [...cycleRounds]
      .sort((a, b) => b.index - a.index)
      .map((round) => {
        const m = roundMetrics(activeCycle, round, entries, setCount, assignments)
        const chains: RingChain[] = [
          { id: 'complete', label: lang === 'zh' ? '完成' : 'Done', color: '#8ab4f8', value: m.completedDays, goal: m.totalDays || 1 },
          { id: 'volume', label: lang === 'zh' ? '容量' : 'Volume', color: '#ff8a5c', value: m.sets, goal: volumeGoal },
          // Balance, not session count: sessions tracked completed-days almost 1:1
          // (you train one day label per session), so the inner ring just echoed
          // the outer one. Evenness across push/pull/legs is orthogonal to both.
          {
            id: 'balance', label: lang === 'zh' ? '均衡' : 'Balance', color: '#7dd3a0',
            value: m.balance, goal: 100, display: `${m.balance}%`,
          },
        ]
        return { round, chains, first: m.firstDate, last: m.lastDate }
      })
    return { list, current: list.find((r) => r.round.ended_on == null) ?? list[0] }
  }, [activeCycle, cycleRounds, entries, setCount, lang, assignments])

  // Body-model activity for whichever round the modal is showing.
  const modalRound = roundData?.list.find((r) => r.round.id === modalRoundId) ?? null
  const modalBody = useMemo<Record<string, RegionView>>(() => {
    if (!activeCycle || !modalRound) return {}
    const activity = roundRegionActivity(activeCycle, modalRound.round, entries, setCount, assignments)
    const body: Record<string, RegionView> = {}
    for (const [region, a] of Object.entries(activity)) {
      const byEx = new Map<string, { name: string; sets: number; day: string; date: string | null }>()
      for (const it of a.items) {
        const ex = exById[it.exId]
        const cur = byEx.get(it.exId) ?? { name: ex ? exerciseName(ex, lang) : '?', sets: 0, day: it.day, date: null as string | null }
        cur.sets += it.sets
        if (it.date && (!cur.date || it.date > cur.date)) cur.date = it.date
        byEx.set(it.exId, cur)
      }
      body[region] = { sets: a.sets, items: [...byEx.values()].sort((x, y) => y.sets - x.sets) }
    }
    // Fold intimacy into the genitals region for this round's date window — the same as
    // CycleScreen's body view, so the round modal doesn't read 0 with adult mode on.
    // Bound by the round's live span (open round → no upper bound).
    if (showIntimacy) {
      const lo = modalRound.first ?? modalRound.round.started_on
      const hi = modalRound.round.ended_on == null ? '9999-12-31' : (modalRound.last ?? modalRound.round.ended_on)
      const rows = intimacyRows.filter((r) => r.date >= lo && r.date <= hi)
      const total = rows.reduce((s, r) => s + r.count, 0)
      if (total > 0) {
        // One item per (date, category) so the hover reads as a timeline ("07-10 · 2 ·
        // 07-15 · 1"), not everything collapsed onto the latest date.
        const byKey = new Map<string, { name: string; sets: number; date: string }>()
        for (const row of rows) {
          const cat = intimacyCategory(row)
          const key = `${row.date}|${cat}`
          const cur = byKey.get(key) ?? { name: intimacyLabel(cat, lang, true), sets: 0, date: row.date }
          cur.sets += row.count
          byKey.set(key, cur)
        }
        body.genitals = {
          sets: total,
          items: [...byKey.values()]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map((it) => ({ name: it.name, sets: it.sets, day: null, date: it.date })),
        }
      }
    }
    return body
  }, [activeCycle, modalRound, entries, setCount, exById, lang, assignments, showIntimacy, intimacyRows])
  const recovery = useMemo(() => muscleRecovery(entries, exById), [entries, exById])
  // Days since each sport was last done — appended to the muscle-recovery grid so the
  // dashboard mirrors the Cycle panel. Maps over `sports`, so a newly added sport shows
  // up automatically.
  const sportRecovery = useMemo(
    () =>
      sports.map((s) => {
        const last = sessions
          .filter((ss) => ss.sport_id === s.id)
          .reduce<string | null>((m, ss) => (!m || ss.date > m ? ss.date : m), null)
        return { id: s.id, name: sportName(s, lang), daysAgo: last ? daysSince(last) : null }
      }),
    [sports, sessions, lang],
  )
  const bpCounts = useMemo(() => bodyPartCounts(entries, exById), [entries, exById])
  // Body-part distribution with biceps/triceps FOLDED into 手臂/Arms (they're subsets of
  // it, so a separate slice each just double-reads the same arm work).
  const bpDist = useMemo(() => {
    const cats = getCategories()
    const idxOf = (k: string) => cats.findIndex((c) => c.key === k)
    const extra = [idxOf('biceps'), idxOf('triceps')].reduce((s, i) => s + (i >= 0 ? bpCounts[i] : 0), 0)
    const labels: string[] = []
    const data: number[] = []
    cats.forEach((c, i) => {
      if (c.key === 'biceps' || c.key === 'triceps') return
      labels.push(categoryLabel(c.key, lang))
      data.push(c.key === 'arms' ? bpCounts[i] + extra : bpCounts[i])
    })
    return { labels, data }
  }, [bpCounts, lang])
  // Per-activity monthly count + volume for the activity bar chart.
  const activityMonthly = useMemo(
    () => activityByMonth(entries, sessions, exById, setCount, 6),
    [entries, sessions, exById, setCount],
  )
  // Horizontal chart: 3 activities on the y-axis, each with a "count" bar and a
  // "volume" bar (separate stack ids → side by side), every bar stacked by month via
  // the blue ramp. Replaces the old kind pie — same categories, far more detail.
  const activityBars = useMemo(() => {
    const { months, count, volume } = activityMonthly
    const n = months.length
    const shadeAt = (i: number) => MONTH_RAMP[Math.max(0, MONTH_RAMP.length - n) + i] ?? MONTH_RAMP[MONTH_RAMP.length - 1]
    const mLabel = (m: string) => (lang === 'zh' ? `${Number(m.slice(5, 7))}月` : `${Number(m.slice(5, 7))}/`)
    const keys: ActivityKey[] = ['gym', 'bodyweight', 'sport']
    // `_mi` (month index) + `stack` let the tooltip pull the whole month's cross-section.
    const countSets = actShowCount
      ? months.map((m, i) => ({ label: mLabel(m), stack: 'count', _mi: i, data: keys.map((k) => count[k][i]), backgroundColor: shadeAt(i), borderWidth: 0 }))
      : []
    const volSets = actShowVolume
      ? months.map((m, i) => ({ label: mLabel(m), stack: 'volume', _mi: i, data: keys.map((k) => volume[k][i]), backgroundColor: shadeAt(i), borderWidth: 0 }))
      : []
    return { labels: keys.map((k) => ACTIVITY_LABEL[k][lang]), datasets: [...countSets, ...volSets], monthCount: n, months, count, volume, keys }
  }, [activityMonthly, lang, actShowCount, actShowVolume])
  const weekly = useMemo(() => weeklyEntryVolume(entries), [entries])
  const calendar = useMemo(
    () => intensityCalendar({
      entries, exById, setCountOf: setCount, sessions,
      intimacy: showIntimacy ? intimacyRows : [],
      include: { strength: calStrength, sport: calSport },
    }),
    [entries, exById, setCount, sessions, intimacyRows, showIntimacy, calStrength, calSport],
  )
  // Full per-day breakdown for the panel under the calendar: the squares carry the
  // body-part tags, this names the movements that produced them.
  const dayDetail = useMemo(() => {
    const out: Record<string, DayDetail> = {}
    const touch = (d: string): DayDetail => (out[d] ??= { lifts: [], sports: [], intimacy: '' })
    if (calStrength) {
      for (const e of entries) {
        const ex = exById[e.exercise_id]
        const sets = setCount(e.id)
        if (!ex || !sets) continue
        touch(e.date).lifts.push({ name: exerciseName(ex, lang), sets })
      }
    }
    if (calSport) {
      for (const s of sessions) {
        const sp = sports.find((x) => x.id === s.sport_id)
        touch(s.date).sports.push({ name: sp ? sportName(sp, lang) : 'sport', hours: s.hours, level: s.attributes?.level })
      }
    }
    // Intimacy is listed separately (not training — see the heart marker), with the
    // per-category counts for that day: e.g. "💗 插入×2 · 单人×1".
    if (showIntimacy) {
      const byDate: Record<string, Partial<Record<string, number>>> = {}
      for (const r of intimacyRows) { const c = intimacyCategory(r); (byDate[r.date] ??= {}); byDate[r.date][c] = (byDate[r.date][c] ?? 0) + r.count }
      for (const [d, cats] of Object.entries(byDate)) {
        touch(d).intimacy = INTIMACY_CATEGORIES.filter((c) => cats[c]).map((c) => `${intimacyLabel(c, lang, true)}×${cats[c]}`).join(' · ')
      }
    }
    for (const v of Object.values(out)) v.lifts.sort((a, b) => b.sets - a.sets)
    return out
  }, [entries, sessions, exById, sports, lang, showIntimacy, intimacyRows, setCount, calStrength, calSport])
  const sportLabel = useMemo(() => {
    const byId = Object.fromEntries(sports.map((s) => [s.id, sportName(s, lang)]))
    return (id: string): string => byId[id] ?? (lang === 'zh' ? '运动' : 'sport')
  }, [sports, lang])
  // dates that carry an injury signal (onset, injured session, or de-loaded lift)
  const injuryDates = useMemo(() => {
    const s = new Set<string>()
    for (const i of injuries) s.add(i.started_on)
    for (const ss of sessions) if (ss.injury) s.add(ss.date)
    for (const e of entries) if (e.injury_modified) s.add(e.date)
    return s
  }, [injuries, sessions, entries])
  const bwVol = useMemo(() => bodyweightVolume(entries, setMap, exById), [entries, setMap, exById])

  // injury / rehab overview (§6A dashboard)
  const injuryStats = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 14)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const active = injuries
      .filter((i) => i.status !== 'recovered')
      .map((i) => {
        const latest = i.assessments[i.assessments.length - 1]
        const rehabLogs = entries.filter(
          (e) => e.injury_id === i.id && !e.deleted && exById[e.exercise_id]?.is_rehab && e.date >= cutoffStr,
        ).length
        return {
          id: i.id,
          label: bodyAreaLabel(i, lang),
          status: i.status,
          days: daysSince(i.started_on),
          pain: latest ? latest.pain : null,
          plan: i.rehab_plan_exercise_ids.length,
          rehabLogs,
        }
      })
    const recovered = injuries.filter((i) => i.status === 'recovered')
    const recoveryDays = recovered
      .filter((i) => i.resolved_on)
      .map((i) => daysBetween(i.started_on, i.resolved_on!))
    const avgRecovery = recoveryDays.length
      ? Math.round(recoveryDays.reduce((a, b) => a + b, 0) / recoveryDays.length)
      : null
    return { active, recoveredCount: recovered.length, avgRecovery }
  }, [injuries, entries, exById, lang])

  const kpis = useMemo(() => {
    const gymDays = new Set(entries.map((e) => e.date)).size
    // Training days = real training only (lifts + sport sessions). Intimacy is not
    // training and no longer inflates this count — it has its own KPI + heatmap dot.
    const trainingDays = new Set([
      ...entries.map((e) => e.date),
      ...sessions.map((s) => s.date),
    ]).size
    const sportHours = sessions.reduce((sum, s) => sum + s.hours, 0)
    const active = injuries.filter((i) => i.status !== 'recovered').length
    const pushReps = totalBodyweightReps(allSets, entries, exById)
    const lvls = calendar.flatMap((m) => m.days).map((d) => d.level).filter((l): l is number => l != null && l > 0)
    const avg = lvls.length ? (lvls.reduce((a, b) => a + b, 0) / lvls.length) : 0
    const intimacyCount = showIntimacy ? intimacyRows.reduce((sum, r) => sum + r.count, 0) : 0
    return { trainingDays, gymDays, sportHours, sportSessions: sessions.length, active, pushReps, avg, intimacyCount }
  }, [entries, sessions, injuries, allSets, exById, calendar, intimacyRows, showIntimacy])

  const categories = useMemo(() => getCategories(), [])
  const progCategories = useMemo(() => {
    const used = new Set<string>()
    for (const e of entries) {
      const ex = exById[e.exercise_id]
      if (!ex || ex.is_rehab) continue
      for (const bp of ex.body_parts) used.add(bp)
    }
    return categories.filter((c) => used.has(c.key))
  }, [categories, entries, exById])
  const selectedProgCategory = progCategory || progCategories[0]?.key || ''
  const progression = useMemo(() => {
    if (!selectedProgCategory) return null
    const categoryExercises = sortExercises(
      Object.values(exById).filter((ex) => !ex.is_rehab && ex.body_parts.includes(selectedProgCategory)),
      lang,
      categories.map((c) => c.key),
    )
    const entryByEx = new Map<string, WorkoutEntry[]>()
    for (const e of entries) {
      const ex = exById[e.exercise_id]
      if (!ex || !ex.body_parts.includes(selectedProgCategory)) continue
      const metric = progressionMetric(ex, setMap[e.id] ?? [])
      if (!metric) continue
      entryByEx.set(ex.id, [...(entryByEx.get(ex.id) ?? []), e])
    }
    const dates = [...new Set([...entryByEx.values()].flat().map((e) => e.date))].sort()
    if (dates.length === 0) return null
    const datasets: Array<{
      label: string
      data: Array<number | null>
      borderColor: string
      backgroundColor: string
      yAxisID: 'y' | 'y1'
      tension: number
      spanGaps: boolean
      borderDash?: number[]
      pointRadius: number
      _notes: string[]
    }> = []
    let colorIdx = 0
    for (const ex of categoryExercises) {
      // Gym / bodyweight visibility toggles.
      const gym = exerciseKind(ex) === 'gym'
      if ((gym && !progShowGym) || (!gym && !progShowBodyweight)) continue
      const exEntries = entries.filter((e) => e.exercise_id === ex.id).sort((a, b) => (a.date < b.date ? -1 : 1))
      const byDate = new Map<string, { primary: number | null; secondary: number | null; note: string }>()
      for (const e of exEntries) {
        const metric = progressionMetric(ex, setMap[e.id] ?? [])
        if (metric) byDate.set(e.date, { ...metric, note: e.note_raw })
      }
      if (byDate.size === 0) continue
      const color = TINTS[colorIdx++ % TINTS.length]
      const name = exerciseName(ex, lang)
      if (ex.measure_type === 'weight_reps') {
        datasets.push({
          label: name,
          data: dates.map((d) => byDate.get(d)?.primary ?? null),
          borderColor: color,
          backgroundColor: color,
          yAxisID: 'y',
          tension: 0.3,
          spanGaps: true,
          pointRadius: 4,
          _notes: dates.map((d) => byDate.get(d)?.note ?? ''),
        })
        datasets.push({
          label: `${name} ${lang === 'zh' ? '次数' : 'reps'}`,
          data: dates.map((d) => byDate.get(d)?.secondary ?? null),
          borderColor: color,
          backgroundColor: color,
          yAxisID: 'y1',
          tension: 0.3,
          spanGaps: true,
          borderDash: [3, 4],
          pointRadius: 2,
          _notes: dates.map((d) => byDate.get(d)?.note ?? ''),
        })
      } else {
        datasets.push({
          label: name,
          data: dates.map((d) => byDate.get(d)?.secondary ?? null),
          borderColor: color,
          backgroundColor: color,
          yAxisID: 'y1',
          tension: 0.3,
          spanGaps: true,
          pointRadius: 4,
          _notes: dates.map((d) => byDate.get(d)?.note ?? ''),
        })
      }
    }
    return datasets.length ? { labels: dates.map((d) => d.slice(5)), dates, datasets, exerciseCount: datasets.length } : null
  }, [selectedProgCategory, exById, entries, setMap, lang, categories, progShowGym, progShowBodyweight])

  const selectedSport = sports.find((s) => s.id === sportId) ?? null
  const sportSessionsFor = sessions.filter((s) => s.sport_id === sportId)
  const intimacyStats = useMemo(() => {
    const since = new Date()
    since.setDate(since.getDate() - 29)
    const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`
    const total = intimacyRows.reduce((sum, r) => sum + r.count, 0)
    const recent = intimacyRows.filter((r) => r.date >= sinceIso).reduce((sum, r) => sum + r.count, 0)
    const byCat = INTIMACY_CATEGORIES.map((c) =>
      intimacyRows.filter((r) => intimacyCategory(r) === c).reduce((sum, r) => sum + r.count, 0),
    )
    const days = new Set(intimacyRows.map((r) => r.date)).size
    return { total, recent, days, byCat }
  }, [intimacyRows])

  const KPI = [
    { label: lang === 'zh' ? '训练天数' : 'Training days', value: kpis.trainingDays, c: '' },
    { label: lang === 'zh' ? '健身房次数' : 'Gym days', value: kpis.gymDays, c: 'c' },
    { label: lang === 'zh' ? '自重累计' : 'Bodyweight reps', value: kpis.pushReps, c: 'o' },
    { label: lang === 'zh' ? '运动次数' : 'Sport sessions', value: kpis.sportSessions, c: 'v' },
    { label: lang === 'zh' ? '运动小时' : 'Sport hrs', value: Math.round(kpis.sportHours * 10) / 10, c: 'v' },
    ...(showIntimacy ? [{ label: lang === 'zh' ? '亲密记录' : 'Wellness logs', value: kpis.intimacyCount, c: 'p' }] : []),
    { label: lang === 'zh' ? '平均强度' : 'Avg intensity', value: kpis.avg ? kpis.avg.toFixed(1) : '–', c: '' },
    { label: lang === 'zh' ? '活动伤病' : 'Injuries', value: kpis.active, c: 'r' },
  ]

  return (
    <div className="dash-screen">
      <ActiveInjuryBanner injuries={injuries} lang={lang} showClear />

      <div className="dash-kpis">
        {KPI.map((k) => (
          <div key={k.label} className={`dash-kpi ${k.c}`}>
            <span className="dash-kpi-v">{k.value}</span>
            <span className="dash-kpi-l">{k.label}</span>
          </div>
        ))}
      </div>

      {roundData && (
        <section className="dash-round">
          <div className="th-sectitle">
            {lang === 'zh' ? '本轮进度' : 'Round progress'}
            <small className="dash-sub">{activeCycle?.name} · {lang === 'zh' ? '完成 / 容量 / 天数' : 'Done / Volume / Days'}</small>
          </div>
          <div className="dash-round-grid">
            <div className="dash-round-main">
              <RoundRings
                chains={roundData.current.chains}
                centerLabel={`R${roundData.current.round.index}`}
                onClick={() => setModalRoundId(roundData.current.round.id)}
              />
              <span className="rr-sub">{lang === 'zh' ? '点击查看人体图' : 'tap for body map'}</span>
            </div>
            {roundData.list.length > 0 && (
              <div className="dash-round-history">
                <span className="dash-round-hist-label">{lang === 'zh' ? '轮次列表' : 'Rounds'}</span>
                <div className="dash-round-hist-scroll">
                  {roundData.list.map(({ round, chains, first, last }) => (
                    <div key={round.id} className="dash-round-hist-item">
                      <RoundRings
                        mini
                        chains={chains}
                        centerLabel={`R${round.index}`}
                        active={round.id === modalRoundId}
                        onClick={() => setModalRoundId(round.id)}
                      />
                      <span className="dash-round-dates">{roundDateRange(round, first, last)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {modalRound && (
        <div className="dash-round-modal-backdrop" onClick={() => setModalRoundId(null)}>
          <div className="dash-round-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dash-round-modal-head">
              <h3>Round {modalRound.round.index}
                <small> · {modalRound.first ?? modalRound.round.started_on} → {modalRound.round.ended_on == null ? (lang === 'zh' ? '进行中' : 'open') : (modalRound.last ?? modalRound.round.ended_on)}</small>
              </h3>
              <button className="cyc-dialog-x" type="button" onClick={() => setModalRoundId(null)} aria-label="close">×</button>
            </div>
            <div className="dash-round-modal-body">
              <RoundRings chains={modalRound.chains} centerLabel={`R${modalRound.round.index}`} />
              <BodyModel activity={modalBody} lang={lang} adult={showIntimacy} />
            </div>
          </div>
        </div>
      )}

      <section className="dash-cal-sec">
        <div className="th-sectitle">
          {lang === 'zh' ? '每日强度' : 'Daily intensity'}
          <span className="cal-filters">
            <button
              type="button"
              className={`cal-chip strength${calStrength ? ' on' : ''}`}
              aria-pressed={calStrength}
              onClick={() => setCalStrength((v) => !v)}
            >{lang === 'zh' ? '力量' : 'Lifting'}</button>
            <button
              type="button"
              className={`cal-chip sport${calSport ? ' on' : ''}`}
              aria-pressed={calSport}
              onClick={() => setCalSport((v) => !v)}
            >{lang === 'zh' ? '运动' : 'Sport'}</button>
          </span>
        </div>
        <IntensityCalendar
          months={calendar}
          lang={lang}
          detail={dayDetail}
          sportLabel={sportLabel}
          injuryDates={injuryDates}
          showIntimacy={showIntimacy}
        />
      </section>

      <section className="dash-recovery">
        <div className="th-sectitle">{lang === 'zh' ? '肌群恢复' : 'Muscle recovery'}</div>
        <div className="dash-rec-grid">
          {recovery.map((r) => (
            <div key={r.bodyPart} className={`dash-rec ${r.daysAgo != null && r.daysAgo >= 7 ? 'overdue' : ''}`}>
              <span>{categoryLabel(r.bodyPart, lang)}</span>
              <strong>{r.daysAgo == null ? '—' : `${r.daysAgo}d`}</strong>
            </div>
          ))}
          {sportRecovery.map((s) => (
            <div key={s.id} className={`dash-rec sport ${s.daysAgo != null && s.daysAgo >= 7 ? 'overdue' : ''}`}>
              <span>🏃 {s.name}</span>
              <strong>{s.daysAgo == null ? '—' : `${s.daysAgo}d`}</strong>
            </div>
          ))}
        </div>
      </section>

      {(injuryStats.active.length > 0 || injuryStats.recoveredCount > 0) && (
        <section className="dash-injury">
          <div className="th-sectitle">
            {lang === 'zh' ? '伤病与康复' : 'Injury & rehab'}
            <small className="dash-sub">
              {injuryStats.recoveredCount > 0 && `${injuryStats.recoveredCount} ${lang === 'zh' ? '已康复' : 'recovered'}`}
              {injuryStats.avgRecovery != null && ` · ${lang === 'zh' ? '平均' : 'avg'} ${injuryStats.avgRecovery}${lang === 'zh' ? '天康复' : 'd'}`}
            </small>
          </div>
          {injuryStats.active.length === 0 ? (
            <p className="dash-empty">{lang === 'zh' ? '当前无活动伤病 🎉' : 'No active injuries 🎉'}</p>
          ) : (
            <div className="dash-injury-grid">
              {injuryStats.active.map((a) => (
                <div key={a.id} className="dash-injury-card">
                  <div className="dash-injury-head">
                    <span className="dash-injury-name">{a.label}</span>
                    <span className={`inj-status-badge ${a.status}`}>{INJURY_STATUS_LABELS[a.status][lang]}</span>
                  </div>
                  <div className="dash-injury-meta">
                    <span>{a.days}{lang === 'zh' ? '天' : 'd'}</span>
                    <span className={a.pain != null && a.pain >= 5 ? 'dash-injury-pain hi' : 'dash-injury-pain'}>
                      {lang === 'zh' ? '疼痛' : 'pain'} {a.pain == null ? '—' : `${a.pain}/10`}
                    </span>
                    <span>{lang === 'zh' ? '计划' : 'plan'} {a.plan}</span>
                    <span className="inj-stat">{a.rehabLogs} {lang === 'zh' ? '次康复(14天)' : 'rehab (14d)'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="dash-analysis">
        <div className="th-sectitle">{lang === 'zh' ? '训练分析' : 'Training analysis'}</div>
        <div className="dash-charts">
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '部位分布' : 'Body-part distribution'}</span>
          <div className="dash-cbox">
            <Doughnut data={{ labels: bpDist.labels, datasets: [{ data: bpDist.data, backgroundColor: TINTS, borderColor: 'transparent', borderWidth: 2 }] }}
              options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}${lang === 'zh' ? ' 次' : ' entries'}` } } } }} />
          </div>
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '每周训练量' : 'Weekly volume'}</span>
          <div className="dash-cbox">
            <Bar data={{ labels: weekly.labels, datasets: [{ data: weekly.data, backgroundColor: '#7dd3a0', borderRadius: 4 }] }}
              options={{ plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}${lang === 'zh' ? ' 次训练' : ' sessions'}` } } }, scales: { x: { grid: { color: GRID }, ticks: { maxRotation: 0 } }, y: { grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } } } }} />
          </div>
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '自重容量趋势' : 'Bodyweight volume trend'}</span>
          <div className="dash-cbox">
            {bwVol.labels.length ? (
              <Line data={{ labels: bwVol.labels, datasets: [{ data: bwVol.data, borderColor: '#4fd1e0', backgroundColor: 'rgba(79,209,224,0.12)', fill: true, tension: 0.3 }] }}
                options={{ plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}${lang === 'zh' ? ' 次(总计)' : ' reps'}` } } }, scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: true } } }} />
            ) : <p className="dash-empty">{lang === 'zh' ? '暂无自重数据' : 'no bodyweight data'}</p>}
          </div>
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '训练类型(次数/组量·按月)' : 'Activity kind (count/volume · by month)'}</span>
          <div className="dash-prog-controls">
            <label className="dash-prog-toggle">
              <input type="checkbox" checked={actShowCount} onChange={(e) => setActShowCount(e.target.checked)} />
              {lang === 'zh' ? '次数' : 'Count'}
            </label>
            <label className="dash-prog-toggle">
              <input type="checkbox" checked={actShowVolume} onChange={(e) => setActShowVolume(e.target.checked)} />
              {lang === 'zh' ? '组量/时长' : 'Volume'}
            </label>
          </div>
          <div className="dash-cbox">
            <Bar
              data={{ labels: activityBars.labels, datasets: activityBars.datasets }}
              options={{
                indexAxis: 'y',
                interaction: { mode: 'dataset', intersect: true },
                plugins: {
                  legend: {
                    position: 'bottom',
                    // Datasets share a label per month (count + volume) — show each once.
                    labels: { boxWidth: 12, padding: 8, filter: (item, data) => data.datasets.findIndex((d) => d.label === item.text) === item.datasetIndex },
                  },
                  tooltip: {
                    // Dedupe to one item per hovered month-stack; the cross-section is built below.
                    filter: (item) => item.dataIndex === 0,
                    displayColors: false,
                    callbacks: {
                      title: (items) => (lang === 'zh' ? `${items[0]?.dataset.label} 明细` : `${items[0]?.dataset.label} detail`),
                      label: () => '',
                      afterBody: (items) => {
                        const mi = (items[0]?.dataset as { _mi?: number } | undefined)?._mi
                        if (mi == null) return []
                        const { keys, count, volume } = activityBars
                        const cu = lang === 'zh' ? '次' : ' ses'
                        const vu = (i: number) => (i === 2 ? (lang === 'zh' ? '小时' : ' h') : (lang === 'zh' ? '组' : ' sets'))
                        return keys.map((k, i) => `${ACTIVITY_LABEL[k][lang]}: ${count[k][mi]}${cu} · ${Math.round(volume[k][mi] * 10) / 10}${vu(i)}`)
                      },
                      footer: (items) => {
                        const mi = (items[0]?.dataset as { _mi?: number } | undefined)?._mi
                        if (mi == null) return ''
                        const { keys, count, volume } = activityBars
                        const cTot = keys.reduce((s, k) => s + count[k][mi], 0)
                        const setTot = volume.gym[mi] + volume.bodyweight[mi]
                        const hTot = Math.round(volume.sport[mi] * 10) / 10
                        return lang === 'zh' ? `合计 ${cTot}次 · ${setTot}组 · ${hTot}小时` : `total ${cTot} ses · ${setTot} sets · ${hTot} h`
                      },
                    },
                  },
                },
                scales: {
                  x: { stacked: true, grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } },
                  y: { stacked: true, grid: { color: GRID } },
                },
              }} />
          </div>
        </div>
        <div className="dash-chart dash-chart-wide">
          <span className="th-label">{lang === 'zh' ? '进步曲线(按分类)' : 'Progression by category'}</span>
          <div className="dash-prog-controls">
            <select className="th-input dash-prog-pick" value={selectedProgCategory} onChange={(e) => setProgCategory(e.target.value)}>
              <option value="">{lang === 'zh' ? '选择分类…' : 'pick a category…'}</option>
              {progCategories.map((c) => (<option key={c.key} value={c.key}>{categoryLabel(c.key, lang)}</option>))}
            </select>
            <label className="dash-prog-toggle">
              <input type="checkbox" checked={progShowGym} onChange={(e) => setProgShowGym(e.target.checked)} />
              {lang === 'zh' ? '健身房' : 'Gym'}
            </label>
            <label className="dash-prog-toggle">
              <input type="checkbox" checked={progShowBodyweight} onChange={(e) => setProgShowBodyweight(e.target.checked)} />
              {lang === 'zh' ? '徒手' : 'Bodyweight'}
            </label>
          </div>
          <div className="dash-prog-desc">
            {lang === 'zh' ? '左轴=重量 · 右轴=次数/时长；同分类动作叠加显示' : 'Left axis = load · right axis = reps/duration; overlays all exercises in the category'}
          </div>
          <div className="dash-cbox dash-cbox-tall">
            {progression ? (
              <Line data={{ labels: progression.labels, datasets: progression.datasets }}
                options={{
                  interaction: { mode: 'nearest', intersect: false },
                  plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, usePointStyle: true, pointStyle: 'line' } },
                    tooltip: {
                      callbacks: {
                        title: (items) => progression.dates[items[0].dataIndex],
                        label: (ctx) => {
                          const unit = ctx.dataset.yAxisID === 'y' ? ' lb' : (lang === 'zh' ? ' 次/分' : ' reps/min')
                          return `${ctx.dataset.label}: ${ctx.parsed.y}${unit}`
                        },
                        afterLabel: (ctx) => {
                          const note = (ctx.dataset as unknown as { _notes?: string[] })._notes?.[ctx.dataIndex]
                          return note ? `  ${note}` : ''
                        },
                      },
                    },
                  },
                  scales: {
                    x: { grid: { color: GRID }, ticks: { maxRotation: 45, minRotation: 45 } },
                    y: { type: 'linear', position: 'left', grid: { color: GRID }, beginAtZero: true, title: { display: true, text: lang === 'zh' ? '重量' : 'load' } },
                    y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, beginAtZero: true, title: { display: true, text: lang === 'zh' ? '次数 / 分钟' : 'reps / min' } },
                  },
                }} />
            ) : <p className="dash-empty">{selectedProgCategory ? (lang === 'zh' ? '暂无数据' : 'no data') : (lang === 'zh' ? '选择分类查看' : 'pick a category')}</p>}
          </div>
        </div>
        </div>
      </section>

      {sports.length > 0 && (
        <section className="dash-sports">
          <div className="dash-sports-head">
            <div className="th-sectitle">{lang === 'zh' ? '运动' : 'Sports'}</div>
            {sports.length > 1 && (
              <select className="th-input dash-sport-pick" value={sportId} onChange={(e) => setSportId(e.target.value)}>
                {sports.map((s) => (<option key={s.id} value={s.id}>{sportName(s, lang)}</option>))}
              </select>
            )}
          </div>
          {selectedSport && <SportCharts sport={selectedSport} sessions={sportSessionsFor} lang={lang} />}
        </section>
      )}

      {showIntimacy && (
        <section className="dash-intimacy">
          <div className="dash-intimacy-head">
            <div>
              <span className="dash-intimacy-kicker">{lang === 'zh' ? '私密' : 'Private'}</span>
              <h3>{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</h3>
            </div>
            <div className="dash-intimacy-total">
              <strong>{intimacyStats.total}</strong>
              <span>{lang === 'zh' ? '总记录' : 'total'}</span>
            </div>
          </div>
          <div className="dash-intimacy-grid">
            <div className="dash-intimacy-metric">
              <span>{lang === 'zh' ? '近 30 天' : 'Last 30 days'}</span>
              <strong>{intimacyStats.recent}</strong>
            </div>
            <div className="dash-intimacy-metric">
              <span>{lang === 'zh' ? '记录天数' : 'Logged days'}</span>
              <strong>{intimacyStats.days}</strong>
            </div>
          </div>
          <div className="dash-intimacy-bars">
            {INTIMACY_CATEGORIES.map((c, i) => {
              const max = Math.max(1, ...intimacyStats.byCat)
              return (
                <div key={c} className="dash-intimacy-bar-row">
                  <span>{intimacyLabel(c, lang, true)}</span>
                  <div className="dash-intimacy-bar-track">
                    <i style={{ width: `${Math.max(6, (intimacyStats.byCat[i] / max) * 100)}%`, background: INTIMACY_COLORS[c] }} />
                  </div>
                  <b>{intimacyStats.byCat[i]}</b>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function allSetValues(sets: ExerciseSet[]): Array<{ weight: number | null; reps: number | null; duration_sec: number | null }> {
  return sets
    .filter((s) => s.set_type !== 'warmup')
    .flatMap((s) => [
      { weight: s.weight, reps: s.reps, duration_sec: s.duration_sec },
      ...(s.sub_sets ?? []),
    ])
}

function progressionMetric(ex: Exercise, sets: ExerciseSet[]): { primary: number | null; secondary: number | null } | null {
  const vals = allSetValues(sets)
  if (ex.measure_type === 'weight_reps') {
    const weighted = vals.filter((s) => s.weight != null)
    if (weighted.length === 0) return null
    const top = weighted.reduce((m, s) => (s.weight! > m.weight! ? s : m))
    return { primary: top.weight!, secondary: top.reps ?? null }
  }
  if (ex.measure_type === 'reps_only') {
    const reps = vals.reduce((sum, s) => sum + (s.reps ?? 0), 0)
    return reps > 0 ? { primary: null, secondary: reps } : null
  }
  const maxSec = vals.reduce((m, s) => Math.max(m, s.duration_sec ?? 0), 0)
  return maxSec > 0 ? { primary: null, secondary: Math.round((maxSec / 60) * 10) / 10 } : null
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthTitle(month: string, lang: 'en' | 'zh'): string {
  const [y, m] = month.split('-').map(Number)
  return lang === 'zh' ? `${y}年${m}月` : `${MONTHS_EN[m - 1]} ${y}`
}

const hoursLabel = (h: number): string => `${Number.isInteger(h) ? h : h.toFixed(1)}h`

/** How many month panels fit side by side — 1 on a phone, up to 3 on a wide screen.
 *  Measured rather than declared in a media query so the panels stay legible inside
 *  whatever column the dashboard gives this section. */
function useVisibleMonths(ref: React.RefObject<HTMLDivElement | null>): number {
  const [n, setN] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      setN(Math.max(1, Math.min(3, Math.floor(e.contentRect.width / 480))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return n
}

/** Daily-intensity view with two shapes over the same data:
 *  - Overview: GitHub's contribution grid — 7 weekday rows × week columns, colour
 *    only, so consistency and gaps read at a glance across a whole year.
 *  - Month: one month, one square per day, again colour only.
 *  Squares carry no text. At ~45px a body-part tag ellipses to "Sh… 13", which
 *  tells you nothing and hides the fill the heat scale exists to show; the panel
 *  underneath names the movements for whichever day is hovered, focused or tapped
 *  (tapping is what makes this work on a phone, where hovering never did). */
function IntensityCalendar({ months, lang, detail, sportLabel, injuryDates, showIntimacy }: {
  months: CalendarMonth[]
  lang: 'en' | 'zh'
  detail: Record<string, DayDetail>
  sportLabel: (id: string) => string
  injuryDates: Set<string>
  showIntimacy: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const visible = useVisibleMonths(wrap)
  // Index one past the newest month on screen. null = pinned to the latest month,
  // so the view follows new data until the user actually pages back.
  const [end, setEnd] = useState<number | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  // 'year' = the GitHub-style overview (consistency, gaps); 'month' = one month in
  // detail. Both shade a day identically — same levels, computed once.
  const [mode, setMode] = useState<'year' | 'month'>('year')
  // null = the rolling 53 weeks ending today, GitHub's default view.
  const [year, setYear] = useState<number | null>(null)

  // 53 columns overflow a phone, so the grid scrolls — and must open on the NEWEST
  // week, not on last September. (A CSS `direction: rtl` container does this too,
  // but it also flips the content, and the fix for that is fragile.)
  const scroller = useRef<HTMLDivElement>(null)
  const years = useMemo(() => yearsOf(months), [months])
  const grid = useMemo(() => yearGrid(months, { year: year ?? undefined }), [months, year])
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [mode, grid])
  const allDays = useMemo(() => {
    const m = new Map<string, DayCell>()
    for (const mo of months) for (const d of mo.days) m.set(d.date, d)
    return m
  }, [months])

  const wd = lang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const LVL = lang === 'zh' ? ['无', '轻', '中', '高', '最高'] : ['rest', 'light', 'moderate', 'high', 'max']

  const last = Math.min(end ?? months.length, months.length)
  const start = Math.max(0, last - visible)
  const shown = months.slice(start, last)

  // Falls back to the most recent day that actually has something on it, so the
  // detail panel is never empty on arrival.
  const fallback = useMemo(() => {
    for (const m of [...shown].reverse()) {
      for (let i = m.days.length - 1; i >= 0; i--) {
        const d = m.days[i]
        if (d.level != null && d.load > 0) return d.date
      }
    }
    return null
  }, [shown])
  // The year grid spans dates outside the paged months, so it falls back to the
  // newest day carrying load anywhere in the grid.
  const yearFallback = useMemo(() => {
    for (let c = grid.columns.length - 1; c >= 0; c--) {
      for (let r = 6; r >= 0; r--) {
        const cell = grid.columns[c][r]
        if (cell && cell.load > 0) return cell.date
      }
    }
    return null
  }, [grid])

  const activeDate = hover ?? picked ?? (mode === 'year' ? yearFallback : fallback)
  const active = activeDate
    ? (mode === 'year' ? allDays.get(activeDate) : shown.flatMap((m) => m.days).find((d) => d.date === activeDate))
    : undefined
  const activeDetail = activeDate ? detail[activeDate] : undefined

  // Name and amount are separate spans: the name may ellipse inside a narrow square,
  // the amount never does — "背部 …" with the set count cut off tells you nothing.
  const tagsFor = (day: DayCell): { kind: 'strength' | 'sport'; name: string; amount: string }[] => [
    ...day.strength.map((t) => ({ kind: 'strength' as const, name: categoryLabel(t.part, lang), amount: String(t.sets) })),
    ...day.sports.map((t) => ({ kind: 'sport' as const, name: sportLabel(t.sportId), amount: hoursLabel(t.hours) })),
  ]

  return (
    <div className="dash-cal" ref={wrap} onMouseLeave={() => setHover(null)}>
      <div className="cal-nav">
        <div className="cal-modes" role="group">
          <button type="button" className={`cal-mode${mode === 'year' ? ' on' : ''}`} onClick={() => setMode('year')}>
            {lang === 'zh' ? '概览' : 'Overview'}
          </button>
          <button type="button" className={`cal-mode${mode === 'month' ? ' on' : ''}`} onClick={() => setMode('month')}>
            {lang === 'zh' ? '月' : 'Month'}
          </button>
        </div>
        {mode === 'year' ? (
          <span className="cal-range">
            {lang === 'zh'
              ? `${grid.trainedDays} 个训练日`
              : `${grid.trainedDays} training days`}
          </span>
        ) : (
          <>
            <button
              type="button" className="cal-pg" disabled={start === 0}
              onClick={() => setEnd(last - 1)} aria-label={lang === 'zh' ? '上个月' : 'previous month'}
            >‹</button>
            <span className="cal-range">
              {shown.length ? `${monthTitle(shown[0].month, lang)}${shown.length > 1 ? ` – ${monthTitle(shown[shown.length - 1].month, lang)}` : ''}` : ''}
            </span>
            <button
              type="button" className="cal-pg" disabled={last >= months.length}
              onClick={() => setEnd(last + 1)} aria-label={lang === 'zh' ? '下个月' : 'next month'}
            >›</button>
          </>
        )}
      </div>

      {mode === 'year' ? (
        <div className="cal-year">
          <div className="cal-yscroll" ref={scroller}>
            <div className="cal-ymonths" style={{ gridTemplateColumns: `repeat(${grid.columns.length}, var(--sq))` }}>
              {grid.monthLabels.map((ml, i) => (
                <span key={i} style={{ gridColumn: `span ${ml.span}` }}>
                  {ml.span >= 2 ? monthTitle(ml.month, lang).replace(/ ?\d{4}$/, '') : ''}
                </span>
              ))}
            </div>
            <div className="cal-ybody">
              <div className="cal-ywd">
                {/* Mon/Wed/Fri only — seven labels at this size is noise (GitHub does the same). */}
                <span>{wd[0]}</span><span /><span>{wd[2]}</span><span /><span>{wd[4]}</span><span /><span />
              </div>
              <div className="cal-ygrid" style={{ gridTemplateColumns: `repeat(${grid.columns.length}, var(--sq))` }}>
                {grid.columns.map((col, ci) => (
                  <div className="cal-ycol" key={ci}>
                    {col.map((cell, ri) => cell == null ? (
                      <span key={ri} className="cal-sq void" aria-hidden="true" />
                    ) : (
                      <button
                        key={ri}
                        type="button"
                        disabled={cell.level == null}
                        className={`cal-sq${cell.level == null ? ' future' : ''}${injuryDates.has(cell.date) ? ' inj' : ''}${cell.date === activeDate ? ' on' : ''}`}
                        style={cell.level ? { background: LEVEL_FILL[cell.level] } : undefined}
                        onMouseEnter={() => setHover(cell.date)}
                        onFocus={() => setHover(cell.date)}
                        onClick={() => setPicked(cell.date)}
                        aria-label={`${cell.date} · ${LVL[cell.level ?? 0]}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {years.length > 0 && (
            <div className="cal-years">
              <button type="button" className={`cal-yr${year == null ? ' on' : ''}`} onClick={() => setYear(null)}>
                {lang === 'zh' ? '最近一年' : 'Last year'}
              </button>
              {[...years].reverse().map((y) => (
                <button key={y} type="button" className={`cal-yr${year === y ? ' on' : ''}`} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="cal-months">
        {shown.map((m) => (
          <div className="cal-month" key={m.month}>
            {shown.length > 1 && <div className="cal-mtitle">{monthTitle(m.month, lang)}</div>}
            <div className="cal-wd">{wd.map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="cal-grid">
              {Array.from({ length: m.leading }, (_, i) => <span key={`b${i}`} className="cal-blank" aria-hidden="true" />)}
              {m.days.map((day) => {
                const tags = tagsFor(day)
                const injured = injuryDates.has(day.date)
                const summary = tags.map((t) => `${t.name} ${t.amount}`).join(', ')
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={day.level == null}
                    className={`cal-day${day.level == null ? ' future' : ''}${injured ? ' inj' : ''}${day.date === activeDate ? ' on' : ''}`}
                    style={day.level ? { background: LEVEL_FILL[day.level] } : undefined}
                    onMouseEnter={() => setHover(day.date)}
                    onFocus={() => setHover(day.date)}
                    onClick={() => setPicked(day.date)}
                    aria-label={`${day.date} · ${LVL[day.level ?? 0]}${summary ? ` · ${summary}` : ''}`}
                  >
                    <span className="cal-dnum">{Number(day.date.slice(8))}</span>
                    {day.intimacy ? <span className="cal-heart" style={{ color: heartColor(day.intimacy) }}>♥</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      )}

      <div className="cal-detail">
        {active ? (
          <>
            <div className="cal-dt-head">
              <strong>{active.date}</strong>
              <span className="cal-dt-lvl">
                <i className="cal-dot" style={{ background: LEVEL_DOT[active.level ?? 0] }} aria-hidden="true" />
                {LVL[active.level ?? 0]}{active.load > 0 ? ` · ${lang === 'zh' ? '负荷' : 'load'} ${Math.round(active.load)}` : ''}
              </span>
              {injuryDates.has(active.date) && <span className="cal-dt-inj">⚠️ {lang === 'zh' ? '伤病相关' : 'injury-related'}</span>}
            </div>
            <div className="cal-dt-body">
              {activeDetail?.lifts.map((l, i) => (
                <span key={`l${i}`} className="cal-tag strength"><b>{l.name}</b><i>{l.sets}{lang === 'zh' ? '组' : ''}</i></span>
              ))}
              {activeDetail?.sports.map((sp, i) => (
                <span key={`s${i}`} className="cal-tag sport"><b>{sp.name}</b><i>{hoursLabel(sp.hours)}</i></span>
              ))}
              {showIntimacy && activeDetail?.intimacy ? <span className="cal-tag intimacy"><b>💗 {activeDetail.intimacy}</b></span> : null}
              {!activeDetail?.lifts.length && !activeDetail?.sports.length && !(showIntimacy && activeDetail?.intimacy) && (
                <span className="cal-dt-empty">{lang === 'zh' ? '休息日' : 'rest day'}</span>
              )}
            </div>
          </>
        ) : (
          <span className="cal-dt-empty">{lang === 'zh' ? '这里还没有记录' : 'nothing logged here'}</span>
        )}
      </div>

      <div className="cal-legend">
        <span>{lang === 'zh' ? '轻' : 'light'}</span>
        {[1, 2, 3, 4].map((l) => (
          <span key={l} className="cal-lg" style={{ background: LEVEL_FILL[l] }}>
            <i style={{ background: LEVEL_DOT[l] }} />
          </span>
        ))}
        <span>{lang === 'zh' ? '最高' : 'max'}</span>
      </div>
    </div>
  )
}
