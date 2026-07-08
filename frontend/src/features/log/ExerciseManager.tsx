// Exercise library management (edit / merge / delete). Lives in Settings. Renames
// and reclassifications propagate to History and charts automatically (rendered by id).
// Reclassify by drag: drop an exercise on another category to MOVE it there
// (drops the source category); hold Shift to ADD the target while keeping the rest
// (an exercise can belong to multiple categories). Click still opens the dialog.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { getExercises, updateExercise, withUndo } from '../../db'
import { type BodyPart, type Exercise } from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'
import { useUndo } from '../../undo'
import { EditExerciseDialog } from './EditExerciseDialog'
import { exerciseName, sortExercises } from './util'

interface DragInfo { id: string; from: BodyPart }

export function ExerciseManager({ lang, onChanged }: { lang: TranslationTarget; onChanged?: () => Promise<void> | void }) {
  const cats = useCategories()
  const catOrder = cats.map((c) => c.key)
  const { push } = useUndo()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [dragging, setDragging] = useState<DragInfo | null>(null)
  const [dragOver, setDragOver] = useState<BodyPart | null>(null)
  const draggedRef = useRef(false)

  const reload = useCallback(async () => {
    setExercises(await getExercises())
    await onChanged?.()
  }, [onChanged])
  useEffect(() => {
    void reload()
  }, [reload])

  function readDragInfo(e: DragEvent): DragInfo | null {
    if (dragging) return dragging
    try {
      const raw = e.dataTransfer.getData('application/x-traininghub-exercise')
      return raw ? JSON.parse(raw) as DragInfo : null
    } catch {
      return null
    }
  }

  async function onDropCategory(target: BodyPart, add: boolean, event: DragEvent) {
    const info = readDragInfo(event)
    setDragging(null)
    setDragOver(null)
    if (!info) return
    const ex = exercises.find((e) => e.id === info.id)
    if (!ex) return
    // Shift = keep the rest and add target; plain = move (drop source, add target).
    const base = add ? ex.body_parts : ex.body_parts.filter((bp) => bp !== info.from)
    const next = base.includes(target) ? base : [...base, target]
    if (next.length === ex.body_parts.length && next.every((bp) => ex.body_parts.includes(bp))) return
    const { undo } = await withUndo(['exercises'], () => updateExercise(ex.id, { body_parts: next }))
    await reload()
    const name = exerciseName(ex, lang)
    const to = categoryLabel(target, lang)
    push(
      add
        ? (lang === 'zh' ? `已把「${name}」加入 ${to}` : `Added “${name}” to ${to}`)
        : (lang === 'zh' ? `已把「${name}」移到 ${to}` : `Moved “${name}” to ${to}`),
      async () => { await undo(); await reload() },
    )
  }

  function openFromKeyboard(event: KeyboardEvent, ex: Exercise) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setEditing(ex)
  }

  if (exercises.length === 0) {
    return <p className="exmgr-desc">{lang === 'zh' ? '还没有动作，去 Log 添加。' : 'No exercises yet. Add them from Log.'}</p>
  }

  return (
    <div className={`exmgr ${dragging ? 'is-dragging' : ''}`}>
      <p className="exmgr-desc">{lang === 'zh' ? '点击动作可编辑或合并；拖到其他分类可修改归属，按住 Shift 可加入多个分类。' : 'Click to edit or merge. Drag to another category to reclassify; hold Shift to assign multiple categories.'}</p>
      <div className="exmgr-groups">
        {cats.map((c) => {
          const items = sortExercises(exercises.filter((e) => e.body_parts.includes(c.key) && !e.is_rehab), lang, catOrder)
          // While dragging, keep every category visible so empty ones are droppable too.
          if (items.length === 0 && !dragging) return null
          return (
            <div
              key={c.key}
              className={`exmgr-group ${dragOver === c.key ? 'drag-over' : ''}`}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setDragOver(c.key) } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver((d) => (d === c.key ? null : d)) }}
              onDrop={(e) => { e.preventDefault(); void onDropCategory(c.key, e.shiftKey, e) }}
            >
              <span className="exmgr-label">
                {categoryLabel(c.key, lang)}
                <i className="exmgr-count">{items.length}</i>
                {dragOver === c.key && (
                  <em className="exmgr-drop-tag">{lang === 'zh' ? '放到这里' : 'drop here'}</em>
                )}
              </span>
              <div className="exmgr-chips">
                {items.map((e) => (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    className="exmgr-chip"
                    draggable
                    onDragStart={(event) => {
                      const info = { id: e.id, from: c.key }
                      draggedRef.current = true
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('application/x-traininghub-exercise', JSON.stringify(info))
                      event.dataTransfer.setData('text/plain', exerciseName(e, lang))
                      setDragging(info)
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => { draggedRef.current = false }, 0)
                      setDragging(null)
                      setDragOver(null)
                    }}
                    onClick={() => {
                      if (draggedRef.current) return
                      setEditing(e)
                    }}
                    onKeyDown={(event) => openFromKeyboard(event, e)}
                  >
                    {exerciseName(e, lang)}
                  </div>
                ))}
                {items.length === 0 && dragging && (
                  <span className="exmgr-empty">{lang === 'zh' ? '(空)' : '(empty)'}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <EditExerciseDialog
          lang={lang}
          exercise={editing}
          allExercises={exercises}
          onSaved={async () => { setEditing(null); await reload() }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
