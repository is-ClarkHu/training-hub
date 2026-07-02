// Dashboard (SPEC §8) — replicates the legacy workout_dashboard.html coverage:
// KPI strip, intensity heatmap (signature), per-body-part progression, weekly
// volume, bodyweight trend, distributions, and per-sport charts. Fully bilingual.
import { useEffect, useMemo, useState } from 'react'
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
import { getEntries, getExercises, getSetsByEntryIds, getSportSessions, getInjuries, getSports } from '../../db'
import { useLanguage } from '../../i18n'
import {
  BODY_PARTS,
  BODY_PART_LABELS,
  type Exercise,
  type ExerciseSet,
  type Injury,
  type Sport,
  type SportSession,
  type WorkoutEntry,
} from '../../supabase/types'
import { ActiveInjuryBanner } from '../injuries'
import { SportCharts, sportName } from '../sports'
import {
  bodyPartCounts,
  bodyweightVolume,
  e1RM,
  intensityHeatmap,
  muscleRecovery,
  setTypeCounts,
  totalBodyweightReps,
  weeklyEntryVolume,
  type HeatCell,
} from './stats'
import './dashboard.css'

Chart.register(ArcElement, BarElement, PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#6b8294'
Chart.defaults.font.family = 'ui-monospace, monospace'
Chart.defaults.font.size = 11
const GRID = 'rgba(33, 56, 74, 0.6)'
const TINTS = ['#2dd4bf', '#7cc4ff', '#f5a623', '#ff6b6b', '#a78bfa', '#4ade80', '#f472b6']
const HEAT = ['#14222c', 'rgba(45,212,191,0.3)', '#2dd4bf', '#f5a623', '#ff6b6b']

export function DashboardScreen() {
  const { lang } = useLanguage()
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [setMap, setSetMap] = useState<Record<string, ExerciseSet[]>>({})
  const [exById, setExById] = useState<Record<string, Exercise>>({})
  const [sessions, setSessions] = useState<SportSession[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [progId, setProgId] = useState('')
  const [sportId, setSportId] = useState('')

  useEffect(() => {
    void (async () => {
      const [es, exs, sess, inj, sp] = await Promise.all([
        getEntries(), getExercises(), getSportSessions(), getInjuries(), getSports(),
      ])
      const sm = await getSetsByEntryIds(es.map((e) => e.id))
      setEntries(es)
      setSetMap(sm)
      setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
      setSessions(sess)
      setInjuries(inj)
      setSports(sp)
      setSportId((prev) => prev || sp.find((s) => s.is_default)?.id || sp[0]?.id || '')
    })()
  }, [])

  const allSets = useMemo(() => Object.values(setMap).flat(), [setMap])
  const recovery = useMemo(() => muscleRecovery(entries, exById), [entries, exById])
  const bpCounts = useMemo(() => bodyPartCounts(entries, exById), [entries, exById])
  const stCounts = useMemo(() => setTypeCounts(allSets), [allSets])
  const weekly = useMemo(() => weeklyEntryVolume(entries), [entries])
  const heat = useMemo(() => intensityHeatmap(entries, sessions), [entries, sessions])
  const bwVol = useMemo(() => bodyweightVolume(entries, setMap, exById), [entries, setMap, exById])

  const kpis = useMemo(() => {
    const gymDays = new Set(entries.map((e) => e.date)).size
    const trainingDays = new Set([...entries.map((e) => e.date), ...sessions.map((s) => s.date)]).size
    const sportHours = sessions.reduce((sum, s) => sum + s.hours, 0)
    const active = injuries.filter((i) => i.status !== 'recovered').length
    const pushReps = totalBodyweightReps(allSets, entries, exById)
    const lvls = heat.flat().map((c) => c.level).filter((l) => l > 0)
    const avg = lvls.length ? (lvls.reduce((a, b) => a + b, 0) / lvls.length) : 0
    return { trainingDays, gymDays, sportHours, active, pushReps, avg }
  }, [entries, sessions, injuries, allSets, exById, heat])

  const progExercises = useMemo(
    () => Object.values(exById).filter((ex) => ex.measure_type === 'weight_reps' && entries.some((e) => e.exercise_id === ex.id)),
    [exById, entries],
  )
  const progression = useMemo(() => {
    if (!progId) return null
    const pts = entries
      .filter((e) => e.exercise_id === progId)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((e) => {
        const work = (setMap[e.id] ?? []).filter((s) => s.set_type !== 'warmup' && s.weight != null)
        if (work.length === 0) return null
        const top = work.reduce((m, s) => (s.weight! > m.weight! ? s : m))
        return { date: e.date, weight: top.weight!, e1rm: e1RM(top.weight!, top.reps ?? 1) }
      })
      .filter((p): p is { date: string; weight: number; e1rm: number } => p !== null)
    return pts.length ? pts : null
  }, [progId, entries, setMap])

  const selectedSport = sports.find((s) => s.id === sportId) ?? null
  const sportSessionsFor = sessions.filter((s) => s.sport_id === sportId)

  const KPI = [
    { label: lang === 'zh' ? '训练天数' : 'Training days', value: kpis.trainingDays },
    { label: lang === 'zh' ? '健身房次数' : 'Gym days', value: kpis.gymDays },
    { label: lang === 'zh' ? '自重累计' : 'Bodyweight reps', value: kpis.pushReps },
    { label: lang === 'zh' ? '运动小时' : 'Sport hrs', value: Math.round(kpis.sportHours * 10) / 10 },
    { label: lang === 'zh' ? '平均强度' : 'Avg intensity', value: kpis.avg ? kpis.avg.toFixed(1) : '–' },
    { label: lang === 'zh' ? '活动伤病' : 'Injuries', value: kpis.active },
  ]

  return (
    <div className="dash-screen">
      <ActiveInjuryBanner injuries={injuries} lang={lang} />

      <div className="dash-kpis">
        {KPI.map((k) => (
          <div key={k.label} className="dash-kpi">
            <span className="dash-kpi-v">{k.value}</span>
            <span className="dash-kpi-l">{k.label}</span>
          </div>
        ))}
      </div>

      <section className="dash-heat-sec">
        <span className="th-label">{lang === 'zh' ? '每日训练强度' : 'Daily intensity'} <em className="dash-sub">0 {lang === 'zh' ? '无' : 'rest'} · 4 {lang === 'zh' ? '比赛/双练' : 'comp/double'}</em></span>
        <Heatmap cols={heat} lang={lang} />
      </section>

      <section className="dash-recovery">
        <span className="th-label">{lang === 'zh' ? '各肌群距上次训练' : 'Muscle recovery spacing'}</span>
        <div className="dash-rec-grid">
          {recovery.map((r) => (
            <div key={r.bodyPart} className={`dash-rec ${r.daysAgo != null && r.daysAgo >= 7 ? 'overdue' : ''}`}>
              <span>{BODY_PART_LABELS[r.bodyPart][lang]}</span>
              <strong>{r.daysAgo == null ? '—' : `${r.daysAgo}d`}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="dash-charts">
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '部位分布' : 'Body-part distribution'}</span>
          <Doughnut data={{ labels: BODY_PARTS.map((bp) => BODY_PART_LABELS[bp][lang]), datasets: [{ data: bpCounts, backgroundColor: TINTS, borderColor: '#0c151c', borderWidth: 2 }] }}
            options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } } }} />
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '每周训练量' : 'Weekly volume'}</span>
          <Bar data={{ labels: weekly.labels, datasets: [{ data: weekly.data, backgroundColor: '#2dd4bf', borderRadius: 3 }] }}
            options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID }, ticks: { maxRotation: 0 } }, y: { grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } } } }} />
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '自重容量趋势' : 'Bodyweight volume trend'}</span>
          {bwVol.labels.length ? (
            <Line data={{ labels: bwVol.labels, datasets: [{ data: bwVol.data, borderColor: '#7cc4ff', backgroundColor: '#7cc4ff', tension: 0.25 }] }}
              options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: true } } }} />
          ) : <p className="dash-empty">{lang === 'zh' ? '暂无自重数据' : 'no bodyweight data'}</p>}
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '组类型分布' : 'Set-type distribution'}</span>
          <Doughnut data={{ labels: stCounts.labels, datasets: [{ data: stCounts.data, backgroundColor: TINTS, borderColor: '#0c151c', borderWidth: 2 }] }}
            options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } } }} />
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '进步曲线(顶组 + e1RM)' : 'Progression (top set + e1RM)'}</span>
          <select className="th-input dash-prog-pick" value={progId} onChange={(e) => setProgId(e.target.value)}>
            <option value="">{lang === 'zh' ? '选择动作…' : 'pick an exercise…'}</option>
            {progExercises.map((ex) => (<option key={ex.id} value={ex.id}>{lang === 'zh' ? ex.name_zh : ex.name_en}</option>))}
          </select>
          {progression ? (
            <Line data={{ labels: progression.map((p) => p.date), datasets: [
              { label: lang === 'zh' ? '顶组' : 'top set', data: progression.map((p) => p.weight), borderColor: '#2dd4bf', backgroundColor: '#2dd4bf', tension: 0.25 },
              { label: 'e1RM', data: progression.map((p) => p.e1rm), borderColor: '#f5a623', backgroundColor: '#f5a623', borderDash: [4, 3], tension: 0.25 },
            ] }} options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } }, scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID } } } }} />
          ) : <p className="dash-empty">{progId ? (lang === 'zh' ? '暂无数据' : 'no data') : (lang === 'zh' ? '选择动作查看' : 'pick an exercise')}</p>}
        </div>
      </div>

      {sports.length > 0 && (
        <section className="dash-sports">
          <div className="dash-sports-head">
            <span className="th-label">{lang === 'zh' ? '运动' : 'Sports'}</span>
            {sports.length > 1 && (
              <select className="th-input dash-sport-pick" value={sportId} onChange={(e) => setSportId(e.target.value)}>
                {sports.map((s) => (<option key={s.id} value={s.id}>{sportName(s, lang)}</option>))}
              </select>
            )}
          </div>
          {selectedSport && <SportCharts sport={selectedSport} sessions={sportSessionsFor} lang={lang} />}
        </section>
      )}
    </div>
  )
}

function Heatmap({ cols, lang }: { cols: HeatCell[][]; lang: 'en' | 'zh' }) {
  const wd = lang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div className="dash-heat">
      <div className="dash-heat-days">
        {wd.map((d, i) => (<span key={i}>{d}</span>))}
      </div>
      <div className="dash-heat-grid">
        {cols.map((col, ci) => (
          <div key={ci} className="dash-heat-col">
            {col.map((cell) => (
              <span key={cell.date} className="dash-heat-cell" style={{ background: HEAT[cell.level] }} title={`${cell.date} · ${cell.level}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
