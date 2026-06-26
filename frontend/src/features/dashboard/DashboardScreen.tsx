// Dashboard (SPEC §8): bilingual KPI strip + signature charts over the local
// store. Every label and value renders in the current language.
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
import { getEntries, getExercises, getSetsByEntryIds, getSportSessions, getInjuries } from '../../db'
import { useLanguage } from '../../i18n'
import {
  BODY_PARTS,
  BODY_PART_LABELS,
  type Exercise,
  type ExerciseSet,
  type Injury,
  type SportSession,
  type WorkoutEntry,
} from '../../supabase/types'
import { ActiveInjuryBanner } from '../injuries'
import { bodyPartCounts, e1RM, muscleRecovery, setTypeCounts, weeklyEntryVolume } from './stats'
import './dashboard.css'

Chart.register(ArcElement, BarElement, PointElement, LineElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#6b8294'
Chart.defaults.font.family = 'ui-monospace, monospace'
Chart.defaults.font.size = 11
const GRID = 'rgba(33, 56, 74, 0.6)'
const TINTS = ['#2dd4bf', '#7cc4ff', '#f5a623', '#ff6b6b', '#a78bfa', '#4ade80', '#f472b6']

export function DashboardScreen() {
  const { lang } = useLanguage()
  const [entries, setEntries] = useState<WorkoutEntry[]>([])
  const [setMap, setSetMap] = useState<Record<string, ExerciseSet[]>>({})
  const [exById, setExById] = useState<Record<string, Exercise>>({})
  const [sessions, setSessions] = useState<SportSession[]>([])
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [progId, setProgId] = useState<string>('')

  useEffect(() => {
    void (async () => {
      const [es, exs, sess, inj] = await Promise.all([getEntries(), getExercises(), getSportSessions(), getInjuries()])
      const sm = await getSetsByEntryIds(es.map((e) => e.id))
      setEntries(es)
      setSetMap(sm)
      setExById(Object.fromEntries(exs.map((e) => [e.id, e])))
      setSessions(sess)
      setInjuries(inj)
    })()
  }, [])

  const allSets = useMemo(() => Object.values(setMap).flat(), [setMap])
  const recovery = useMemo(() => muscleRecovery(entries, exById), [entries, exById])
  const bpCounts = useMemo(() => bodyPartCounts(entries, exById), [entries, exById])
  const stCounts = useMemo(() => setTypeCounts(allSets), [allSets])
  const weekly = useMemo(() => weeklyEntryVolume(entries), [entries])

  const kpis = useMemo(() => {
    const trainingDays = new Set([...entries.map((e) => e.date), ...sessions.map((s) => s.date)]).size
    const sportHours = sessions.reduce((sum, s) => sum + s.hours, 0)
    const active = injuries.filter((i) => i.status !== 'recovered').length
    return { trainingDays, entries: entries.length, sets: allSets.length, sportHours, active }
  }, [entries, sessions, injuries, allSets])

  // Per-set progression for a chosen weight_reps exercise (§8): top working-set
  // weight + estimated 1RM over time.
  const progExercises = useMemo(
    () =>
      Object.values(exById).filter(
        (ex) => ex.measure_type === 'weight_reps' && entries.some((e) => e.exercise_id === ex.id),
      ),
    [exById, entries],
  )
  const progression = useMemo(() => {
    if (!progId) return null
    const points = entries
      .filter((e) => e.exercise_id === progId)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((e) => {
        const work = (setMap[e.id] ?? []).filter((s) => s.set_type !== 'warmup' && s.weight != null)
        if (work.length === 0) return null
        const top = work.reduce((m, s) => (s.weight! > m.weight! ? s : m))
        return { date: e.date, weight: top.weight!, e1rm: e1RM(top.weight!, top.reps ?? 1) }
      })
      .filter((p): p is { date: string; weight: number; e1rm: number } => p !== null)
    return points.length ? points : null
  }, [progId, entries, setMap])

  const KPI = [
    { label: lang === 'zh' ? '训练天数' : 'Training days', value: kpis.trainingDays },
    { label: lang === 'zh' ? '记录条数' : 'Entries', value: kpis.entries },
    { label: lang === 'zh' ? '组数' : 'Sets', value: kpis.sets },
    { label: lang === 'zh' ? '运动小时' : 'Sport hrs', value: kpis.sportHours },
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
          <Doughnut
            data={{
              labels: BODY_PARTS.map((bp) => BODY_PART_LABELS[bp][lang]),
              datasets: [{ data: bpCounts, backgroundColor: TINTS, borderColor: '#0c151c', borderWidth: 2 }],
            }}
            options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } } }}
          />
        </div>

        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '每周训练量' : 'Weekly volume'}</span>
          <Bar
            data={{ labels: weekly.labels, datasets: [{ data: weekly.data, backgroundColor: '#2dd4bf', borderRadius: 3 }] }}
            options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID }, ticks: { maxRotation: 0 } }, y: { grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } } } }}
          />
        </div>

        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '组类型分布' : 'Set-type distribution'}</span>
          <Doughnut
            data={{ labels: stCounts.labels, datasets: [{ data: stCounts.data, backgroundColor: TINTS, borderColor: '#0c151c', borderWidth: 2 }] }}
            options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } } }}
          />
        </div>

        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '进步曲线(顶组重量 + 预估1RM)' : 'Progression (top set + e1RM)'}</span>
          <select className="th-input dash-prog-pick" value={progId} onChange={(e) => setProgId(e.target.value)}>
            <option value="">{lang === 'zh' ? '选择动作…' : 'pick an exercise…'}</option>
            {progExercises.map((ex) => (
              <option key={ex.id} value={ex.id}>{lang === 'zh' ? ex.name_zh : ex.name_en}</option>
            ))}
          </select>
          {progression ? (
            <Line
              data={{
                labels: progression.map((p) => p.date),
                datasets: [
                  { label: lang === 'zh' ? '顶组' : 'top set', data: progression.map((p) => p.weight), borderColor: '#2dd4bf', backgroundColor: '#2dd4bf', tension: 0.25 },
                  { label: 'e1RM', data: progression.map((p) => p.e1rm), borderColor: '#f5a623', backgroundColor: '#f5a623', borderDash: [4, 3], tension: 0.25 },
                ],
              }}
              options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } }, scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: false } } }}
            />
          ) : (
            <p className="dash-empty">{progId ? (lang === 'zh' ? '暂无可用数据' : 'no data yet') : (lang === 'zh' ? '选择一个动作查看曲线' : 'pick an exercise to plot')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
