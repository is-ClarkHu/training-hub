// Which duplicate survives when a term ended up with more than one live row.
// Postgres allows exactly one (`translation_dictionary_uniq … where not deleted`),
// so this ordering decides what gets pushed and what gets tombstoned.
import { describe, it, expect } from 'vitest'
import { byPreference, mayReplace } from './dictionary'
import type { TranslationDictionaryRow } from '../supabase/types'

const row = (p: Partial<TranslationDictionaryRow>): TranslationDictionaryRow =>
  ({
    id: 'a', user_id: 'u', domain: 'exercise', zh: '卧推', en: 'Bench press',
    source: 'ai', verified: false, updated_at: '2026-01-01T00:00:00.000Z', deleted: false,
    ...p,
  }) as TranslationDictionaryRow

const winner = (...rows: TranslationDictionaryRow[]) => [...rows].sort(byPreference)[0]

describe('byPreference', () => {
  it('keeps the user-verified row over a newer AI one', () => {
    const user = row({ id: 'u1', verified: true, source: 'user', updated_at: '2026-01-01T00:00:00.000Z' })
    const ai = row({ id: 'a1', verified: false, source: 'ai', updated_at: '2026-06-01T00:00:00.000Z' })
    expect(winner(user, ai).id).toBe('u1')
    expect(winner(ai, user).id).toBe('u1')
  })

  it('otherwise keeps the most recent edit', () => {
    const older = row({ id: 'o', updated_at: '2026-01-01T00:00:00.000Z' })
    const newer = row({ id: 'n', updated_at: '2026-06-01T00:00:00.000Z' })
    expect(winner(older, newer).id).toBe('n')
    expect(winner(newer, older).id).toBe('n')
  })

  it('breaks a dead tie by id, so two devices collapse to the same survivor', () => {
    const a = row({ id: 'aaa' })
    const b = row({ id: 'bbb' })
    expect(winner(a, b).id).toBe('aaa')
    expect(winner(b, a).id).toBe('aaa')
  })

  it('orders a whole group: verified first, then newest', () => {
    const rows = [
      row({ id: 'old-ai', updated_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'verified', verified: true, updated_at: '2026-02-01T00:00:00.000Z' }),
      row({ id: 'new-ai', updated_at: '2026-09-01T00:00:00.000Z' }),
    ]
    expect(rows.sort(byPreference).map((r) => r.id)).toEqual(['verified', 'new-ai', 'old-ai'])
  })
})

describe('mayReplace — cacheRow writes by term, so it has to guard the user row', () => {
  // `verified` is the schema's "the user confirmed this, AI must not touch it" flag.
  // Before cacheRow wrote by term, an AI re-translation landed as a separate row and
  // the verified one survived by accident; now the rule has to be explicit.
  it('refuses an AI result over a user-verified row', () => {
    const user = row({ id: 'u1', verified: true, source: 'user', en: 'Bench press' })
    const ai = row({ id: 'a1', verified: false, source: 'ai', en: 'Bench Press (barbell)' })
    expect(mayReplace(user, ai)).toBe(false)
  })

  it('still accepts a user edit over a user-verified row', () => {
    const user = row({ id: 'u1', verified: true, source: 'user' })
    const edit = row({ id: 'u2', verified: true, source: 'user', en: 'Flat bench press' })
    expect(mayReplace(user, edit)).toBe(true)
  })

  it('accepts an AI result when the existing row is unverified, or there is none', () => {
    const ai = row({ id: 'a1', verified: false, source: 'ai' })
    expect(mayReplace(row({ verified: false }), ai)).toBe(true)
    expect(mayReplace(undefined, ai)).toBe(true)
  })
})
