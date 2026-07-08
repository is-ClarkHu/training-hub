// Apple-watch-style triple ring (§6B P3): each ring is a muscle chain (push /
// pull / legs); the fill = sets logged this round vs a target. Click to expand the
// body model for the round. Purely presentational — the parent computes the sets.
import type { ChainId } from '../cycle/anatomy'

export interface RingChain {
  id: ChainId
  label: string
  color: string
  sets: number
  target: number
}

const RADII = [52, 41, 30] // outer → inner, one per chain

export function RoundRings({
  chains,
  roundIndex,
  subtitle,
  active,
  onClick,
}: {
  chains: RingChain[]
  roundIndex: number | null
  subtitle?: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button type="button" className={`rr ${active ? 'is-open' : ''}`} onClick={onClick} aria-label="round rings">
      <svg viewBox="0 0 120 120" className="rr-svg">
        {chains.slice(0, 3).map((c, i) => {
          const r = RADII[i]
          const pct = c.target > 0 ? Math.min(1, c.sets / c.target) : 0
          return (
            <g key={c.id} transform="rotate(-90 60 60)">
              <circle className="rr-track" cx="60" cy="60" r={r} fill="none" strokeWidth="8.5" />
              <circle
                cx="60" cy="60" r={r} fill="none" strokeWidth="8.5" strokeLinecap="round"
                stroke={c.color} pathLength={100} strokeDasharray={`${pct * 100} 100`}
              />
            </g>
          )
        })}
        <text className="rr-center" x="60" y="60" textAnchor="middle" dominantBaseline="central">
          {roundIndex != null ? `R${roundIndex}` : '—'}
        </text>
      </svg>
      <div className="rr-legend">
        {chains.map((c) => (
          <span key={c.id} className="rr-leg">
            <i style={{ background: c.color }} />
            {c.label} <b>{c.sets}</b>/{c.target}
          </span>
        ))}
      </div>
      {subtitle && <span className="rr-sub">{subtitle}</span>}
    </button>
  )
}
