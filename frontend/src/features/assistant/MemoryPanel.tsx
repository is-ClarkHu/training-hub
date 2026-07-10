// Right pane (PLAN-ai-chatrooms P4): the active room's memory. Shows the rolling
// summary (read-only; the backend maintains it), the room's memory units (add /
// edit / pin / delete / mark shareable), and which other rooms' shared memories
// this room may read. Marking a memory shareable takes an explicit confirm (§6.5).
import { useEffect, useState } from 'react'
import {
  getChatroomSummary,
  getChatroomMemories,
  createChatroomMemory,
  updateChatroomMemory,
  deleteChatroomMemory,
  getMemoryAccess,
  setMemoryAccess,
} from '../../db'
import type { Chatroom, ChatroomMemory, ChatroomSummary } from '../../supabase/types'

export function MemoryPanel({
  room,
  rooms,
  lang,
}: {
  room: Chatroom
  rooms: Chatroom[]
  lang: 'zh' | 'en'
}) {
  const [summary, setSummary] = useState<ChatroomSummary | null>(null)
  const [memories, setMemories] = useState<ChatroomMemory[]>([])
  const [accessIds, setAccessIds] = useState<string[]>([])
  const [newText, setNewText] = useState('')

  async function reload() {
    const [s, m, a] = await Promise.all([
      getChatroomSummary(room.id),
      getChatroomMemories(room.id),
      getMemoryAccess(room.id),
    ])
    setSummary(s)
    setMemories(m)
    setAccessIds(a)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  async function onAdd() {
    const text = newText.trim()
    if (!text) return
    await createChatroomMemory(room.id, text, false)
    setNewText('')
    await reload()
  }

  async function onToggleShareable(m: ChatroomMemory) {
    if (!m.shareable) {
      const ok = window.confirm(
        lang === 'zh'
          ? '把这条记忆设为「可共享」?其他被你授权的聊天室将能读到它。'
          : 'Make this memory shareable? Rooms you authorize will be able to read it.',
      )
      if (!ok) return
    }
    await updateChatroomMemory(m.id, { shareable: !m.shareable })
    await reload()
  }

  async function onTogglePin(m: ChatroomMemory) {
    await updateChatroomMemory(m.id, { pinned: !m.pinned })
    await reload()
  }

  async function onEdit(m: ChatroomMemory) {
    const text = window.prompt(lang === 'zh' ? '编辑记忆' : 'Edit memory', m.content)?.trim()
    if (!text || text === m.content) return
    await updateChatroomMemory(m.id, { content: text })
    await reload()
  }

  async function onDelete(m: ChatroomMemory) {
    if (!window.confirm(lang === 'zh' ? '删除这条记忆?' : 'Delete this memory?')) return
    await deleteChatroomMemory(m.id)
    await reload()
  }

  async function onToggleAccess(sourceId: string, on: boolean) {
    await setMemoryAccess(room.id, sourceId, on)
    await reload()
  }

  const otherRooms = rooms.filter((r) => r.id !== room.id)

  return (
    <aside className="asst-memory">
      <section className="asst-mem-sec">
        <h4>{lang === 'zh' ? '聊天室摘要' : 'Room summary'}</h4>
        {summary?.content ? (
          <p className="asst-mem-summary">{summary.content}</p>
        ) : (
          <p className="asst-hint">{lang === 'zh' ? '对话变长后会自动生成。' : 'Builds up as the chat grows.'}</p>
        )}
      </section>

      <section className="asst-mem-sec">
        <h4>{lang === 'zh' ? '记忆' : 'Memories'}</h4>
        <div className="asst-mem-add">
          <textarea
            className="th-input"
            rows={2}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder={lang === 'zh' ? '记下一条要长期保留的结论…' : 'Note a conclusion to keep…'}
          />
          <button className="th-btn" type="button" onClick={onAdd} disabled={!newText.trim()}>
            {lang === 'zh' ? '添加' : 'Add'}
          </button>
        </div>
        {memories.length === 0 && (
          <p className="asst-hint">{lang === 'zh' ? '还没有记忆。' : 'No memories yet.'}</p>
        )}
        <ul className="asst-mem-list">
          {memories.map((m) => (
            <li key={m.id} className="asst-mem-item">
              <span className="asst-mem-text">{m.content}</span>
              <span className="asst-mem-actions">
                <button
                  type="button"
                  className={m.shareable ? 'is-on' : ''}
                  title={lang === 'zh' ? '可共享' : 'Shareable'}
                  onClick={() => onToggleShareable(m)}
                >
                  🔗
                </button>
                <button
                  type="button"
                  className={m.pinned ? 'is-on' : ''}
                  title={lang === 'zh' ? '置顶' : 'Pin'}
                  onClick={() => onTogglePin(m)}
                >
                  📌
                </button>
                <button type="button" title={lang === 'zh' ? '编辑' : 'Edit'} onClick={() => onEdit(m)}>✎</button>
                <button type="button" title={lang === 'zh' ? '删除' : 'Delete'} onClick={() => onDelete(m)}>🗑</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="asst-mem-sec">
        <h4>{lang === 'zh' ? '读取其他聊天室的记忆' : "Read other rooms' memory"}</h4>
        {otherRooms.length === 0 && (
          <p className="asst-hint">{lang === 'zh' ? '没有其他聊天室。' : 'No other rooms.'}</p>
        )}
        <ul className="asst-mem-access">
          {otherRooms.map((r) => (
            <li key={r.id}>
              <label>
                <input
                  type="checkbox"
                  checked={accessIds.includes(r.id)}
                  onChange={(e) => onToggleAccess(r.id, e.target.checked)}
                />
                {r.name}
              </label>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
