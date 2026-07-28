// SyncEngine (SPEC §3, §12): reconciles the local Dexie store with Supabase via
// supabase-js. Local-first — all reads/writes hit Dexie; this pushes changed rows
// and pulls remote changes in the background. Last-write-wins by updated_at.
//
// Watermarks (per user + table) are kept in localStorage: a push high-water and a
// pull high-water (the max updated_at seen in each direction). RLS scopes every
// query to the current user, so we never see other users' rows.
import { supabase, currentUserId } from '../supabase/client'
import { db } from '../db'
import type { TableName } from '../supabase/types'
import { tms, isNewer, afterCursor } from './cursor'

// Push respects FK order (exercises/injuries before entries; entries before sets;
// sports before sport_sessions). Pull order is irrelevant (Dexie has no FKs).
const TABLES: TableName[] = [
  'exercises',
  'injuries',
  'workout_entries',
  'sets',
  'sports',
  'sport_sessions',
  'profile',
  'training_cycle',
  'cycle_rounds',
  'entry_cycle_assignments',
  'optional_trackers',
  'translation_dictionary',
  'chatrooms',
  'chatroom_summaries',
  'chatroom_memories',
  'chatroom_memory_access',
  'basics',
  'body_measurements',
  'notes',
  'supplements',
  'training_env',
  'medical_background',
  'food_log',
  'public_files',
  'chatroom_file_access',
  'chat_messages',
  'insights',
]

const EPOCH = '1970-01-01T00:00:00.000Z'
type Kind = 'push' | 'pull'
// The sync cursor is the composite (updated_at, id), not updated_at alone. A bare
// updated_at watermark with `.gt(updated_at)` silently DROPS rows that share the
// boundary timestamp — likely whenever a bulk op (cascade delete, legacy import)
// stamps many rows the same millisecond, or a page break lands inside such a tie.
// (updated_at, id) is a strict total order, so paging/resuming never skips a tie.
const wmKey = (uid: string, table: string, kind: Kind) => `th.sync.${uid}.${table}.${kind}`
const wmIdKey = (uid: string, table: string, kind: Kind) => `th.sync.${uid}.${table}.${kind}.id`
const getWm = (uid: string, t: string, k: Kind) => localStorage.getItem(wmKey(uid, t, k)) ?? EPOCH
const getWmId = (uid: string, t: string, k: Kind) => localStorage.getItem(wmIdKey(uid, t, k)) ?? ''
const setWm = (uid: string, t: string, k: Kind, ts: string, id: string) => {
  // Write the id first: if we crash between the two, an id ahead of its timestamp
  // only re-includes rows (harmless, idempotent) — never skips them.
  localStorage.setItem(wmIdKey(uid, t, k), id)
  localStorage.setItem(wmKey(uid, t, k), ts)
}

// Composite-cursor comparison helpers (tms/isNewer/afterCursor) live in ./cursor,
// where they are unit-tested against the keyset pagination model.

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const r = e as Record<string, unknown>
    return [r.message, r.code, r.details, r.hint].filter(Boolean).join(' | ') || JSON.stringify(r)
  }
  return String(e)
}

interface Row {
  id: string
  updated_at: string
  [k: string]: unknown
}

// Defaults for NOT-NULL columns. Supabase bulk-upsert builds one INSERT whose
// columns are the UNION of keys across the batch, so a row that omits (or nulls)
// a key gets NULL for it — tripping NOT-NULL constraints on older/partial rows.
// We homogenize every row to that union, filling absent/null values: a known
// NOT-NULL column gets its default, anything else stays null (safe for nullable
// columns; required columns like measure_type/date are always present anyway).
const COLUMN_DEFAULTS: Record<string, unknown> = {
  deleted: false, assisted: false, is_custom: false, name_locked: false,
  needs_translation: false, default_per_side: false, is_warmup: false, is_rehab: false,
  is_superset: false, needs_review: false, active: false, injury: false, skipped: false,
  is_default: false, verified: false, per_side: false, duration_hm: false, bodyweight: false,
  name_en: '', rehab_purpose_zh: '', rehab_purpose_en: '', rehab_cues_zh: '',
  rehab_cues_en: '', rehab_dosage: '', display_mode: 'circle',
  body_parts: [], sub_sets: [], fields: [], attributes: {}, completed_labels: [],
  days: [], note_tags: [],
}

async function pushTable(uid: string, table: TableName): Promise<number> {
  const sinceTs = getWm(uid, table, 'push')
  const sinceId = getWmId(uid, table, 'push')
  const all = (await db.table(table).toArray()) as Row[]
  const rows = all.filter((r) => afterCursor(r.updated_at, r.id, sinceTs, sinceId))
  if (rows.length === 0) return 0
  const payload: Row[] = rows.map((r) => ({ ...r, user_id: uid })) // stamp owner for RLS
  const union = new Set<string>()
  for (const r of payload) for (const k of Object.keys(r)) union.add(k)
  for (const r of payload) {
    for (const k of union) {
      if (r[k] == null) r[k] = k in COLUMN_DEFAULTS ? COLUMN_DEFAULTS[k] : null
    }
  }
  // Push tombstones BEFORE live rows: renaming/replacing a name-unique row (e.g. an
  // exercise) yields a deleted old row + a live new row with the SAME name. Applying
  // the delete first avoids a transient collision on a partial unique index
  // (…_name_zh_uniq WHERE not deleted) when both land in one upsert statement.
  // Within each group apply oldest edit first: a "rename A→D then C→A" chain must
  // free the name before it is reused. Edit order (updated_at) is a valid order
  // because the rename guard forbids ever holding two live rows with one name.
  const byTime = (a: Row, b: Row) => (tms(a.updated_at) < tms(b.updated_at) ? -1 : tms(a.updated_at) > tms(b.updated_at) ? 1 : 0)
  const dels = payload.filter((r) => r.deleted === true).sort(byTime)
  const lives = payload.filter((r) => r.deleted !== true).sort(byTime)
  for (const group of [dels, lives]) {
    for (let i = 0; i < group.length; i += 500) {
      const { error } = await supabase.from(table).upsert(group.slice(i, i + 500), { onConflict: 'id' })
      if (error) throw error // watermark not advanced → whole diff re-pushed next pass (upsert is idempotent)
    }
  }
  // Advance to the composite-max of what we pushed, only after every batch succeeded.
  const max = rows.reduce((m, r) => (afterCursor(r.updated_at, r.id, m.updated_at, m.id) ? r : m), rows[0])
  setWm(uid, table, 'push', max.updated_at, max.id)
  return rows.length
}

const PAGE = 1000

async function pullTable(uid: string, table: TableName): Promise<number> {
  let cursorTs = getWm(uid, table, 'pull')
  let cursorId = getWmId(uid, table, 'pull')
  let total = 0
  // Keyset pagination: keep pulling pages until one comes back short. Each page is
  // ordered by (updated_at, id) and fetched with a composite `>` cursor, so a table
  // with >PAGE changed rows drains fully in one call and a tie split across a page
  // boundary is never skipped.
  for (;;) {
    let q = supabase
      .from(table)
      .select('*')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE)
    if (cursorId === '') {
      // Fresh or legacy (pre-composite) watermark with no id yet. `id.gt.''` would
      // make Postgres cast '' to uuid and error, so use `>=` on the timestamp: it
      // re-includes rows exactly at the boundary (LWW makes the re-apply a no-op)
      // and thereby recovers any ties the old `.gt(updated_at)` cursor had skipped.
      q = q.gte('updated_at', cursorTs)
    } else {
      // (updated_at > cursorTs) OR (updated_at == cursorTs AND id > cursorId)
      q = q.or(`updated_at.gt.${cursorTs},and(updated_at.eq.${cursorTs},id.gt.${cursorId})`)
    }
    const { data, error } = await q
    if (error) throw error
    const remote = (data ?? []) as Row[]
    if (remote.length === 0) break
    await db.transaction('rw', db.table(table), async () => {
      for (const r of remote) {
        const local = (await db.table(table).get(r.id)) as Row | undefined
        if (!local || isNewer(r.updated_at, local.updated_at)) await db.table(table).put(r) // last-write-wins
      }
    })
    // Advance the cursor only after this page is committed to Dexie; a throw above
    // leaves it where the last good page ended, so the pull safely resumes there.
    const last = remote[remote.length - 1]
    cursorTs = last.updated_at
    cursorId = last.id
    setWm(uid, table, 'pull', cursorTs, cursorId)
    total += remote.length
    if (remote.length < PAGE) break
  }
  return total
}

export interface SyncResult {
  pushed: number
  pulled: number
  errors: string[]
}

async function runSync(uid: string, pushOnly: boolean): Promise<SyncResult> {
  const errors: string[] = []
  let pushed = 0
  let pulled = 0
  for (const t of TABLES) {
    try {
      pushed += await pushTable(uid, t)
    } catch (e) {
      errors.push(`push ${t}: ${errorMessage(e)}`)
    }
  }
  if (!pushOnly) {
    for (const t of TABLES) {
      try {
        pulled += await pullTable(uid, t)
      } catch (e) {
        errors.push(`pull ${t}: ${errorMessage(e)}`)
      }
    }
  }
  return { pushed, pulled, errors }
}

// Serialized queue. The old guard made a call a no-op while another was running,
// which broke "await syncNow() before I read from the server": a caller couldn't
// know its just-written rows had actually been pushed. Chaining instead means each
// call waits for the in-flight run and then does its own fresh pass, so an awaited
// call always reflects local state written before it.
let chain: Promise<unknown> = Promise.resolve()

function enqueue(pushOnly: boolean): Promise<SyncResult | null> {
  const run = chain.then(async (): Promise<SyncResult | null> => {
    const uid = currentUserId()
    if (!uid) return null
    return runSync(uid, pushOnly)
  })
  chain = run.catch(() => {}) // keep the queue alive past a failed run
  return run
}

/** One push+pull pass across all tables (queued behind any in-flight sync).
 *  A single table's failure (e.g. a Supabase column missing) no longer aborts the
 *  whole run — the error is collected and the other tables still sync. */
export function syncNow(): Promise<SyncResult | null> {
  return enqueue(false)
}

/** Push local changes up (no pull), queued. Await this before a server-side read
 *  that must see local writes — e.g. the AI assistant reads your perms + training
 *  data from Supabase, so a just-toggled permission has to be pushed first. */
export function flushToServer(): Promise<SyncResult | null> {
  return enqueue(true)
}

/** Start background sync: now, on focus, on `online`, and every `intervalMs` (§3). */
export function startSync(intervalMs = 120_000): () => void {
  void syncNow().catch(() => {})
  const kick = () => void syncNow().catch(() => {})
  window.addEventListener('online', kick)
  window.addEventListener('focus', kick)
  const id = window.setInterval(kick, intervalMs)
  return () => {
    window.removeEventListener('online', kick)
    window.removeEventListener('focus', kick)
    window.clearInterval(id)
  }
}

/** Clear sync watermarks (call on logout — local data was wiped, §3). */
export function clearSyncState(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && k.startsWith('th.sync.')) localStorage.removeItem(k)
  }
}
