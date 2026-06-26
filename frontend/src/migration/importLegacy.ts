// In-app legacy import (SPEC §10): parsed drafts → Dexie. Uses bulkPut with the
// parser's stable ids, so re-importing upserts instead of duplicating. The
// SyncEngine pushes the imported rows to Supabase like any other local change.
import { db, nowIso } from '../db'
import { currentUserId } from '../supabase/client'
import { parseLegacyCsv, type ParseResult } from './parseLegacy'

function stamp<T extends object>(rows: T[]): (T & { user_id: string; updated_at: string })[] {
  const uid = currentUserId() ?? ''
  const ts = nowIso()
  return rows.map((r) => ({ ...r, user_id: uid, updated_at: ts }))
}

export async function importLegacy(result: ParseResult): Promise<ParseResult['report']> {
  await db.transaction(
    'rw',
    db.exercises,
    db.workout_entries,
    db.sets,
    db.sports,
    db.sport_sessions,
    async () => {
      await db.exercises.bulkPut(stamp(result.exercises))
      await db.workout_entries.bulkPut(stamp(result.entries))
      await db.sets.bulkPut(stamp(result.sets))
      await db.sports.bulkPut(stamp(result.sports))
      await db.sport_sessions.bulkPut(stamp(result.sportSessions))
    },
  )
  return result.report
}

/** Parse a raw CSV string and import it. */
export async function importLegacyCsv(csv: string): Promise<ParseResult['report']> {
  return importLegacy(parseLegacyCsv(csv))
}
