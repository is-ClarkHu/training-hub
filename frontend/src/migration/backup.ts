// Full data export / import (SPEC §7.8). Export dumps every local table to a JSON
// backup file; import restores it (bulkPut, id-stable so re-import is safe). The
// SyncEngine then pushes restored rows to Supabase like any other local change.
import { db } from '../db'
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

export async function importBackup(json: string): Promise<{ imported: number; tables: number }> {
  const parsed = JSON.parse(json) as Backup | Record<string, unknown[]>
  const tables = 'tables' in parsed ? (parsed as Backup).tables : (parsed as Record<string, unknown[]>)
  let imported = 0
  let tableCount = 0
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      const rows = tables[t]
      if (Array.isArray(rows) && rows.length) {
        await db.table(t).bulkPut(rows)
        imported += rows.length
        tableCount += 1
      }
    }
  })
  return { imported, tables: tableCount }
}
