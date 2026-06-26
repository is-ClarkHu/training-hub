// Assistant tab (SPEC §9, Phase 2): chat with a coach that has memory of the
// user's training data. History loads from the local store (chat_messages, synced)
// and new turns go through the backend, which persists them server-side.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db } from '../../db'
import { useLanguage } from '../../i18n'
import { askAssistant } from './assistantClient'
import './assistant.css'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export function AssistantScreen() {
  const { lang } = useLanguage()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void db.chat_messages.toArray().then((rows) => {
      setMessages(
        rows
          .filter((m) => !m.deleted)
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
          .map((m) => ({ role: m.role, content: m.content })),
      )
    })
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setError(null)
    setMessages((m) => [...m, { role: 'user', content: text }])
    setBusy(true)
    try {
      const reply = await askAssistant(text)
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="asst-screen">
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
        <button className="th-btn asst-send" type="submit" disabled={busy || !input.trim()}>
          {lang === 'zh' ? '发送' : 'Send'}
        </button>
      </form>
    </div>
  )
}
