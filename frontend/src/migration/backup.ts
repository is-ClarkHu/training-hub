// Full data export / import (SPEC §7.8). Export dumps every local table to a JSON
// backup file; import restores it (bulkPut, id-stable so re-import is safe). The
// SyncEngine then pushes restored rows to Supabase like any other local change.
import { db, nowIso } from '../db'
import { currentUserId } from '../supabase/client'
import type { TableName } from '../supabase/types'

const TABLES: TableName[] = [
  'exercises', 'workout_entries', 'sets', 'sports', 'sport_sessions', 'profile',
  'injuries', 'training_cycle', 'optional_trackers', 'translation_dictionary',
  'chat_messages', 'insights',
]

export interface Backup {
  version: number
  exported_at: string
  tables: Record<string, unknown[]>
}

export async function exportAll(): Promise<Blob> {
  const tables: Record<string, unknown[]> = {}
  for (const t of TABLES) tables[t] = await db.table(t).toArray()
  const backup: Backup = { version: 1, exported_at: new Date().toISOString(), tables }
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
}

/** Trigger a browser download of the full backup. */
export async function downloadBackup(): Promise<void> {
  const blob = await exportAll()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `training-hub-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

type Row = Record<string, unknown>

/** Dedup a name-unique library table (exercises / sports) against the live rows
 *  already in the store: same name_zh → reuse the existing id, drop the incoming
 *  duplicate. Returns a map of dropped-id → kept-id to repoint referencing rows,
 *  so importing never violates the (user_id, name_zh) unique constraint. */
async function dedupByName(table: 'exercises' | 'sports', tables: Record<string, unknown[]>): Promise<Record<string, string>> {
  const rows = tables[table]
  if (!Array.isArray(rows)) return {}
  const existing = (await db.table(table).toArray()) as Row[]
  const liveByName = new Map<string, string>()
  for (const r of existing) if (!r.deleted && typeof r.name_zh === 'string') liveByName.set(r.name_zh, r.id as string)
  const remap: Record<string, string> = {}
  const kept: Row[] = []
  for (const r of rows as Row[]) {
    const name = String(r.name_zh ?? '')
    const keepId = liveByName.get(name)
    if (keepId && keepId !== r.id) {
      remap[r.id as string] = keepId // point references at the row we keep
    } else {
      liveByName.set(name, r.id as string)
      kept.push(r)
    }
  }
  tables[table] = kept
  return remap
}

export async function importBackup(json: string): Promise<{ imported: number; tables: number }> {
  const parsed = JSON.parse(json) as Backup | Record<string, unknown[]>
  const tables = 'tables' in parsed ? (parsed as Backup).tables : (parsed as Record<string, unknown[]>)

  // Merge same-named exercises/sports into the existing library, then repoint the
  // referencing rows, so a re-import (or importing into an account that already has
  // some of these) doesn't collide on the name-unique index.
  const exRemap = await dedupByName('exercises', tables)
  const spRemap = await dedupByName('sports', tables)
  const repoint = (t: string, key: string, map: Record<string, string>) => {
    const rows = tables[t]
    if (!Array.isArray(rows)) return
    for (const r of rows as Row[]) {
      const v = r[key]
      if (typeof v === 'string' && map[v]) r[key] = map[v]
    }
  }
  repoint('workout_entries', 'exercise_id', exRemap)
  repoint('sport_sessions', 'sport_id', spRemap)

  // Claim every restored row for the logged-in user and bump updated_at, so a backup
  // (or the legacy-migration export, whose user_id is blank) belongs to whoever
  // imports it and gets pushed to their Supabase. RLS would reject a foreign user_id.
  const uid = currentUserId() ?? ''
  const ts = nowIso()
  let imported = 0
  let tableCount = 0
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      const rows = tables[t]
      if (Array.isArray(rows) && rows.length) {
        const claimed = (rows as Row[]).map((r) => ({ ...r, user_id: uid, updated_at: ts }))
        await db.table(t).bulkPut(claimed)
        imported += rows.length
        tableCount += 1
      }
    }
  })
  return { imported, tables: tableCount }
}
