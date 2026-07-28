// Pure sync-cursor logic, extracted so it is unit-testable without a Supabase or
// Dexie mock. SyncEngine imports the comparison helpers from here (single source of
// truth); the `pageAfter` / `drain` simulators below model the exact server query
// the pull loop runs (`.or`/`.gte` + order (updated_at,id) + limit), so tests can
// prove the keyset pagination never skips or duplicates a row across tie clusters.
//
// The sync cursor is the composite (updated_at, id), a strict total order. A bare
// updated_at cursor with `.gt` silently drops rows sharing the boundary timestamp.

/** Epoch ms for an ISO timestamp. Robust to `…Z` (local rows) vs `…+00:00`
 *  (PostgREST-returned rows) — never compare those as strings. */
export const tms = (iso: string): number => Date.parse(iso) || 0

/** LWW test: is `a` strictly newer than `b`? */
export const isNewer = (a: string, b: string): boolean => tms(a) > tms(b)

/** Is (ts,id) strictly after the cursor (sinceTs,sinceId)? id breaks ms ties. */
export function afterCursor(ts: string, id: string, sinceTs: string, sinceId: string): boolean {
  const a = tms(ts)
  const b = tms(sinceTs)
  return a !== b ? a > b : id > sinceId
}

export interface Keyed { updated_at: string; id: string }
export interface Cursor { ts: string; id: string }

/** Sort by the composite cursor order (updated_at asc, then id asc). */
export function byCursor<T extends Keyed>(rows: T[]): T[] {
  return [...rows].sort((x, y) => {
    const d = tms(x.updated_at) - tms(y.updated_at)
    return d !== 0 ? d : x.id < y.id ? -1 : x.id > y.id ? 1 : 0
  })
}

/**
 * Model the single server page the pull loop fetches. Mirrors pullTable exactly:
 *  - empty id cursor (fresh / legacy pre-composite watermark) → `.gte(updated_at)`
 *    (re-includes boundary ties so none are lost; `id.gt.''` would crash on a uuid cast);
 *  - otherwise the composite `(updated_at > ts) OR (updated_at = ts AND id > id)`.
 * Then order by (updated_at,id) and take `page`.
 */
export function pageAfter<T extends Keyed>(rows: T[], cur: Cursor, page: number): T[] {
  const sorted = byCursor(rows)
  const filtered =
    cur.id === ''
      ? sorted.filter((r) => tms(r.updated_at) >= tms(cur.ts))
      : sorted.filter((r) => afterCursor(r.updated_at, r.id, cur.ts, cur.id))
  return filtered.slice(0, page)
}

/**
 * Run the whole pull loop against an in-memory dataset: fetch pages via `pageAfter`,
 * advancing the cursor to each page's last row, until a short page. Returns every
 * row the loop would apply, in fetch order. `guard` caps iterations to catch a
 * non-terminating loop instead of hanging the test.
 */
export function drain<T extends Keyed>(rows: T[], page: number, start: Cursor, guard = 10_000): T[] {
  const out: T[] = []
  let cur = start
  for (let i = 0; i < guard; i++) {
    const got = pageAfter(rows, cur, page)
    if (got.length === 0) return out
    out.push(...got)
    const last = got[got.length - 1]
    cur = { ts: last.updated_at, id: last.id }
    if (got.length < page) return out
  }
  throw new Error('drain did not terminate')
}

/** Push selection: local rows strictly after the push cursor. */
export function selectPush<T extends Keyed>(rows: T[], cur: Cursor): T[] {
  return rows.filter((r) => afterCursor(r.updated_at, r.id, cur.ts, cur.id))
}

/** The composite-max cursor of a non-empty row set (where the push watermark lands). */
export function maxCursor<T extends Keyed>(rows: T[]): Cursor {
  const m = rows.reduce((acc, r) => (afterCursor(r.updated_at, r.id, acc.updated_at, acc.id) ? r : acc), rows[0])
  return { ts: m.updated_at, id: m.id }
}
