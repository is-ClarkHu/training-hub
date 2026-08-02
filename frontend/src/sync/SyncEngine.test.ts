// Integration tests for the SyncEngine itself, driven through its public API
// (syncNow / flushToServer). Supabase and Dexie are replaced with in-memory fakes
// that model the real query semantics: the fake `select` applies the same composite
// keyset filter (`.or` / `.gte`) + (updated_at,id) ordering + limit the pull loop
// builds, and the fake `upsert` is an id-keyed put (idempotent, onConflict:id) that
// can enforce a live-name unique index to prove tombstone-before-live ordering.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Row { id: string; updated_at: string; deleted?: boolean; name?: string; val?: string; [k: string]: unknown }

const H = vi.hoisted(() => {
  interface R { id: string; updated_at: string; deleted?: boolean; name?: string; [k: string]: unknown }
  const server = new Map<string, Map<string, R>>()
  const local = new Map<string, Map<string, R>>()
  const ctl = {
    uid: 'u1' as string | null,
    failPush: new Set<string>(),
    failPull: new Set<string>(),
    enforceUniqueName: false,
    hold: null as Promise<void> | null,
    runStarts: [] as string[],
    upserts: [] as { table: string; ids: string[] }[],
    puts: [] as { table: string; id: string }[],
  }
  const tms = (s: string) => Date.parse(s) || 0
  const after = (ts: string, id: string, sTs: string, sId: string) => {
    const a = tms(ts); const b = tms(sTs)
    return a !== b ? a > b : id > sId
  }
  const srv = (t: string) => server.get(t) ?? (server.set(t, new Map()), server.get(t)!)
  const loc = (t: string) => local.get(t) ?? (local.set(t, new Map()), local.get(t)!)

  function doUpsert(table: string, rows: R[]): { error: { message: string } | null } {
    ctl.upserts.push({ table, ids: rows.map((r) => r.id) })
    if (ctl.failPush.has(table)) return { error: { message: `push fail ${table}` } }
    const store = srv(table)
    if (ctl.enforceUniqueName) {
      const sim = new Map(store)
      for (const r of rows) sim.set(r.id, r)
      const live = [...sim.values()].filter((r) => !r.deleted).map((r) => r.name)
      if (new Set(live).size !== live.length) return { error: { message: 'duplicate live name' } }
    }
    for (const r of rows) store.set(r.id, r)
    return { error: null }
  }

  interface Ops { or?: string; gte?: [string, string]; limit?: number }
  function computeSelect(table: string, ops: Ops): { data: R[] | null; error: { message: string } | null } {
    if (ctl.failPull.has(table)) return { data: null, error: { message: `pull fail ${table}` } }
    let rows = [...srv(table).values()]
    if (ops.gte) {
      const v = tms(ops.gte[1])
      rows = rows.filter((r) => tms(r.updated_at) >= v)
    } else if (ops.or) {
      const m = /updated_at\.gt\.([^,]+),and\(updated_at\.eq\.[^,]+,id\.gt\.([^)]+)\)/.exec(ops.or)!
      rows = rows.filter((r) => after(r.updated_at, r.id, m[1], m[2]))
    }
    rows.sort((a, b) => { const d = tms(a.updated_at) - tms(b.updated_at); return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0 })
    if (ops.limit != null) rows = rows.slice(0, ops.limit)
    return { data: rows, error: null }
  }

  const thenable = <T>(fn: () => T) => ({ then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(fn).then(res, rej) })
  function makeBuilder(table: string) {
    const ops: Ops = {}
    const b = {
      or: (s: string) => { ops.or = s; return b },
      gte: (_c: string, v: string) => { ops.gte = ['updated_at', v]; return b },
      order: () => b,
      limit: (n: number) => { ops.limit = n; return b },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(() => computeSelect(table, ops)).then(res, rej),
    }
    return b
  }

  const supabase = {
    from: (table: string) => ({
      upsert: (rows: R[]) => thenable(() => doUpsert(table, rows)),
      select: () => makeBuilder(table),
    }),
  }
  const db = {
    table: (name: string) => ({
      toArray: async (): Promise<R[]> => {
        if (name === 'exercises') { ctl.runStarts.push('start'); if (ctl.hold) await ctl.hold }
        return [...loc(name).values()]
      },
      get: async (id: string): Promise<R | undefined> => loc(name).get(id),
      put: async (row: R): Promise<void> => { ctl.puts.push({ table: name, id: row.id }); loc(name).set(row.id, row) },
    }),
    transaction: async (_mode: string, _t: unknown, cb: () => Promise<void>) => { await cb() },
  }
  const reset = () => {
    server.clear(); local.clear()
    ctl.uid = 'u1'; ctl.failPush.clear(); ctl.failPull.clear()
    ctl.enforceUniqueName = false; ctl.hold = null
    ctl.runStarts.length = 0; ctl.upserts.length = 0; ctl.puts.length = 0
  }
  return { server, local, ctl, supabase, db, reset }
})

vi.mock('../supabase/client', () => ({ supabase: H.supabase, currentUserId: () => H.ctl.uid }))
vi.mock('../db', () => ({ db: H.db }))

// Minimal localStorage for the watermarks (node env has none).
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
;(globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage

const { syncNow, flushToServer } = await import('./SyncEngine')

const BASE = 1_700_000_000_000
const T = (n: number) => new Date(BASE + n).toISOString()
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r }); return { promise, resolve } }

const setServer = (table: string, rows: Row[]) => { const m = new Map<string, Row>(); rows.forEach((r) => m.set(r.id, r)); H.server.set(table, m) }
const setLocal = (table: string, rows: Row[]) => { const m = new Map<string, Row>(); rows.forEach((r) => m.set(r.id, r)); H.local.set(table, m) }
const getLocal = (table: string) => [...(H.local.get(table)?.values() ?? [])] as Row[]
const getServer = (table: string) => [...(H.server.get(table)?.values() ?? [])] as Row[]
const setPushWm = (table: string, ts: string, id: string) => { localStorage.setItem(`th.sync.u1.${table}.push`, ts); localStorage.setItem(`th.sync.u1.${table}.push.id`, id) }
const upsertsFor = (table: string) => H.ctl.upserts.filter((u) => u.table === table).flatMap((u) => u.ids)

beforeEach(() => { H.reset(); localStorage.clear() })

describe('incremental push/pull', () => {
  it('pushes only rows changed since the push watermark', async () => {
    setLocal('sets', [{ id: 'a', updated_at: T(1) }])
    await syncNow()
    expect(upsertsFor('sets')).toEqual(['a'])
    expect(getServer('sets').map((r) => r.id)).toEqual(['a'])

    H.ctl.upserts.length = 0
    setLocal('sets', [{ id: 'a', updated_at: T(1) }, { id: 'b', updated_at: T(2) }])
    await syncNow()
    expect(upsertsFor('sets')).toEqual(['b']) // 'a' not re-pushed
  })

  it('pulls only rows newer than the pull watermark', async () => {
    setServer('sets', [{ id: 'a', updated_at: T(1) }])
    await syncNow()
    expect(getLocal('sets').map((r) => r.id)).toEqual(['a'])

    H.ctl.puts.length = 0
    setServer('sets', [{ id: 'a', updated_at: T(1) }, { id: 'c', updated_at: T(3) }])
    await syncNow()
    expect(H.ctl.puts.filter((p) => p.table === 'sets').map((p) => p.id)).toEqual(['c']) // only the new row applied
  })
})

describe('same timestamp is never skipped', () => {
  it('pulls every row of a same-millisecond tie cluster', async () => {
    setServer('sets', [
      { id: 'a', updated_at: T(5) }, { id: 'b', updated_at: T(5) }, { id: 'c', updated_at: T(5) },
    ])
    await syncNow()
    expect(getLocal('sets').map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('pagination beyond one page (limit 1000)', () => {
  it('drains 2500 distinct-timestamp rows in one sync', async () => {
    const rows: Row[] = Array.from({ length: 2500 }, (_, i) => ({ id: `id${String(i).padStart(4, '0')}`, updated_at: T(i) }))
    setServer('sets', rows)
    const res = await syncNow()
    expect(getLocal('sets').length).toBe(2500)
    expect(res?.pulled).toBe(2500)
  })

  it('drains a 1500-row cluster that all shares ONE timestamp across pages', async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({ id: `id${String(i).padStart(4, '0')}`, updated_at: T(7) }))
    setServer('sets', rows)
    await syncNow()
    expect(getLocal('sets').length).toBe(1500) // no tie dropped at the 1000 boundary
  })
})

describe('tombstone pushed before live row', () => {
  it('replacing a name-unique row (delete old id + create new id, same name) does not trip the live-name index', async () => {
    H.ctl.enforceUniqueName = true
    setServer('exercises', [{ id: 'o', name: 'Squat', deleted: false, updated_at: T(1) }])
    // local: old row tombstoned, new row live with the SAME name
    setLocal('exercises', [
      { id: 'o', name: 'Squat', deleted: true, updated_at: T(2) },
      { id: 'n', name: 'Squat', deleted: false, updated_at: T(3) },
    ])
    const res = await syncNow()
    expect(res?.errors).toEqual([]) // dels-first ordering kept the unique index satisfied
    const live = getServer('exercises').filter((r) => !r.deleted)
    expect(live.map((r) => r.id)).toEqual(['n'])

    // Teeth: the fake really enforces — the reverse (two live 'Squat') is rejected.
    const bad = await H.supabase.from('exercises').upsert([{ id: 'o', name: 'Squat', deleted: false, updated_at: T(4) }] as never)
    expect((bad as { error: unknown }).error).toBeTruthy()
  })
})

describe('last-write-wins on pull', () => {
  it('a newer remote overwrites the local row', async () => {
    setLocal('sets', [{ id: 'x', updated_at: T(1), val: 'old' }])
    setPushWm('sets', T(1), 'x') // already-synced: don't re-push and clobber the newer server row
    setServer('sets', [{ id: 'x', updated_at: T(2), val: 'new' }])
    await syncNow()
    expect(getLocal('sets')[0].val).toBe('new')
  })

  it('a stale remote does NOT overwrite a newer local row', async () => {
    setLocal('sets', [{ id: 'x', updated_at: T(3), val: 'local' }])
    setPushWm('sets', T(3), 'x') // isolate the pull path: don't push
    setServer('sets', [{ id: 'x', updated_at: T(2), val: 'remote' }])
    await syncNow()
    expect(getLocal('sets')[0].val).toBe('local') // kept
  })
})

describe('one table failing does not block the others', () => {
  it('collects the failed table error and still syncs the rest', async () => {
    H.ctl.failPull.add('exercises')
    setServer('sets', [{ id: 'a', updated_at: T(1) }])
    const res = await syncNow()
    expect(res?.errors.some((e) => e.startsWith('pull exercises'))).toBe(true)
    expect(getLocal('sets').map((r) => r.id)).toEqual(['a']) // unaffected
  })
})

describe('concurrent sync calls are serialized', () => {
  it('a second syncNow waits for the in-flight one', async () => {
    const gate = deferred()
    H.ctl.hold = gate.promise
    const p1 = syncNow()
    const p2 = syncNow()
    await tick()
    expect(H.ctl.runStarts.length).toBe(1) // run 2 is queued, not started
    H.ctl.hold = null
    gate.resolve()
    await Promise.all([p1, p2])
    expect(H.ctl.runStarts.length).toBe(2) // run 2 started only after run 1 finished
  })
})

describe('safe retry after a mid-run failure', () => {
  it('a failed push is fully retried, idempotently (no loss, no duplicate)', async () => {
    setLocal('sets', [{ id: 'a', updated_at: T(1) }, { id: 'b', updated_at: T(2) }])
    H.ctl.failPush.add('sets')
    const res1 = await syncNow()
    expect(res1?.errors.some((e) => e.startsWith('push sets'))).toBe(true)
    expect(getServer('sets')).toEqual([]) // nothing committed on failure

    H.ctl.failPush.clear()
    H.ctl.upserts.length = 0
    await syncNow() // watermark was NOT advanced, so both rows retry
    expect(upsertsFor('sets').sort()).toEqual(['a', 'b'])
    expect(getServer('sets').map((r) => r.id).sort()).toEqual(['a', 'b'])

    H.ctl.upserts.length = 0
    await syncNow() // now the watermark is advanced → nothing to push
    expect(upsertsFor('sets')).toEqual([])
  })

  it('a failed pull is retried without dropping or duplicating rows', async () => {
    setServer('sets', [{ id: 'a', updated_at: T(1) }, { id: 'b', updated_at: T(2) }])
    H.ctl.failPull.add('sets')
    await syncNow()
    expect(getLocal('sets')).toEqual([]) // pull failed, cursor not advanced

    H.ctl.failPull.clear()
    await syncNow()
    expect(getLocal('sets').map((r) => r.id).sort()).toEqual(['a', 'b'])
  })
})

describe('flushToServer pushes without pulling', () => {
  it('pushes local rows but applies nothing from the server', async () => {
    setLocal('sets', [{ id: 'a', updated_at: T(1) }])
    setServer('sets', [{ id: 'z', updated_at: T(9) }]) // would be pulled by a full sync
    const res = await flushToServer()
    expect(getServer('sets').map((r) => r.id).sort()).toEqual(['a', 'z']) // 'a' pushed up
    expect(getLocal('sets').map((r) => r.id)).toEqual(['a']) // 'z' NOT pulled down
    expect(res?.pulled).toBe(0)
  })
})
