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
import { getEntries, getExercises, getSetsByEntryIds, getSportSessions, getInjuries, getSports, getTrackerEntries } from '../../db'
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
import { ActiveInjuryBanner } from '../injuries'
import { SportCharts, sportName } from '../sports'
import { exerciseName } from '../log/util'
import {
  INTIMACY_CATEGORIES,
  INTIMACY_COLORS,
  intimacyCategory,
  intimacyLabel,
  intimacyVisible,
} from '../intimacy'
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
Chart.defaults.color = '#8b93a3'
Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace"
Chart.defaults.font.size = 11
Chart.defaults.maintainAspectRatio = false
const GRID = 'rgba(120, 130, 150, 0.15)'
const TINTS = ['#8ab4f8', '#4fd1e0', '#7dd3a0', '#a78bfa', '#ff8a5c', '#f5b544', '#f472b6']
// intensity ramp 0–4: green (easy) → amber → red (hard) — less overall amber
const HEAT = ['var(--panelhi)', 'rgba(125,211,160,.38)', 'rgba(125,211,160,.7)', 'rgba(245,181,68,.85)', '#ff5d6c']

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
  const [progId, setProgId] = useState('')
  const [sportId, setSportId] = useState('')

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
    })()
  }, [])

  const allSets = useMemo(() => Object.values(setMap).flat(), [setMap])
  const recovery = useMemo(() => muscleRecovery(entries, exById), [entries, exById])
  const bpCounts = useMemo(() => bodyPartCounts(entries, exById), [entries, exById])
  const stCounts = useMemo(() => setTypeCounts(allSets), [allSets])
  const weekly = useMemo(() => weeklyEntryVolume(entries), [entries])
  const heat = useMemo(() => intensityHeatmap(entries, sessions, showIntimacy ? intimacyRows : []), [entries, sessions, intimacyRows, showIntimacy])
  // per-date detail for the heatmap tooltip
  const heatDetail = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const e of entries) { const ex = exById[e.exercise_id]; if (ex) (m[e.date] ??= []).push(exerciseName(ex, lang)) }
    for (const s of sessions) { const sp = sports.find((x) => x.id === s.sport_id); (m[s.date] ??= []).push('🏃 ' + (sp ? sportName(sp, lang) : 'sport')) }
    const out: Record<string, string> = {}
    for (const [d, list] of Object.entries(m)) out[d] = [...new Set(list)].slice(0, 8).join(', ')
    return out
  }, [entries, sessions, exById, sports, lang])
  // dates that carry an injury signal (onset, injured session, or de-loaded lift)
  const injuryDates = useMemo(() => {
    const s = new Set<string>()
    for (const i of injuries) s.add(i.started_on)
    for (const ss of sessions) if (ss.injury) s.add(ss.date)
    for (const e of entries) if (e.injury_modified) s.add(e.date)
    return s
  }, [injuries, sessions, entries])
  const bwVol = useMemo(() => bodyweightVolume(entries, setMap, exById), [entries, setMap, exById])

  const kpis = useMemo(() => {
    const gymDays = new Set(entries.map((e) => e.date)).size
    const trainingDays = new Set([
      ...entries.map((e) => e.date),
      ...sessions.map((s) => s.date),
      ...(showIntimacy ? intimacyRows.map((r) => r.date) : []),
    ]).size
    const sportHours = sessions.reduce((sum, s) => sum + s.hours, 0)
    const active = injuries.filter((i) => i.status !== 'recovered').length
    const pushReps = totalBodyweightReps(allSets, entries, exById)
    const lvls = heat.flat().map((c) => c.level).filter((l) => l > 0)
    const avg = lvls.length ? (lvls.reduce((a, b) => a + b, 0) / lvls.length) : 0
    const intimacyCount = showIntimacy ? intimacyRows.reduce((sum, r) => sum + r.count, 0) : 0
    return { trainingDays, gymDays, sportHours, active, pushReps, avg, intimacyCount }
  }, [entries, sessions, injuries, allSets, exById, heat, intimacyRows, showIntimacy])

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
    { label: lang === 'zh' ? '运动小时' : 'Sport hrs', value: Math.round(kpis.sportHours * 10) / 10, c: 'v' },
    ...(showIntimacy ? [{ label: lang === 'zh' ? '亲密记录' : 'Wellness logs', value: kpis.intimacyCount, c: 'p' }] : []),
    { label: lang === 'zh' ? '平均强度' : 'Avg intensity', value: kpis.avg ? kpis.avg.toFixed(1) : '–', c: '' },
    { label: lang === 'zh' ? '活动伤病' : 'Injuries', value: kpis.active, c: 'r' },
  ]

  return (
    <div className="dash-screen">
      <ActiveInjuryBanner injuries={injuries} lang={lang} />

      <div className="dash-kpis">
        {KPI.map((k) => (
          <div key={k.label} className={`dash-kpi ${k.c}`}>
            <span className="dash-kpi-v">{k.value}</span>
            <span className="dash-kpi-l">{k.label}</span>
          </div>
        ))}
      </div>

      <section className="dash-heat-sec">
        <div className="th-sectitle">{lang === 'zh' ? '每日强度' : 'Daily intensity'} <small className="dash-sub">0 {lang === 'zh' ? '无' : 'rest'} · 4 {lang === 'zh' ? '比赛/双练' : 'comp/double'}{showIntimacy ? (lang === 'zh' ? ' · 含私密' : ' · includes private') : ''}</small></div>
        <Heatmap cols={heat} lang={lang} detail={heatDetail} injuryDates={injuryDates} />
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
        </div>
      </section>

      <div className="dash-charts">
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '部位分布' : 'Body-part distribution'}</span>
          <div className="dash-cbox">
            <Doughnut data={{ labels: getCategories().map((c) => categoryLabel(c.key, lang)), datasets: [{ data: bpCounts, backgroundColor: TINTS, borderColor: 'transparent', borderWidth: 2 }] }}
              options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } } }} />
          </div>
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '每周训练量' : 'Weekly volume'}</span>
          <div className="dash-cbox">
            <Bar data={{ labels: weekly.labels, datasets: [{ data: weekly.data, backgroundColor: '#7dd3a0', borderRadius: 4 }] }}
              options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID }, ticks: { maxRotation: 0 } }, y: { grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 } } } }} />
          </div>
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '自重容量趋势' : 'Bodyweight volume trend'}</span>
          <div className="dash-cbox">
            {bwVol.labels.length ? (
              <Line data={{ labels: bwVol.labels, datasets: [{ data: bwVol.data, borderColor: '#4fd1e0', backgroundColor: 'rgba(79,209,224,0.12)', fill: true, tension: 0.3 }] }}
                options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: true } } }} />
            ) : <p className="dash-empty">{lang === 'zh' ? '暂无自重数据' : 'no bodyweight data'}</p>}
          </div>
        </div>
        <div className="dash-chart">
          <span className="th-label">{lang === 'zh' ? '组类型分布' : 'Set-type distribution'}</span>
          <div className="dash-cbox">
            <Doughnut data={{ labels: stCounts.labels, datasets: [{ data: stCounts.data, backgroundColor: TINTS, borderColor: 'transparent', borderWidth: 2 }] }}
              options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } } }} />
          </div>
        </div>
        <div className="dash-chart dash-chart-wide">
          <span className="th-label">{lang === 'zh' ? '进步曲线(顶组 + e1RM)' : 'Progression (top set + e1RM)'}</span>
          <select className="th-input dash-prog-pick" value={progId} onChange={(e) => setProgId(e.target.value)}>
            <option value="">{lang === 'zh' ? '选择动作…' : 'pick an exercise…'}</option>
            {progExercises.map((ex) => (<option key={ex.id} value={ex.id}>{lang === 'zh' ? ex.name_zh : ex.name_en}</option>))}
          </select>
          <div className="dash-cbox">
            {progression ? (
              <Line data={{ labels: progression.map((p) => p.date), datasets: [
                { label: lang === 'zh' ? '顶组' : 'top set', data: progression.map((p) => p.weight), borderColor: '#8ab4f8', backgroundColor: '#8ab4f8', tension: 0.3 },
                { label: 'e1RM', data: progression.map((p) => p.e1rm), borderColor: '#f5b544', backgroundColor: '#f5b544', borderDash: [4, 3], tension: 0.3 },
              ] }} options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } } }, scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID } } } }} />
            ) : <p className="dash-empty">{progId ? (lang === 'zh' ? '暂无数据' : 'no data') : (lang === 'zh' ? '选择动作查看' : 'pick an exercise')}</p>}
          </div>
        </div>
      </div>

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

function Heatmap({ cols, lang, detail, injuryDates }: { cols: HeatCell[][]; lang: 'en' | 'zh'; detail: Record<string, string>; injuryDates: Set<string> }) {
  const wd = lang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const [tip, setTip] = useState<{ x: number; y: number; cell: HeatCell } | null>(null)
  const LVL = lang === 'zh' ? ['无', '恢复', '常规', '高强', '比赛/双练'] : ['rest', 'recovery', 'normal', 'high', 'comp/double']

  return (
    <div className="dash-heat" onMouseLeave={() => setTip(null)}>
      <div className="dash-heat-days">
        {wd.map((d, i) => (<span key={i}>{d}</span>))}
      </div>
      <div className="dash-heat-grid">
        {cols.map((col, ci) => (
          <div key={ci} className="dash-heat-col">
            {col.map((cell) => (
              <span
                key={cell.date}
                className={`dash-heat-cell ${injuryDates.has(cell.date) ? 'inj' : ''}`}
                style={{ background: HEAT[cell.level] }}
                onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, cell })}
                onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
              />
            ))}
          </div>
        ))}
      </div>
      {tip && (
        <div className="dash-heat-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="tdate">{tip.cell.date}</div>
          <div className="tint">{lang === 'zh' ? '强度' : 'intensity'} {tip.cell.level} · {LVL[tip.cell.level]}</div>
          <div className="tbody">{detail[tip.cell.date] || (lang === 'zh' ? '休息' : 'rest day')}</div>
          {injuryDates.has(tip.cell.date) && <div className="tinj">⚠️ {lang === 'zh' ? '伤病相关' : 'injury-related'}</div>}
        </div>
      )}
    </div>
  )
}
