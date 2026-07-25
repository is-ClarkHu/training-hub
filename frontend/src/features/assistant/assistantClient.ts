// Client for the /api/assistant backend relay (SPEC §9). Sends the user's Supabase
// access token + the chosen provider/model/key (Settings → AI).
import { supabase } from '../../supabase/client'
import { aiPayload, backendUrl } from '../../ai/config'

export interface AssistantReply {
  reply: string
  sources: string[] // human-readable labels of the data used this turn (§ sources_used)
  suggestedMemory: string // AI-proposed memory to save (empty = none); user confirms
}

export async function askAssistant(
  message: string,
  chatroomId?: string,
  ai?: { provider: string; model: string; api_key: string },
): Promise<AssistantReply> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${backendUrl()}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, chatroom_id: chatroomId ?? '', ...(ai ?? aiPayload('assistant')) }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Assistant error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { reply: string; sources_used?: string[]; suggested_memory?: string }
  return { reply: json.reply, sources: json.sources_used ?? [], suggestedMemory: json.suggested_memory ?? '' }
}

/** Summarize a reference file's extracted text for AI context (§5.4). */
export async function summarizeFile(text: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${backendUrl()}/api/summarize-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, ...aiPayload('assistant') }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Summarize error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { summary: string }
  return json.summary
}

/**
 * Fire-and-forget GET to wake a cold backend (Render free tier sleeps after
 * inactivity and takes ~30–60s to boot). Call it when the user opens a screen
 * that is about to hit a relay endpoint so the real request lands warm.
 */
export function warmupBackend(): void {
  void fetch(`${backendUrl()}/health`, { method: 'GET' }).catch(() => {})
}

/**
 * Vision: recognize a meal photo (data URL) → short description text. An optional
 * `hint` (the user's own note about the meal) is sent to raise accuracy.
 */
export async function describeFood(image: string, hint = ''): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${backendUrl()}/api/describe-food`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image, hint, ...aiPayload('assistant') }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Describe error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { description: string }
  return json.description
}
