// Apple-watch-style triple ring (§6B P3). The three rings are split-agnostic
// round metrics (complete / volume / sessions) so they read the same for any
// split — or rehab. Purely presentational; the parent computes value vs goal.
export interface RingChain {
  id: string
  label: string
  color: string
  value: number
  goal: number
}

const RADII = [52, 41, 30] // outer → inner, one per chain

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
  return (
    <button type="button" className={`rr ${mini ? 'mini' : ''} ${active ? 'is-active' : ''}`} onClick={onClick} aria-label={`round ${centerLabel}`}>
      <svg viewBox="0 0 120 120" className="rr-svg">
        {chains.slice(0, 3).map((c, i) => {
          const r = RADII[i]
          const pct = c.goal > 0 ? Math.min(1, c.value / c.goal) : 0
          return (
            <g key={c.id} transform="rotate(-90 60 60)">
              <circle className="rr-track" cx="60" cy="60" r={r} fill="none" strokeWidth={mini ? 10 : 8.5} />
              <circle
                cx="60" cy="60" r={r} fill="none" strokeWidth={mini ? 10 : 8.5} strokeLinecap="round"
                stroke={c.color} pathLength={100} strokeDasharray={`${pct * 100} 100`}
              />
            </g>
          )
        })}
        <text className="rr-center" x="60" y="60" textAnchor="middle" dominantBaseline="central">{centerLabel}</text>
      </svg>
      {!mini && (
        <div className="rr-legend">
          {chains.map((c) => (
            <span key={c.id} className="rr-leg">
              <i style={{ background: c.color }} />
              {c.label} <b>{c.value}</b>/{c.goal}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
