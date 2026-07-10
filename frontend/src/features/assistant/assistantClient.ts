// Client for the /api/assistant backend relay (SPEC §9). Sends the user's Supabase
// access token + the chosen provider/model/key (Settings → AI).
import { supabase } from '../../supabase/client'
import { aiPayload, backendUrl } from '../../ai/config'

export interface AssistantReply {
  reply: string
  sources: string[] // human-readable labels of the data used this turn (§ sources_used)
}

export async function askAssistant(message: string, chatroomId?: string): Promise<AssistantReply> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${backendUrl()}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, chatroom_id: chatroomId ?? '', ...aiPayload('assistant') }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Assistant error ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { reply: string; sources_used?: string[] }
  return { reply: json.reply, sources: json.sources_used ?? [] }
}
