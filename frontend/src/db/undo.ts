// Generic undo for Dexie mutations. Snapshot the involved tables before and
// after a mutation, diff them, and build a reverse operation:
//   • a row that CHANGED  → restore the previous row
//   • a row that was CREATED → soft-delete it (deleted:true tombstone, so sync
//     removes the remote copy too)
//   • a row that was HARD-deleted → put the previous row back
// Undo bumps updated_at to now so the sync engine treats the restore as the
// newest version (last-write-wins). Data volumes are personal, so snapshotting
// whole tables per op is cheap. Category CRUD lives in localStorage, not Dexie —
// see snapshotCategories() in ../categories.
import { db } from './db'
import { nowIso } from './helpers'

type Row = { id: string; updated_at?: string }

async function snapshot(tables: string[]): Promise<Map<string, Map<string, Row>>> {
  const out = new Map<string, Map<string, Row>>()
  for (const t of tables) {
    const rows = (await db.table(t).toArray()) as Row[]
    out.set(t, new Map(rows.map((r) => [r.id, r])))
  }
  return out
}

/**
 * Run `fn`, then return its result plus an `undo()` that reverses every row it
 * changed across `tables`. Pass every table the mutation can touch.
 */
export async function withUndo<T>(
  tables: string[],
  fn: () => Promise<T>,
): Promise<{ result: T; undo: () => Promise<void> }> {
  const before = await snapshot(tables)
  const result = await fn()
  const after = await snapshot(tables)

  const restore: Array<{ table: string; row: Row }> = []
  const created: Array<{ table: string; id: string }> = []
  for (const t of tables) {
    const b = before.get(t)!
    const a = after.get(t)!
    for (const [id, arow] of a) {
      const brow = b.get(id)
      if (!brow) created.push({ table: t, id })
      else if (JSON.stringify(brow) !== JSON.stringify(arow)) restore.push({ table: t, row: brow })
    }
    for (const [id, brow] of b) {
      if (!a.has(id)) restore.push({ table: t, row: brow })
    }
  }

  const undo = async () => {
    const ts = nowIso()
    await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
      for (const { table, row } of restore) await db.table(table).put({ ...row, updated_at: ts })
      for (const { table, id } of created) {
        const cur = await db.table(table).get(id)
        if (cur) await db.table(table).put({ ...cur, deleted: true, updated_at: ts })
      }
    })
  }

  return { result, undo }
}
