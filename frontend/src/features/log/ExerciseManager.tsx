// Exercise library management (edit / merge / delete). Lives in Settings. Renames
// and reclassifications propagate to History and charts automatically (rendered by id).
// Reclassify by drag: drop an exercise on another category to MOVE it there
// (drops the source category); hold Shift to ADD the target while keeping the rest
// (an exercise can belong to multiple categories). Click still opens the dialog.
import { useCallback, useEffect, useState } from 'react'
import { getExercises, updateExercise, withUndo } from '../../db'
import { type BodyPart, type Exercise } from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'
import { useUndo } from '../../undo'
import { EditExerciseDialog } from './EditExerciseDialog'
import { exerciseName, sortExercises } from './util'

interface DragInfo { id: string; from: BodyPart }

export function ExerciseManager({ lang, onChanged }: { lang: TranslationTarget; onChanged?: () => void }) {
  const cats = useCategories()
  const catOrder = cats.map((c) => c.key)
  const { push } = useUndo()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [dragging, setDragging] = useState<DragInfo | null>(null)
  const [dragOver, setDragOver] = useState<BodyPart | null>(null)

  const reload = useCallback(async () => {
    setExercises(await getExercises())
    onChanged?.()
  }, [onChanged])
  useEffect(() => {
    void reload()
  }, [reload])

  async function onDropCategory(target: BodyPart, add: boolean) {
    const info = dragging
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

  if (exercises.length === 0) {
    return <p className="exmgr-desc">{lang === 'zh' ? '还没有动作(去 Log 添加)。' : 'No exercises yet — add them in Log.'}</p>
  }

  return (
    <div className={`exmgr ${dragging ? 'is-dragging' : ''}`}>
      <p className="exmgr-desc">{lang === 'zh' ? '点动作可编辑 / 合并;拖到别的分类改归属(按住 Shift 拖 = 加入多个分类)。' : 'Tap to edit / merge; drag onto another category to reclassify (hold Shift to add to several).'}</p>
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
              onDrop={(e) => { e.preventDefault(); void onDropCategory(c.key, e.shiftKey) }}
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
                  <button
                    key={e.id}
                    type="button"
                    className="exmgr-chip"
                    draggable
                    onDragStart={() => setDragging({ id: e.id, from: c.key })}
                    onDragEnd={() => { setDragging(null); setDragOver(null) }}
                    onClick={() => setEditing(e)}
                  >
                    {exerciseName(e, lang)}
                  </button>
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
          onSaved={() => { setEditing(null); void reload() }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
