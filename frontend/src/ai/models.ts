// Model tiers — every provider offers FIVE graded model slots instead of one
// hard-pinned id. The grades are deliberately far apart, so switching tier is a
// real quality/price decision rather than a version bump:
//
//   T1 Frontier  the provider's newest & strongest model — LIVE, re-pointed by
//                "Update models" the day a stronger one ships
//   T2 Flagship  top of the settled generation (the old hard-pinned default)
//   T3 Balanced  the everyday workhorse
//   T4 Light     small model, cheap, still capable
//   T5 Fastest   the smallest model still in service — lowest latency & price
//
// Only T1 tracks the frontier. T2–T5 stay pinned exactly where they are for as
// long as the provider keeps serving them; an update only touches them when a
// pin is retired (or collides with T1), and the replacement may be a little
// stronger but never strong enough to reach the tier above it.
//
// Everything the ranking needs is derived from the live model list, so a
// provider shipping a brand-new family still resolves without a code change.
// Ported from the en-zh-expression-vault build of the same idea.
import { AI_PROVIDERS, type AiProvider } from './config'

export interface Tier {
  key: TierKey
  label: string
  live?: boolean
  zh: string
  en: string
}
export type TierKey = 't1' | 't2' | 't3' | 't4' | 't5'

export const TIERS: Tier[] = [
  { key: 't1', label: 'T1 · Frontier', live: true, zh: '最新最强 — 每次更新都会重新指向', en: 'Newest & strongest — re-pointed on every update.' },
  { key: 't2', label: 'T2 · Flagship', zh: '成熟一代的顶配', en: 'Top of the settled generation.' },
  { key: 't3', label: 'T3 · Balanced', zh: '日常主力:够用,便宜得多', en: 'Everyday workhorse: good enough, much cheaper.' },
  { key: 't4', label: 'T4 · Light', zh: '小模型 — 快且便宜,机械活够用', en: 'Small model — fast and cheap, fine for mechanical work.' },
  { key: 't5', label: 'T5 · Fastest', zh: '仍在服务的最小模型 — 延迟最低', en: 'Smallest model still in service — lowest latency.' },
]
export const TIER_KEYS: TierKey[] = TIERS.map((t) => t.key)
export const LIVE_TIER: TierKey = TIER_KEYS[0]
export const DEFAULT_TIER: TierKey = 't2' // matches the old hard-pinned defaults

export type Catalog = Partial<Record<TierKey, string>>

// Shipped starting points. These are only the *initial* pins: "Update models"
// re-points T1 at whatever is strongest today and repairs any tier the provider
// has retired, so this table ages gracefully instead of going stale.
export const DEFAULT_CATALOG: Record<AiProvider, Catalog> = {
  anthropic: { t1: 'claude-fable-5-1', t2: 'claude-opus-5', t3: 'claude-sonnet-5', t4: 'claude-haiku-4-5', t5: '' },
  openai: { t1: 'gpt-5', t2: 'gpt-4.1', t3: 'gpt-4.1-mini', t4: 'gpt-4o', t5: 'gpt-4o-mini' },
  gemini: { t1: 'gemini-2.5-pro', t2: 'gemini-2.5-flash', t3: 'gemini-2.0-flash', t4: 'gemini-2.5-flash-lite', t5: 'gemini-2.0-flash-lite' },
  // DeepSeek and Moonshot publish short line-ups; the empty slots fill
  // themselves the first time "Update models" reads their live list.
  deepseek: { t1: 'deepseek-reasoner', t2: 'deepseek-chat', t3: '', t4: '', t5: '' },
  moonshot: { t1: 'kimi-latest', t2: 'moonshot-v1-128k', t3: 'moonshot-v1-32k', t4: 'moonshot-v1-8k', t5: '' },
  mistral: { t1: 'mistral-large-latest', t2: 'mistral-medium-latest', t3: 'mistral-small-latest', t4: 'ministral-8b-latest', t5: 'ministral-3b-latest' },
}

// ── ranking ─────────────────────────────────────────────────────────────────
// A model's score is family band (coarse, provider-specific) + version number +
// a size modifier. Bands are 10 apart *before* the ×10 below, so version and
// size never let a model jump its family — but within a family the newer /
// larger one always wins, which is what the tier repair needs.
const FAMILIES: Record<AiProvider, [RegExp, number][]> = {
  anthropic: [[/mythos|fable/, 60], [/opus/, 50], [/sonnet/, 40], [/haiku/, 25]],
  openai: [[/^gpt-[5-9]/, 60], [/^o\d/, 50], [/^gpt-4\.\d/, 40], [/^gpt-4/, 30], [/^gpt-3/, 15]],
  gemini: [[/^gemini/, 40], [/^gemma/, 15]],
  deepseek: [[/reasoner|-r\d/, 50], [/chat|-v\d/, 35], [/coder/, 25]],
  moonshot: [[/kimi/, 50], [/128k/, 40], [/32k/, 30], [/8k/, 20]],
  mistral: [[/mistral-large|magistral/, 50], [/mistral-medium/, 40], [/mistral-small|codestral|pixtral/, 30], [/ministral|mistral-tiny|mistral-nemo/, 15]],
}

// Size class within a family. First match wins, so the narrower spellings come
// first (flash-lite is a lite, not a flash). The tokens must be delimited —
// a bare /mini/ matches "ge-mini" and would demote every Gemini model.
const SIZE: [RegExp, number][] = [
  [/(?:^|[-_])(nano|tiny|3b|1b|4b)\b/, -12],
  [/(?:^|[-_])(mini|lite|small|8b|7b|9b)\b/, -8],
  [/(?:^|[-_])(flash|turbo|instant|haiku)\b/, -4],
  [/(?:^|[-_])(pro|max|ultra|large|reasoner|thinking)\b/, 2],
]

/**
 * Version number out of an id: "gpt-4.1" → 4.1, "claude-opus-4-8" → 4.8,
 * "claude-fable-5-1" → 5.1. Dates, context sizes and parameter counts are
 * stripped first so they can't be mistaken for a version.
 */
export function versionOf(id: string): number {
  const s = String(id)
    .toLowerCase()
    .replace(/\b\d{6,}\b/g, ' ') // 20251001 date snapshots
    .replace(/\b\d+[kmb]\b/g, ' ') // 128k context, 8b params
  let m = s.match(/(\d+)\.(\d+)/)
  // "claude-opus-4-8" → 4.8, but not "gpt-4-0613" (a 4-digit tail is a date).
  if (!m) m = s.match(/[-_](\d{1,2})[-_](\d{1,2})(?!\d)/)
  if (m) return Math.min(Number(m[1]) + Number(m[2]) / 10, 20)
  m = s.match(/(\d+)/)
  return m ? Math.min(Number(m[1]), 20) : 0
}

export function modelScore(pid: AiProvider, id: string): number {
  if (!id) return -Infinity
  const s = String(id).toLowerCase()
  let band = 0
  for (const [re, rank] of FAMILIES[pid] || []) {
    if (re.test(s)) { band = rank; break }
  }
  let size = 0
  for (const [re, adj] of SIZE) {
    if (re.test(s)) { size = adj; break }
  }
  // Previews/experiments rank a hair under an equivalent stable id, so a stable
  // model wins a tie but a genuinely newer preview still wins on version.
  const unstable = /preview|exp\b|-exp|experimental|alpha|beta|nightly/.test(s) ? -0.5 : 0
  return band * 10 + versionOf(s) + size + unstable
}

// Non-chat endpoints (embeddings, audio, images, moderation…) share the model
// list and must never be pinned as a chat tier.
const NOT_CHAT =
  /embed|whisper|tts|audio|speech|transcri|dall-?e|imagen|image|video|veo|sora|moderation|rerank|guard|ocr|realtime|davinci|babbage|curie|instruct-\d|search-preview|gemma|aqa/

export function isChatModel(pid: AiProvider, id: string): boolean {
  const s = String(id).toLowerCase()
  if (NOT_CHAT.test(s)) return false
  if (pid === 'anthropic') return s.startsWith('claude-')
  if (pid === 'gemini') return s.startsWith('gemini-')
  return true
}

// ── stored state (localStorage, like the API keys) ──────────────────────────
const CATALOG_KEY = (p: AiProvider) => `th.ai.catalog.${p}`
const TIER_KEY = (p: AiProvider) => `th.ai.tier.${p}`
const CHECKED_KEY = (p: AiProvider) => `th.ai.checked.${p}`

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** The five tiers for a provider: shipped defaults, overlaid with the last update. */
export function catalogFor(pid: AiProvider): Catalog {
  return { ...(DEFAULT_CATALOG[pid] || {}), ...readJson<Catalog>(CATALOG_KEY(pid), {}) }
}

export function tierFor(pid: AiProvider): TierKey {
  const t = localStorage.getItem(TIER_KEY(pid))
  return TIER_KEYS.includes(t as TierKey) ? (t as TierKey) : DEFAULT_TIER
}

export function setTier(pid: AiProvider, tier: TierKey): void {
  localStorage.setItem(TIER_KEY(pid), tier)
}

export function checkedAt(pid: AiProvider): number {
  return Number(localStorage.getItem(CHECKED_KEY(pid)) || 0)
}

export function lastCheckedAt(): number {
  const times = AI_PROVIDERS.map(checkedAt).filter(Boolean)
  return times.length ? Math.max(...times) : 0
}

/**
 * Which model a call on this provider uses when the caller has no explicit
 * pin: the chosen tier, then the nearest filled tier below it, then above
 * (thin line-ups leave slots empty).
 */
export function resolveModel(pid: AiProvider): string {
  const cat = catalogFor(pid)
  const from = Math.max(TIER_KEYS.indexOf(tierFor(pid)), 0)
  for (let i = from; i < TIER_KEYS.length; i++) if (cat[TIER_KEYS[i]]) return cat[TIER_KEYS[i]] as string
  for (let i = from - 1; i >= 0; i--) if (cat[TIER_KEYS[i]]) return cat[TIER_KEYS[i]] as string
  return ''
}

// ── live model lists ────────────────────────────────────────────────────────
export interface LiveModel { id: string; created: number }

const LIST_URL: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1/models',
  deepseek: 'https://api.deepseek.com/v1/models',
  moonshot: 'https://api.moonshot.cn/v1/models',
  mistral: 'https://api.mistral.ai/v1/models',
}

async function getJSON(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = data.error as { message?: string } | string | undefined
    const msg = (typeof err === 'object' ? err?.message : err) || (data.message as string) || `HTTP ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`)
  }
  return data
}

const stamp = (v: unknown): number =>
  typeof v === 'number' ? v : Date.parse(String(v || '')) / 1000 || 0

/** What the provider serves right now. `created` is 0 where none is reported. */
export async function listModels(pid: AiProvider, key: string): Promise<LiveModel[]> {
  if (pid === 'anthropic') {
    const data = await getJSON('https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    return ((data.data as { id: string; created_at?: string }[]) || []).map((m) => ({ id: m.id, created: stamp(m.created_at) }))
  }

  if (pid === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`
    const data = await getJSON(url, {})
    return ((data.models as { name?: string; supportedGenerationMethods?: string[] }[]) || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), created: 0 }))
  }

  const url = LIST_URL[pid]
  if (!url) throw new Error(`No model list endpoint for "${pid}".`)
  const data = await getJSON(url, { authorization: `Bearer ${key}` })
  const rows = ((data.data || data.models) as { id?: string; name?: string; created?: unknown }[]) || []
  return rows.map((m) => ({ id: (m.id || m.name) as string, created: stamp(m.created) }))
}

// ── the update plan (pure — unit-testable without a network or a browser) ────
export interface TierChange { tier: TierKey; from: string; to: string; reason: string }

/**
 * Rank the live list against the current five pins and return the next catalog
 * plus a human-readable list of what moved.
 */
export function planCatalog(pid: AiProvider, current: Catalog, live: LiveModel[]): { catalog: Catalog; changes: TierChange[] } {
  const next: Catalog = { ...current }
  const changes: TierChange[] = []
  const pool = (live || []).filter((m) => m && m.id && isChatModel(pid, m.id))
  if (!pool.length) return { catalog: next, changes }

  const served = new Set(pool.map((m) => m.id))
  const stronger = (a: LiveModel, b: LiveModel) => {
    const d = modelScore(pid, b.id) - modelScore(pid, a.id)
    return d !== 0 ? d : (b.created || 0) - (a.created || 0)
  }

  // T1 tracks the frontier: always re-point it at the best model on offer.
  const top = [...pool].sort(stronger)[0]
  if (top && top.id !== next[LIVE_TIER]) {
    changes.push({
      tier: LIVE_TIER,
      from: next[LIVE_TIER] || '',
      to: top.id,
      reason: next[LIVE_TIER] && served.has(next[LIVE_TIER] as string) ? 'newer model available' : 'was retired',
    })
    next[LIVE_TIER] = top.id
  }

  // T2–T5 keep their pin while the provider still serves it. A dead (or now
  // duplicated) pin is replaced by the closest still-served model that stays
  // BELOW the tier above it — a small step up is fine, a grade jump is not.
  for (let i = 1; i < TIER_KEYS.length; i++) {
    const key = TIER_KEYS[i]
    const pinned = next[key]
    const above = next[TIER_KEYS[i - 1]]
    const ceiling = above ? modelScore(pid, above) : Infinity
    // Ids spoken for by another tier: resolved ones above, still-good pins below.
    const taken = new Set(TIER_KEYS.filter((k) => k !== key).map((k) => next[k]).filter(Boolean) as string[])

    if (pinned && served.has(pinned) && !taken.has(pinned) && modelScore(pid, pinned) < ceiling) continue

    const target = pinned ? modelScore(pid, pinned) : ceiling
    const candidates = pool.filter((m) => !taken.has(m.id) && modelScore(pid, m.id) < ceiling)
    if (!candidates.length) {
      if (pinned) {
        changes.push({ tier: key, from: pinned, to: '', reason: 'retired, no replacement below the tier above' })
        next[key] = ''
      }
      continue
    }
    // Prefer the closest model at or above the retired one's strength, then the
    // closest below it; newest first on a tie.
    const distance = (m: LiveModel) => {
      const sc = modelScore(pid, m.id)
      return sc >= target ? sc - target : target - sc + 1000
    }
    candidates.sort((a, b) => distance(a) - distance(b) || (b.created || 0) - (a.created || 0))
    const pick = candidates[0]
    if (pick.id !== pinned) {
      changes.push({
        tier: key,
        from: pinned || '',
        to: pick.id,
        reason: !pinned ? 'slot filled' : served.has(pinned) ? 'moved up a tier' : 'was retired',
      })
      next[key] = pick.id
    }
  }

  return { catalog: next, changes }
}

// ── update ──────────────────────────────────────────────────────────────────
export const NO_KEY = 'NO_KEY'

/**
 * Read one provider's live model list and re-resolve its five tiers. Throws
 * NO_KEY when that provider has no key on file; network/auth errors surface as
 * themselves so the caller can show them per row.
 */
export async function refreshProvider(pid: AiProvider, key: string): Promise<{ catalog: Catalog; changes: TierChange[]; count: number }> {
  if (!key) throw new Error(NO_KEY)
  const live = await listModels(pid, key)
  const { catalog, changes } = planCatalog(pid, catalogFor(pid), live)
  localStorage.setItem(CATALOG_KEY(pid), JSON.stringify(catalog))
  localStorage.setItem(CHECKED_KEY(pid), String(Date.now()))
  return { catalog, changes, count: live.length }
}
