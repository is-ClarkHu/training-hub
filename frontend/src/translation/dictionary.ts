// Local translation-dictionary cache (SPEC §5.1), backed by Dexie. The dictionary
// is the self-learning store: every resolved term lives here and syncs across
// devices like any other table.
import { db } from '../db'
import type { TranslationDictionaryRow, TranslationDomain } from '../supabase/types'

export type TranslationTarget = 'en' | 'zh'

/** Find a cached translation for `source` in the given domain, or undefined. */
export async function lookup(
  domain: TranslationDomain,
  source: string,
  target: TranslationTarget,
): Promise<TranslationDictionaryRow | undefined> {
  if (target === 'en') {
    // source is zh → use the [domain+zh] compound index
    const row = await db.translation_dictionary.where('[domain+zh]').equals([domain, source]).first()
    return row && !row.deleted ? row : undefined
  }
  // source is en → no compound index on en; scan this domain (small per user)
  const rows = await db.translation_dictionary.where('domain').equals(domain).toArray()
  return rows.find((r) => !r.deleted && r.en === source)
}

/** Mirror a dictionary row into the local cache (id-stable with Supabase). */
export async function cacheRow(row: TranslationDictionaryRow): Promise<void> {
  await db.translation_dictionary.put(row)
}
