// The tier ranking + update planner are pure, so they're testable without a
// network, a browser, or anyone's API key. Everything below is the logic that
// decides which model a call actually runs on.
import { describe, expect, it } from 'vitest'
import { isChatModel, modelScore, planCatalog, versionOf, type LiveModel } from './models'

const live = (...ids: string[]): LiveModel[] => ids.map((id) => ({ id, created: 0 }))

describe('versionOf', () => {
  it('reads plain and dashed versions', () => {
    expect(versionOf('gpt-4.1')).toBe(4.1)
    expect(versionOf('claude-opus-4-8')).toBe(4.8)
    expect(versionOf('claude-fable-5-1')).toBe(5.1)
    expect(versionOf('claude-opus-5')).toBe(5)
  })

  it('ignores date snapshots, context sizes and parameter counts', () => {
    // A 4-digit tail is a date, not a minor version.
    expect(versionOf('gpt-4-0613')).toBe(4)
    expect(versionOf('claude-haiku-4-5-20251001')).toBe(4.5)
    expect(versionOf('moonshot-v1-128k')).toBe(1)
    expect(versionOf('ministral-8b-latest')).toBe(0)
  })
})

describe('modelScore', () => {
  it('orders Anthropic families regardless of version', () => {
    // Family band dominates: a new Sonnet never outranks an older Opus.
    expect(modelScore('anthropic', 'claude-fable-5-1')).toBeGreaterThan(modelScore('anthropic', 'claude-opus-5'))
    expect(modelScore('anthropic', 'claude-opus-4-8')).toBeGreaterThan(modelScore('anthropic', 'claude-sonnet-5'))
    expect(modelScore('anthropic', 'claude-sonnet-5')).toBeGreaterThan(modelScore('anthropic', 'claude-haiku-4-5'))
  })

  it('ranks newer over older inside one family', () => {
    expect(modelScore('anthropic', 'claude-opus-5')).toBeGreaterThan(modelScore('anthropic', 'claude-opus-4-8'))
    expect(modelScore('openai', 'gpt-4.1')).toBeGreaterThan(modelScore('openai', 'gpt-4o'))
  })

  it('does not let the size token "mini" match inside "gemini"', () => {
    // The classic bug this delimiter guards against: /mini/ hits ge-MINI and
    // silently demotes every Gemini model below every Gemma one.
    expect(modelScore('gemini', 'gemini-2.5-pro')).toBeGreaterThan(modelScore('gemini', 'gemini-2.5-flash'))
    expect(modelScore('gemini', 'gemini-2.5-flash')).toBeGreaterThan(modelScore('gemini', 'gemini-2.5-flash-lite'))
  })

  it('ranks a preview just under the equivalent stable id', () => {
    expect(modelScore('gemini', 'gemini-2.5-pro')).toBeGreaterThan(modelScore('gemini', 'gemini-2.5-pro-preview'))
    // …but a genuinely newer preview still wins on version. The penalty is 0.5,
    // so it only cancels a half-version gap: 3.0-preview ties with 2.5-stable.
    expect(modelScore('gemini', 'gemini-3.5-pro-preview')).toBeGreaterThan(modelScore('gemini', 'gemini-2.5-pro'))
    expect(modelScore('gemini', 'gemini-3.0-pro-preview')).toBe(modelScore('gemini', 'gemini-2.5-pro'))
  })
})

describe('isChatModel', () => {
  it('rejects non-chat endpoints that share the model list', () => {
    expect(isChatModel('openai', 'text-embedding-3-small')).toBe(false)
    expect(isChatModel('openai', 'whisper-1')).toBe(false)
    expect(isChatModel('openai', 'dall-e-3')).toBe(false)
    expect(isChatModel('openai', 'gpt-4.1')).toBe(true)
  })

  it('keeps Anthropic and Gemini to their own prefixes', () => {
    expect(isChatModel('anthropic', 'claude-opus-5')).toBe(true)
    expect(isChatModel('anthropic', 'some-other-model')).toBe(false)
    expect(isChatModel('gemini', 'gemma-3-27b')).toBe(false)
  })
})

describe('planCatalog', () => {
  const current = { t1: 'claude-opus-5', t2: 'claude-sonnet-5', t3: 'claude-haiku-4-5', t4: '', t5: '' }

  it('re-points T1 at the strongest model on offer and leaves served pins alone', () => {
    const { catalog, changes } = planCatalog(
      'anthropic',
      current,
      live('claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'),
    )
    expect(catalog.t1).toBe('claude-fable-5-1')
    expect(catalog.t2).toBe('claude-sonnet-5') // still served → untouched
    expect(changes.map((c) => c.tier)).toContain('t1')
    expect(changes.find((c) => c.tier === 't1')?.reason).toBe('newer model available')
  })

  it('does nothing when the frontier has not moved', () => {
    const { changes } = planCatalog('anthropic', current, live('claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'))
    expect(changes).toEqual([])
  })

  it('replaces a retired pin without letting it jump above the tier over it', () => {
    // T2's claude-sonnet-5 is gone. The replacement must stay below T1.
    const { catalog } = planCatalog(
      'anthropic',
      current,
      live('claude-opus-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'),
    )
    expect(catalog.t1).toBe('claude-opus-5')
    expect(catalog.t2).toBe('claude-sonnet-4-6')
    expect(modelScore('anthropic', catalog.t2 as string)).toBeLessThan(modelScore('anthropic', catalog.t1 as string))
  })

  it('never pins one model to two tiers', () => {
    const { catalog } = planCatalog('deepseek', { t1: '', t2: '', t3: '', t4: '', t5: '' }, live('deepseek-reasoner', 'deepseek-chat'))
    const pinned = [catalog.t1, catalog.t2, catalog.t3, catalog.t4, catalog.t5].filter(Boolean)
    expect(new Set(pinned).size).toBe(pinned.length)
    expect(catalog.t1).toBe('deepseek-reasoner')
    expect(catalog.t2).toBe('deepseek-chat')
  })

  it('empties a tier that has no replacement below the one above it', () => {
    // Only the frontier model is still served — nothing can legally sit under it.
    const { catalog } = planCatalog('anthropic', current, live('claude-opus-5'))
    expect(catalog.t1).toBe('claude-opus-5')
    expect(catalog.t2).toBe('')
  })

  it('ignores a live list with no usable chat models', () => {
    const { catalog, changes } = planCatalog('openai', { t1: 'gpt-5' }, live('text-embedding-3-large', 'whisper-1'))
    expect(catalog).toEqual({ t1: 'gpt-5' })
    expect(changes).toEqual([])
  })
})
