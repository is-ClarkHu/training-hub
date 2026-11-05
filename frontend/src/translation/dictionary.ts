// Local translation-dictionary cache (SPEC §5.1), backed by Dexie. The dictionary
// is the self-learning store: every resolved term lives here and syncs across
// devices like any other table.
//
// Postgres enforces one LIVE row per (user_id, domain, zh) —
// `translation_dictionary_uniq … where (not deleted)`. Dexie enforces nothing, so
// that invariant has to be kept here: a second live row for a term pushes fine
// locally and then fails the whole table's sync with a 23505, which wedges every
// later push of this table until the duplicate is gone.
import { db } from '../db'
import { nowIso } from '../db/helpers'
import type { TranslationDictionaryRow, TranslationDomain } from '../supabase/types'

export type TranslationTarget = 'en' | 'zh'

/** Group key for one term. NUL can't occur in a domain or a user's text, so it is
 *  a separator that cannot be forged — written as an escape, never as a raw byte
 *  (a literal NUL in the source makes git treat the whole file as binary). */
const termKey = (domain: string, zh: string): string => `${domain}\u0000${zh}`

/** Live rows for one term, newest first. A tombstone for the same term is ignored:
 *  it is outside the server's partial unique index and must not shadow a live row
 *  (when it did, every lookup missed and minted yet another duplicate). */
async function liveRows(domain: TranslationDomain, zh: string): Promise<TranslationDictionaryRow[]> {
  const rows = await db.translation_dictionary.where('[domain+zh]').equals([domain, zh]).toArray()
  return rows.filter((r) => !r.deleted).sort(byPreference)
}

/** Which duplicate survives a collapse: a user-verified row beats an unverified one
 *  (the schema protects `verified` from AI overwrite), then the most recent edit,
 *  then id so the choice is stable across devices. */
export function byPreference(a: TranslationDictionaryRow, b: TranslationDictionaryRow): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/** Find a cached translation for `source` in the given domain, or undefined. */
export async function lookup(
  domain: TranslationDomain,
  source: string,
  target: TranslationTarget,
): Promise<TranslationDictionaryRow | undefined> {
  if (target === 'en') {
    // source is zh → use the [domain+zh] compound index
    return (await liveRows(domain, source))[0]
  }
  // source is en → no compound index on en; scan this domain (small per user)
  const rows = await db.translation_dictionary.where('domain').equals(domain).toArray()
  return rows.filter((r) => !r.deleted && r.en === source).sort(byPreference)[0]
}

/**
 * Mirror a dictionary row into the local cache, keyed by the TERM rather than by
 * the row id. Callers mint a fresh id for every AI result, so writing by id would
 * add a second live row for a term that already has one — exactly what the server
 * rejects. Reusing the existing row's id makes a re-translation an update.
 *
 * A user-verified row is never overwritten by an unverified one. `verified` is the
 * schema's "the user confirmed this, AI must not touch it" flag; before this wrote
 * by term, an AI re-translation landed as a separate row and the verified one
 * survived by accident. Writing by term would have clobbered it, so the rule is
 * explicit now.
 */
export function mayReplace(
  existing: TranslationDictionaryRow | undefined,
  incoming: TranslationDictionaryRow,
): boolean {
  return !(existing?.verified && !incoming.verified)
}

export async function cacheRow(row: TranslationDictionaryRow): Promise<void> {
  const existing = (await liveRows(row.domain, row.zh))[0]
  if (!mayReplace(existing, row)) return
  await db.translation_dictionary.put(existing ? { ...row, id: existing.id } : row)
}

/**
 * Collapse any term that already has more than one live row: keep the preferred
 * one, tombstone the rest. Heals dictionaries that duplicated before cacheRow
 * wrote by term. Returns how many rows were tombstoned.
 *
 * Tombstones carry a fresh `updated_at` so the next push picks them up, and the
 * sync engine pushes deletes before live rows, so the server's partial unique
 * index is free by the time the survivor lands.
 */
export async function dedupeDictionary(): Promise<number> {
  const all = await db.translation_dictionary.toArray()
  const groups = new Map<string, TranslationDictionaryRow[]>()
  for (const r of all) {
    if (r.deleted) continue
    const key = termKey(r.domain, r.zh)
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  const losers: TranslationDictionaryRow[] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    losers.push(...g.sort(byPreference).slice(1))
  }
  if (losers.length === 0) return 0
  const stamp = nowIso()
  await db.translation_dictionary.bulkPut(losers.map((r) => ({ ...r, deleted: true, updated_at: stamp })))
  return losers.length
}
