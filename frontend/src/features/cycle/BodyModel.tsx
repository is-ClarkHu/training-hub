// Body model (§6B P2). A front + back figure whose muscle regions TILE the whole
// body — every part except the head belongs to a region, so anything can light up
// (dim = untrained, accent = trained, brighter with more sets; genitals pink for
// adult). Hover pops a floating box at the cursor listing each exercise's sets and
// loop day. Left/right mirror from one authored half via <Sym>.
import { useState } from 'react'
import type { TranslationTarget } from '../../translation'
import { regionLabel, type RegionId } from './anatomy'
import './body.css'

const RAMP_MAX = 8
const W = 200 // viewBox width; mirror axis = W/2 = 100

export interface RegionView {
  sets: number
  items: Array<{ name: string; sets: number; day: string | null }>
}

function fillFor(id: RegionId, sets: number): string {
  if (sets <= 0) return 'var(--body-dim)'
  const hue = id === 'genitals' ? 'var(--body-pink)' : 'var(--accent)'
  const t = Math.min(1, sets / RAMP_MAX)
  return `color-mix(in srgb, ${hue} ${Math.round((0.3 + 0.7 * t) * 100)}%, var(--body-dim))`
}

function Sym({ children }: { children: React.ReactNode }) {
  return <>{children}<g transform={`translate(${W},0) scale(-1,1)`}>{children}</g></>
}

interface HoverState { id: RegionId; x: number; y: number }
interface RP { activity: Record<string, RegionView>; hoverId: RegionId | null; onHover: (h: HoverState | null) => void }
function Reg({ id, activity, hoverId, onHover, children }: RP & { id: RegionId; children: React.ReactNode }) {
  return (
    <g
      className={`bm-region ${hoverId === id ? 'is-hover' : ''}`}
      fill={fillFor(id, activity[id]?.sets ?? 0)}
      onMouseEnter={(e) => onHover({ id, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onHover({ id, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null)}
    >
      {children}
    </g>
  )
}

const Head = () => <ellipse className="bm-head" cx="100" cy="27" rx="16" ry="19" />
// Thick neck / upper traps.
const NECK = 'M90 45 Q100 41 110 45 L111 63 Q100 68 89 63 Z'
// Big rounded deltoid cap (left), wide-set for a broad frame. Mirrored right.
const DELT = 'M60 72 C46 72 39 84 39 100 C39 110 49 113 57 108 C66 103 73 89 75 76 C71 73 65 72 60 72 Z'
// Thick, slightly abducted upper arm + forearm.
const UPPER_ARM = 'M58 92 C48 102 42 124 39 150 L38 162 L60 164 L62 126 C64 108 66 98 71 94 Z'
const FOREARM = 'M38 162 L60 164 L58 208 C57 219 49 227 41 226 C33 225 29 217 30 209 L35 180 C36 170 36 166 38 162 Z'
const HAND = <ellipse cx="44" cy="228" rx="9" ry="11" />
const CALF = 'M64 312 L95 312 L93 404 C93 428 85 440 74 440 L66 440 C59 431 60 398 62 356 Z'
const FOOT = <ellipse cx="74" cy="444" rx="13" ry="7" />
// Muscle-definition grooves (drawn over the fills).
const FRONT_LINES = 'M100 66 L100 126 M78 116 Q100 126 122 116 M100 130 L100 204 M86 150 H114 M85 170 H115 M86 190 H114'
const BACK_LINES = 'M100 66 L100 206 M78 150 Q100 158 122 150'

function Front({ activity, hoverId, onHover }: RP) {
  const P = { activity, hoverId, onHover }
  return (
    <g>
      <Head />
      <Reg {...P} id="shoulders"><path d={NECK} /><Sym><path d={DELT} /></Sym></Reg>
      <Reg {...P} id="chest"><Sym><path d="M100 64 L76 67 C64 74 62 94 66 114 C68 122 73 126 78 126 L100 126 Z" /></Sym></Reg>
      <Reg {...P} id="abs"><Sym><path d="M100 126 L78 126 C78 148 82 176 90 194 C93 201 97 206 100 206 Z" /></Sym></Reg>
      <Reg {...P} id="biceps"><Sym><path d={UPPER_ARM} /></Sym></Reg>
      <Reg {...P} id="forearms"><Sym><path d={FOREARM} />{HAND}</Sym></Reg>
      <Reg {...P} id="quads"><Sym><path d="M86 208 C72 220 64 250 63 284 L62 312 L95 312 L96 250 C96 228 92 214 86 208 Z" /></Sym></Reg>
      <Reg {...P} id="adductors"><Sym><path d="M95 214 C93 240 93 272 95 290 L99 290 L99 220 C98 216 97 214 95 214 Z" /></Sym></Reg>
      <Reg {...P} id="calves"><Sym><path d={CALF} />{FOOT}</Sym></Reg>
      <path className="bm-lines" d={FRONT_LINES} />
    </g>
  )
}

function Back({ activity, hoverId, onHover }: RP) {
  const P = { activity, hoverId, onHover }
  return (
    <g>
      <Head />
      <Reg {...P} id="shoulders"><path d={NECK} /><Sym><path d={DELT} /></Sym></Reg>
      <Reg {...P} id="back"><Sym><path d="M100 64 L76 67 C62 74 60 112 74 154 C81 184 94 202 100 206 Z" /></Sym></Reg>
      <Reg {...P} id="triceps"><Sym><path d={UPPER_ARM} /></Sym></Reg>
      <Reg {...P} id="forearms"><Sym><path d={FOREARM} />{HAND}</Sym></Reg>
      <Reg {...P} id="glutes"><Sym><path d="M100 188 L76 186 C69 195 68 210 75 220 C84 227 95 224 100 216 Z" /></Sym></Reg>
      <Reg {...P} id="hamstrings"><Sym><path d="M86 220 C72 232 64 262 63 296 L62 312 L95 312 L96 258 C96 236 92 226 86 220 Z" /></Sym></Reg>
      <Reg {...P} id="calves"><Sym><path d={CALF} />{FOOT}</Sym></Reg>
      <path className="bm-lines" d={BACK_LINES} />
    </g>
  )
}

export function BodyModel({
  activity,
  lang,
  adult = false,
  showBack = true,
}: {
  activity: Record<string, RegionView>
  lang: TranslationTarget
  adult?: boolean
  showBack?: boolean
}) {
  const [hover, setHover] = useState<HoverState | null>(null)
  const P = { activity, hoverId: hover?.id ?? null, onHover: setHover }

  return (
    <div className="bodymodel">
      <div className="bm-figs">
        <figure className="bm-fig">
          <svg viewBox="0 0 200 452" role="img" aria-label="front body">
            <Front {...P} />
            {adult && (
              <Reg {...P} id="genitals">
                <path d="M100 206 q7 0 7 8 q0 8 -7 8 q-7 0 -7 -8 q0 -8 7 -8 z" />
              </Reg>
            )}
          </svg>
          <figcaption>{lang === 'zh' ? '正面' : 'Front'}</figcaption>
        </figure>
        {showBack && (
          <figure className="bm-fig">
            <svg viewBox="0 0 200 452" role="img" aria-label="back body">
              <Back {...P} />
            </svg>
            <figcaption>{lang === 'zh' ? '背面' : 'Back'}</figcaption>
          </figure>
        )}
      </div>

      {hover && (
        <div className="bm-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <b>{regionLabel(hover.id, lang)} · {activity[hover.id]?.sets ?? 0} {lang === 'zh' ? '组' : 'sets'}</b>
          {activity[hover.id]?.items.length ? (
            <ul className="bm-tip-list">
              {activity[hover.id].items.map((it, i) => (
                <li key={i}>
                  <span>{it.name}</span>
                  <em>{it.sets}{lang === 'zh' ? '组' : ''}{it.day ? ` · ${it.day}` : ''}</em>
                </li>
              ))}
            </ul>
          ) : (
            <span className="bm-tip-none">{lang === 'zh' ? '本轮未练' : 'not trained'}</span>
          )}
        </div>
      )}
    </div>
  )
}
