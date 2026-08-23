// Shared helpers for the demo seeder. Runs under `node --experimental-strip-types`
// (Node 22+), so: plain TS only (no enums/namespaces), .ts import extensions.
export const rid = (): string => crypto.randomUUID()
export const nowIso = (): string => new Date().toISOString()

// Anchor everything to the run date so a daily re-seed always looks current: the
// most recent workout is "today", measurements trend up to now, etc.
export const TODAY: Date = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d })()

export function addDays(d: Date, n: number): Date {
  const c = new Date(d); c.setDate(c.getDate() + n); return c
}
/** Local YYYY-MM-DD (date columns). */
export function ymd(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
/** ISO timestamp at a given hour on a date (timestamptz columns). */
export function atTime(d: Date, h: number, m = 0): string {
  const c = new Date(d); c.setHours(h, m, 0, 0); return c.toISOString()
}
/** Deterministic-ish jitter helper (not seeded — variety only, re-rolled daily). */
export function rand(min: number, max: number): number { return min + Math.random() * (max - min) }
export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
export function round(n: number, step = 1): number { return Math.round(n / step) * step }

// Storage buckets are folder-per-user (path: <uid>/…), but the uid isn't known until
// sign-in while data is assembled up front. Rows/assets embed this token in their
// path and the orchestrator swaps in the real uid at insert/upload time.
export const UID_TOKEN = '__UID__'
export interface Asset { bucket: string; path: string; body: Buffer | string; contentType: string }

/** Sync-field defaults applied to every row at insert time. `user_id` is stamped by
 *  the client once the demo session is known. */
export interface SyncStamp { user_id: string; updated_at: string; deleted: boolean }
export function stamp<T extends object>(rows: T[], userId: string): (T & SyncStamp)[] {
  const at = nowIso()
  return rows.map((r) => ({ deleted: false, updated_at: at, ...r, user_id: userId } as T & SyncStamp))
}
