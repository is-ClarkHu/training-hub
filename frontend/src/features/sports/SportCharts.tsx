// Per-sport mini-charts (SPEC §8 Sports): hours by tier (doughnut) + weekly hours
// (bar). Uses Chart.js via react-chartjs-2.
import {
  Chart,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import type { Sport, SportSession } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { hoursByField, weeklyHours, attrLabel, fieldLabel, TIER_COLORS } from './util'
import './sports.css'

Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.color = '#6b8294'
Chart.defaults.font.family = 'ui-monospace, monospace'
Chart.defaults.font.size = 11

const GRID = 'rgba(33, 56, 74, 0.6)'

export function SportCharts({
  sport,
  sessions,
  lang,
}: {
  sport: Sport
  sessions: SportSession[]
  lang: TranslationTarget
}) {
  if (sessions.length === 0) {
    return <p className="sport-empty">No sessions yet for this sport.</p>
  }

  const weekly = weeklyHours(sessions)
  // Group hours by the sport's first select field (e.g. frisbee level), if any.
  const selectField = sport.fields?.find((f) => f.type === 'select')
  const byField = selectField ? hoursByField(sessions, selectField) : null

  return (
    <div className="sport-charts">
      {selectField && byField && byField.data.some((n) => n > 0) && (
        <div className="sport-chart">
          <span className="th-label">{lang === 'zh' ? '按' : 'Hours by '}{fieldLabel(selectField, lang)}{lang === 'zh' ? '分组时长' : ''}</span>
          <Doughnut
            data={{
              labels: byField.labels.map((v) => attrLabel(selectField, v, lang)),
              datasets: [{ data: byField.data, backgroundColor: TIER_COLORS, borderColor: '#0c151c', borderWidth: 2 }],
            }}
            options={{ plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } } }}
          />
        </div>
      )}

      <div className="sport-chart">
        <span className="th-label">{lang === 'zh' ? '每周时长' : 'Weekly hours'}</span>
        <Bar
          data={{
            labels: weekly.labels,
            datasets: [{ data: weekly.data, backgroundColor: '#2dd4bf', borderRadius: 3 }],
          }}
          options={{
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: GRID }, ticks: { maxRotation: 0 } },
              y: { grid: { color: GRID }, beginAtZero: true },
            },
          }}
        />
      </div>
    </div>
  )
}
