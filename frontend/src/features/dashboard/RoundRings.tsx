// Apple-watch-style triple ring (§6B P3). The three rings are split-agnostic
// round metrics (complete / volume / balance) so they read the same for any
// split — or rehab. Purely presentational; the parent computes value vs goal.
import { useEffect, useState } from 'react'

export interface RingChain {
  id: string
  label: string
  color: string
  value: number
  goal: number
  display?: string  // legend text; defaults to `value/goal`
}

const RADII = [52, 41, 30] // outer → inner, one per chain
const LAP_CAP = 3          // laps past this all render as the brightest step

// Overshoot has to survive the ring wrapping onto itself. The LIVE arc always
// keeps the chain's exact colour — that's the entity's identity and it has to go
// on matching the legend swatch at 400% — while the finished laps buried under it
// recede a step per lap. So the arc from the head round to 12 o'clock shows how
// deep you are: base = first lap, darkest = 3+ laps.
function lapColor(color: string, laps: number): string {
  if (laps <= 0) return color
  const t = Math.min(laps, LAP_CAP) / LAP_CAP
  return `color-mix(in oklab, black ${Math.round(18 + t * 32)}%, ${color})`
}

function Ring({ chain, r, width, delay, run }: { chain: RingChain; r: number; width: number; delay: number; run: boolean }) {
  const ratio = chain.goal > 0 ? Math.max(0, chain.value / chain.goal) : 0
  const laps = Math.floor(ratio)              // fully-closed laps
  const head = ratio - laps                   // progress into the live lap
  // A ratio of exactly 1 is a closed ring, not an empty second lap.
  const full = laps > 0 && head === 0
  const shown = full ? laps - 1 : laps
  const pct = full ? 100 : head * 100
  const dash = run ? pct : 0
  const style = { transitionDelay: `${delay}ms` }

  return (
    <g transform="rotate(-90 60 60)">
      <circle className="rr-track" cx="60" cy="60" r={r} fill="none" strokeWidth={width} />
      {/* Completed laps, buried under the live arc and darker the deeper they go. */}
      {shown > 0 && (
        <circle
          className="rr-lap" cx="60" cy="60" r={r} fill="none" strokeWidth={width}
          stroke={lapColor(chain.color, shown)} pathLength={100}
          strokeDasharray={run ? '100 0' : '0 100'} style={style}
        />
      )}
      <circle
        className={`rr-arc ${shown > 0 ? 'is-lapped' : ''}`} cx="60" cy="60" r={r} fill="none"
        strokeWidth={width} strokeLinecap="round" stroke={chain.color}
        pathLength={100} strokeDasharray={`${dash} 100`} style={style}
      />
    </g>
  )
}

export function RoundRings({
  chains,
  centerLabel,
  mini = false,
  active = false,
  onClick,
}: {
  chains: RingChain[]
  centerLabel: string
  mini?: boolean
  active?: boolean
  onClick?: () => void
}) {
  // Rings fill from empty on mount — a ring that is simply *there* at 140% looks
  // identical to one at 40%; watching it wrap is what tells them apart.
  const [run, setRun] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setRun(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const shown = chains.slice(0, 3)
  return (
    <button type="button" className={`rr ${mini ? 'mini' : ''} ${active ? 'is-active' : ''}`} onClick={onClick} aria-label={`round ${centerLabel}`}>
      <svg viewBox="0 0 120 120" className="rr-svg">
        {shown.map((c, i) => (
          <Ring key={c.id} chain={c} r={RADII[i]} width={mini ? 10 : 8.5} delay={i * 110} run={run} />
        ))}
        <text className="rr-center" x="60" y="60" textAnchor="middle" dominantBaseline="central">{centerLabel}</text>
      </svg>
      {!mini && (
        <div className="rr-legend">
          {chains.map((c) => {
            const over = c.goal > 0 && c.value > c.goal
            return (
              <span key={c.id} className="rr-leg">
                <i style={{ background: c.color }} />
                {c.label} <b>{c.display ?? `${c.value}/${c.goal}`}</b>
                {over && <em className="rr-over">{Math.round((c.value / c.goal) * 100)}%</em>}
              </span>
            )
          })}
        </div>
      )}
    </button>
  )
}
