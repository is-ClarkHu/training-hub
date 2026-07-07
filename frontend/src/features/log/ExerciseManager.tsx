// Exercise library management (edit / merge / delete). Lives in Settings. Renames
// and reclassifications propagate to History and charts automatically (rendered by id).
import { useCallback, useEffect, useState } from 'react'
import { getExercises } from '../../db'
import { type Exercise } from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'
import { EditExerciseDialog } from './EditExerciseDialog'
import { exerciseName } from './util'

export function ExerciseManager({ lang, onChanged }: { lang: TranslationTarget; onChanged?: () => void }) {
  const cats = useCategories()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [editing, setEditing] = useState<Exercise | null>(null)

  const reload = useCallback(async () => {
    setExercises(await getExercises())
    onChanged?.()
  }, [onChanged])
  useEffect(() => {
    void reload()
  }, [reload])

  if (exercises.length === 0) {
    return <p className="set-desc">{lang === 'zh' ? '还没有动作(去 Log 添加)。' : 'No exercises yet — add them in Log.'}</p>
  }

  return (
    <div className="set-ai">
      <p className="set-desc">{lang === 'zh' ? '编辑动作名/部位/类型,或把两个相同的动作合并。改动会自动同步到历史与图表。' : 'Edit an exercise’s name/part/type, or merge duplicates. Changes propagate to History and charts.'}</p>
      {cats.map((c) => {
        const items = exercises.filter((e) => e.body_part === c.key)
        if (items.length === 0) return null
        return (
          <div key={c.key} className="set-ex-group">
            <span className="log-group-label">{categoryLabel(c.key, lang)}</span>
            <div className="set-ex-list">
              {items.map((e) => (
                <button key={e.id} type="button" className="set-ex-item" onClick={() => setEditing(e)}>
                  {exerciseName(e, lang)}
                </button>
              ))}
            </div>
          </div>
        )
      })}

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
