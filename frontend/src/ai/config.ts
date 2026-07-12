// AI configuration (client-side, like the en-zh vault): the user pastes provider
// API keys and picks which provider/model handles each task. Keys live in
// localStorage and are sent to the local backend, which relays the call (browsers
// can't safely call these APIs directly — CORS + key exposure).
export type AiTask = 'translation' | 'assistant'

export const AI_PROVIDERS = ['deepseek', 'openai', 'anthropic', 'moonshot', 'mistral', 'gemini'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-4-8',
  moonshot: 'moonshot-v1-8k',
  mistral: 'mistral-small-latest',
  gemini: 'gemini-2.0-flash',
}

export interface TaskCfg {
  provider: AiProvider
  model: string
}

// Translation defaults to a cheap provider; the assistant can be pointed anywhere.
const DEFAULT_TASK: Record<AiTask, TaskCfg> = {
  translation: { provider: 'deepseek', model: DEFAULT_MODEL.deepseek },
  assistant: { provider: 'deepseek', model: DEFAULT_MODEL.deepseek },
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

/** provider/model/api_key to send to the backend for a task. */
export function aiPayload(t: AiTask): { provider: AiProvider; model: string; api_key: string } {
  const c = getTaskCfg(t)
  return { provider: c.provider, model: c.model, api_key: getKey(c.provider) }
}

/** payload for an explicit provider (per-chatroom AI); model defaults per provider. */
export function payloadForProvider(provider: AiProvider, model?: string | null): { provider: AiProvider; model: string; api_key: string } {
  return { provider, model: model || DEFAULT_MODEL[provider], api_key: getKey(provider) }
}

export function hasKeyFor(t: AiTask): boolean {
  return !!getKey(getTaskCfg(t).provider)
}

export function backendUrl(): string {
  // `||` (not `??`) so an empty VITE_ASSISTANT_API_URL="" falls back to the default.
  return import.meta.env.VITE_ASSISTANT_API_URL || 'http://localhost:8000'
}
