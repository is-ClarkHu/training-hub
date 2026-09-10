// AI configuration (client-side, like the en-zh vault): the user pastes provider
// API keys and picks which provider/model handles each task. Keys live in
// localStorage and are sent to the local backend, which relays the call (browsers
// can't safely call these APIs directly — CORS + key exposure).
import { resolveModel } from './models'

export type AiTask = 'translation' | 'assistant'

export const AI_PROVIDERS = ['deepseek', 'openai', 'anthropic', 'moonshot', 'mistral', 'gemini'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-5',
  moonshot: 'moonshot-v1-8k',
  mistral: 'mistral-small-latest',
  gemini: 'gemini-2.0-flash',
}

// Per-provider identity for the chat avatar — a short glyph + a brand-ish colour,
// so "which AI am I talking to?" is answerable at a glance. Label doubles as the
// avatar tooltip.
export const PROVIDER_META: Record<AiProvider, { label: string; glyph: string; color: string }> = {
  deepseek: { label: 'DeepSeek', glyph: 'D', color: '#4d6bfe' },
  openai: { label: 'OpenAI', glyph: 'O', color: '#10a37f' },
  anthropic: { label: 'Claude', glyph: 'C', color: '#d97757' },
  moonshot: { label: 'Kimi', glyph: 'K', color: '#7c3aed' },
  mistral: { label: 'Mistral', glyph: 'M', color: '#fa520f' },
  gemini: { label: 'Gemini', glyph: 'G', color: '#1a73e8' },
}

export interface TaskCfg {
  provider: AiProvider
  model: string
}

// Translation defaults to a cheap provider; the assistant can be pointed
// anywhere. `model: ''` means "whatever tier this provider is set to" — see
// modelFor() / models.ts. A non-empty model is an explicit user override.
const DEFAULT_TASK: Record<AiTask, TaskCfg> = {
  translation: { provider: 'deepseek', model: '' },
  assistant: { provider: 'deepseek', model: '' },
}

export function getKey(p: AiProvider): string {
  return localStorage.getItem(`th.ai.key.${p}`) ?? ''
}
export function setKey(p: AiProvider, v: string): void {
  if (v) localStorage.setItem(`th.ai.key.${p}`, v)
  else localStorage.removeItem(`th.ai.key.${p}`)
}

export function getTaskCfg(t: AiTask): TaskCfg {
  const raw = localStorage.getItem(`th.ai.task.${t}`)
  if (raw) {
    try {
      return JSON.parse(raw) as TaskCfg
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_TASK[t]
}
export function setTaskCfg(t: AiTask, cfg: TaskCfg): void {
  localStorage.setItem(`th.ai.task.${t}`, JSON.stringify(cfg))
}

/**
 * The model a task actually runs on. An explicit id in the task config (the
 * "Custom…" box) wins; otherwise the provider's chosen tier decides, and
 * DEFAULT_MODEL is the last-resort floor if the catalog is somehow empty.
 */
export function modelFor(provider: AiProvider, explicit?: string | null): string {
  return (explicit || '').trim() || resolveModel(provider) || DEFAULT_MODEL[provider]
}

/** provider/model/api_key to send to the backend for a task. */
export function aiPayload(t: AiTask): { provider: AiProvider; model: string; api_key: string } {
  const c = getTaskCfg(t)
  return { provider: c.provider, model: modelFor(c.provider, c.model), api_key: getKey(c.provider) }
}

/** payload for an explicit provider (per-chatroom AI); model follows that provider's tier. */
export function payloadForProvider(provider: AiProvider, model?: string | null): { provider: AiProvider; model: string; api_key: string } {
  return { provider, model: modelFor(provider, model), api_key: getKey(provider) }
}

export function hasKeyFor(t: AiTask): boolean {
  return !!getKey(getTaskCfg(t).provider)
}

export function backendUrl(): string {
  // `||` (not `??`) so an empty VITE_ASSISTANT_API_URL="" falls back to the default.
  return import.meta.env.VITE_ASSISTANT_API_URL || 'http://localhost:8000'
}

/**
 * Is an AI relay actually reachable from this origin?
 *
 * The localhost:8000 fallback above only means anything while developing. A
 * deployed HTTPS build with no VITE_ASSISTANT_API_URL secret would fire requests
 * at the visitor's OWN machine — blocked as mixed content, and nothing is
 * listening regardless. Callers use this to disable the relay-backed features up
 * front instead of letting them fail with a console error.
 */
export function hasBackend(): boolean {
  if ((import.meta.env.VITE_ASSISTANT_API_URL || '').trim()) return true
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1'
}
