// Assistant tab (SPEC §9 / PLAN-ai-chatrooms). A collapsible left drawer lists the
// user's chatrooms (create / rename / reorder / delete); the main pane is the chat
// for the active room, with a per-room data-permission bar and a "used this turn"
// disclosure under each answer. History loads from the local store (chat_messages,
// synced); new turns go through the backend, which persists them server-side.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  db,
  ensureDefaultChatroom,
  getChatrooms,
  createChatroom,
  renameChatroom,
  reorderChatrooms,
  updateChatroomPerms,
  deleteChatroom,
} from '../../db'
import type { Chatroom, ChatroomPermCategory } from '../../supabase/types'
import { useLanguage } from '../../i18n'
import { askAssistant } from './assistantClient'
import './assistant.css'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
}

// v1 permission categories (existing data). `sensitive` flags injuries for a
// visual cue. intimacy is deliberately absent — hard-isolated, never AI.
const PERM_CATS: { key: ChatroomPermCategory; zh: string; en: string; sensitive?: boolean }[] = [
  { key: 'profile_min', zh: '基础资料', en: 'Profile' },
  { key: 'training', zh: '训练记录', en: 'Training' },
  { key: 'injuries', zh: '伤病记录', en: 'Injuries', sensitive: true },
]

export function AssistantScreen() {
  const { lang } = useLanguage()
  const [rooms, setRooms] = useState<Chatroom[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void ensureDefaultChatroom().then((rs) => {
      setRooms(rs)
      setActiveId((cur) => cur ?? rs[0]?.id ?? null)
    })
  }, [])

  // Chat history for the active room only.
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    void db.chat_messages.toArray().then((rows) => {
      setMessages(
        rows
          .filter((m) => !m.deleted && m.chatroom_id === activeId)
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
          .map((m) => ({ role: m.role, content: m.content })),
      )
    })
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const activeRoom = rooms.find((r) => r.id === activeId) ?? null

  async function refreshRooms(selectId?: string) {
    const rs = await getChatrooms()
    setRooms(rs)
    if (selectId) setActiveId(selectId)
  }

  async function onNewRoom() {
    const name = window.prompt(lang === 'zh' ? '新聊天室名称' : 'New chatroom name')?.trim()
    if (!name) return
    const room = await createChatroom(name)
    await refreshRooms(room.id)
  }

  async function onRenameRoom(room: Chatroom) {
    const name = window.prompt(lang === 'zh' ? '重命名聊天室' : 'Rename chatroom', room.name)?.trim()
    if (!name || name === room.name) return
    await renameChatroom(room.id, name)
    await refreshRooms()
  }

  async function onDeleteRoom(room: Chatroom) {
    const msg =
      lang === 'zh'
        ? `删除聊天室「${room.name}」?\n\n会永久删除该聊天室的消息、摘要和相关记忆,但不会删除你的训练、伤病等原始记录。`
        : `Delete chatroom “${room.name}”?\n\nThis permanently removes its messages, summary and memories — but never your training, injury or other raw records.`
    if (!window.confirm(msg)) return
    await deleteChatroom(room.id)
    const rs = await ensureDefaultChatroom()
    setRooms(rs)
    if (activeId === room.id) setActiveId(rs[0]?.id ?? null)
  }

  async function onMove(room: Chatroom, dir: -1 | 1) {
    const idx = rooms.findIndex((r) => r.id === room.id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= rooms.length) return
    const ids = rooms.map((r) => r.id)
    ;[ids[idx], ids[swap]] = [ids[swap], ids[idx]]
    await reorderChatrooms(ids)
    await refreshRooms()
  }

  async function onTogglePerm(cat: ChatroomPermCategory) {
    if (!activeRoom) return
    const next = { ...activeRoom.perms, [cat]: !activeRoom.perms[cat] }
    await updateChatroomPerms(activeRoom.id, next)
    await refreshRooms()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy || !activeId) return
    setInput('')
    setError(null)
    setMessages((m) => [...m, { role: 'user', content: text }])
    setBusy(true)
    try {
      const { reply, sources } = await askAssistant(text, activeId)
      setMessages((m) => [...m, { role: 'assistant', content: reply, sources }])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="asst-layout">
      {sidebarOpen && (
        <aside className="asst-rooms">
          <button className="th-btn asst-newroom" type="button" onClick={onNewRoom}>
            {lang === 'zh' ? '+ 新聊天室' : '+ New room'}
          </button>
          <ul className="asst-roomlist">
            {rooms.map((r, i) => (
              <li key={r.id} className={`asst-room ${r.id === activeId ? 'is-active' : ''}`}>
                <button className="asst-room-name" type="button" onClick={() => setActiveId(r.id)}>
                  {r.name}
                </button>
                {r.id === activeId && (
                  <span className="asst-room-actions">
                    <button type="button" title={lang === 'zh' ? '重命名' : 'Rename'} onClick={() => onRenameRoom(r)}>✎</button>
                    <button type="button" title={lang === 'zh' ? '上移' : 'Up'} disabled={i === 0} onClick={() => onMove(r, -1)}>↑</button>
                    <button type="button" title={lang === 'zh' ? '下移' : 'Down'} disabled={i === rooms.length - 1} onClick={() => onMove(r, 1)}>↓</button>
                    <button type="button" title={lang === 'zh' ? '删除' : 'Delete'} onClick={() => onDeleteRoom(r)}>🗑</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="asst-screen">
        <div className="asst-header">
          <button
            className="asst-drawer-toggle"
            type="button"
            aria-label={lang === 'zh' ? '聊天室列表' : 'Chatrooms'}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            ☰
          </button>
          <span className="asst-roomhead">{activeRoom?.name ?? ''}</span>
        </div>

        {activeRoom && (
          <div className="asst-perms">
            <span className="asst-perms-label">{lang === 'zh' ? 'AI 可读:' : 'AI can read:'}</span>
            {PERM_CATS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`asst-perm ${activeRoom.perms[c.key] ? 'is-on' : ''} ${c.sensitive ? 'sensitive' : ''}`}
                onClick={() => onTogglePerm(c.key)}
              >
                {activeRoom.perms[c.key] ? '✓ ' : ''}
                {lang === 'zh' ? c.zh : c.en}
              </button>
            ))}
          </div>
        )}

        <div className="asst-log">
          {messages.length === 0 && (
            <p className="asst-hint">
              {lang === 'zh'
                ? '问我关于你训练数据的问题,例如「我的卧推进步如何?」'
                : 'Ask about your training data, e.g. “How is my bench progressing?”'}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`asst-msg ${m.role}`}>
              <span className="asst-bubble">{m.content}</span>
              {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                <span className="asst-sources">
                  {(lang === 'zh' ? '本次使用:' : 'Used: ') + m.sources.join(' · ')}
                </span>
              )}
            </div>
          ))}
          {busy && <div className="asst-msg assistant"><span className="asst-bubble asst-typing">…</span></div>}
          {error && <p className="th-error">{error}</p>}
          <div ref={endRef} />
        </div>

        <form className="asst-form" onSubmit={onSubmit}>
          <input
            className="th-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={lang === 'zh' ? '输入消息…' : 'Type a message…'}
            disabled={busy}
          />
          <button className="th-btn asst-send" type="submit" disabled={busy || !input.trim() || !activeId}>
            {lang === 'zh' ? '发送' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
