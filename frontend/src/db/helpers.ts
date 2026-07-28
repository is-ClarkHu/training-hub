// Small shared helpers for the local-first data layer.
import { v4 as uuidv4 } from 'uuid'

/** Client-generated UUID for new rows (SPEC §3). */
export function newId(): string {
  return uuidv4()
}

// Monotonic clock guard. `updated_at` is client-owned and drives both the sync
// watermark and last-write-wins, so a backward wall-clock jump (NTP correction,
// user changing the date) is dangerous: a new write could get a timestamp BELOW
// the push watermark and never sync. We persist the last emitted timestamp and
// never emit one that isn't strictly greater, so client timestamps are monotonic
// across reloads. Trade-off: a clock set far in the FUTURE pins timestamps forward
// until real time catches up — the safe direction (writes still sync; only
// cross-device LWW ordering is affected, which is inherent to client-owned time).
const CLOCK_KEY = 'th.clock.last'

/** Pure monotonic-clock step: never returns a timestamp <= `lastIso`, so a backward
 *  wall-clock jump can't emit a value below the sync watermark. Exported for tests. */
export function nextMonotonicIso(wallMs: number, lastIso: string | null): string {
  const last = lastIso ? Date.parse(lastIso) || 0 : 0
  const ms = wallMs > last ? wallMs : last + 1
  return new Date(ms).toISOString()
}

/** ISO8601 timestamp for `updated_at` (client-controlled, monotonic; last-write-wins). */
export function nowIso(): string {
  let last: string | null = null
  try { last = localStorage.getItem(CLOCK_KEY) } catch { /* no storage */ }
  const iso = nextMonotonicIso(Date.now(), last)
  try { localStorage.setItem(CLOCK_KEY, iso) } catch { /* no storage */ }
  return iso
}

/** Local 'YYYY-MM-DD' for date columns (defaults to today). */
export function today(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
