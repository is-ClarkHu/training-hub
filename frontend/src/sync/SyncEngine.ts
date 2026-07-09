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
  'optional_trackers',
  'translation_dictionary',
  'chat_messages',
  'insights',
]

const EPOCH = '1970-01-01T00:00:00.000Z'
const wmKey = (uid: string, table: string, kind: 'push' | 'pull') => `th.sync.${uid}.${table}.${kind}`
const getWm = (uid: string, t: string, k: 'push' | 'pull') => localStorage.getItem(wmKey(uid, t, k)) ?? EPOCH
const setWm = (uid: string, t: string, k: 'push' | 'pull', v: string) => localStorage.setItem(wmKey(uid, t, k), v)

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
  is_default: false, verified: false, per_side: false, duration_hm: false,
  name_en: '', rehab_purpose_zh: '', rehab_purpose_en: '', rehab_cues_zh: '',
  rehab_cues_en: '', rehab_dosage: '', display_mode: 'circle',
  body_parts: [], sub_sets: [], fields: [], attributes: {}, completed_labels: [],
  days: [], note_tags: [],
}

async function pushTable(uid: string, table: TableName): Promise<number> {
  const since = getWm(uid, table, 'push')
  const all = (await db.table(table).toArray()) as Row[]
  const rows = all.filter((r) => r.updated_at > since)
  if (rows.length === 0) return 0
  const payload: Row[] = rows.map((r) => ({ ...r, user_id: uid })) // stamp owner for RLS
  const union = new Set<string>()
  for (const r of payload) for (const k of Object.keys(r)) union.add(k)
  for (const r of payload) {
    for (const k of union) {
      if (r[k] == null) r[k] = k in COLUMN_DEFAULTS ? COLUMN_DEFAULTS[k] : null
    }
  }
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await supabase.from(table).upsert(payload.slice(i, i + 500), { onConflict: 'id' })
    if (error) throw error
  }
  setWm(uid, table, 'push', rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), since))
  return rows.length
}

async function pullTable(uid: string, table: TableName): Promise<number> {
  const since = getWm(uid, table, 'pull')
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
    .limit(1000)
  if (error) throw error
  const remote = (data ?? []) as Row[]
  if (remote.length === 0) return 0
  await db.transaction('rw', db.table(table), async () => {
    for (const r of remote) {
      const local = (await db.table(table).get(r.id)) as Row | undefined
      if (!local || r.updated_at > local.updated_at) await db.table(table).put(r) // last-write-wins
    }
  })
  setWm(uid, table, 'pull', remote.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), since))
  return remote.length
}

let running = false

export interface SyncResult {
  pushed: number
  pulled: number
  errors: string[]
}

/** One push+pull pass across all tables. No-op when signed out or already running.
 *  A single table's failure (e.g. a Supabase column missing) no longer aborts the
 *  whole run — the error is collected and the other tables still sync. */
export async function syncNow(): Promise<SyncResult | null> {
  const uid = currentUserId()
  if (!uid || running) return null
  running = true
  const errors: string[] = []
  try {
    let pushed = 0
    let pulled = 0
    for (const t of TABLES) {
      try {
        pushed += await pushTable(uid, t)
      } catch (e) {
        errors.push(`push ${t}: ${errorMessage(e)}`)
      }
    }
    for (const t of TABLES) {
      try {
        pulled += await pullTable(uid, t)
      } catch (e) {
        errors.push(`pull ${t}: ${errorMessage(e)}`)
      }
    }
    return { pushed, pulled, errors }
  } finally {
    running = false
  }
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
