// Global undo banner (Gmail-style snackbar). After a create/update/delete, the
// caller pushes a short message + an undo callback; a banner slides in at the top
// with an "Undo" button on the far left and fades out after a few seconds. Only
// the latest action is held — a new push replaces the banner.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLanguage } from '../i18n'
import './undo.css'

type UndoFn = () => Promise<void> | void
interface UndoAction { id: number; message: string; undo: UndoFn }

interface UndoApi {
  /** Show the banner: a message and the callback that reverses the action. */
  push: (message: string, undo: UndoFn) => void
}

const UndoContext = createContext<UndoApi | null>(null)

const VISIBLE_MS = 5500 // time before it starts fading
const FADE_MS = 400     // fade-out duration (keep in sync with undo.css)

export function UndoProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage()
  const [action, setAction] = useState<UndoAction | null>(null)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const nextId = useRef(0)

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const dismiss = useCallback(() => {
    clearTimers()
    setLeaving(true)
    timers.current.push(setTimeout(() => setAction(null), FADE_MS))
  }, [])

  const push = useCallback((message: string, undo: UndoFn) => {
    clearTimers()
    setLeaving(false)
    setAction({ id: nextId.current++, message, undo })
    timers.current.push(setTimeout(() => setLeaving(true), VISIBLE_MS))
    timers.current.push(setTimeout(() => setAction(null), VISIBLE_MS + FADE_MS))
  }, [])

  useEffect(() => () => clearTimers(), [])

  async function onUndo() {
    if (!action) return
    const fn = action.undo
    dismiss()
    try {
      await fn()
    } catch (err) {
      console.error('undo failed', err)
    }
  }

  return (
    <UndoContext.Provider value={{ push }}>
      {children}
      {action && (
        <div className={`undo-banner ${leaving ? 'is-leaving' : ''}`} key={action.id} role="status">
          <button type="button" className="undo-btn" onClick={() => void onUndo()}>
            {lang === 'zh' ? '撤销' : 'Undo'}
          </button>
          <span className="undo-msg">{action.message}</span>
          <button type="button" className="undo-close" aria-label={lang === 'zh' ? '关闭' : 'dismiss'} onClick={dismiss}>×</button>
        </div>
      )}
    </UndoContext.Provider>
  )
}

/** Push undo actions from any screen. No-op safe if used outside the provider. */
export function useUndo(): UndoApi {
  const ctx = useContext(UndoContext)
  if (!ctx) return { push: () => {} }
  return ctx
}
