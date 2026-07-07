// Rehab exercise library (§6A Phase 2). Lives inside the Injuries tab: rehab moves
// (exercises with is_rehab=true) grouped by body part, each showing its knowledge
// (purpose / cues / dosage) in the current language. Add/edit via the dialog.
import { useCallback, useEffect, useState } from 'react'
import { getExercises } from '../../db'
import type { Exercise } from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import { exerciseName } from '../log/util'
import type { TranslationTarget } from '../../translation'
import { RehabExerciseDialog } from './RehabExerciseDialog'

export function RehabLibrary({ lang }: { lang: TranslationTarget }) {
  const cats = useCategories()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [dialog, setDialog] = useState<{ open: boolean; ex?: Exercise }>({ open: false })

  const reload = useCallback(async () => {
    const all = await getExercises()
    setExercises(all.filter((e) => e.is_rehab))
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="rehab-lib">
      <div className="inj-head">
        <span className="th-label">{lang === 'zh' ? '康复动作库' : 'Rehab library'}</span>
        <button className="th-btn-ghost inj-add" type="button" onClick={() => setDialog({ open: true })}>
          {lang === 'zh' ? '+ 康复动作' : '+ Rehab exercise'}
        </button>
      </div>

      {exercises.length === 0 ? (
        <p className="inj-empty">{lang === 'zh' ? '还没有康复动作。' : 'No rehab exercises yet.'}</p>
      ) : (
        cats.map((c) => {
          const items = exercises.filter((e) => e.body_parts.includes(c.key))
          if (items.length === 0) return null
          return (
            <div key={c.key} className="rehab-group">
              <span className="log-group-label">{categoryLabel(c.key, lang)}</span>
              <div className="rehab-list">
                {items.map((e) => {
                  const purpose = lang === 'zh' ? e.rehab_purpose_zh : e.rehab_purpose_en
                  const cues = lang === 'zh' ? e.rehab_cues_zh : e.rehab_cues_en
                  return (
                    <button key={e.id} type="button" className="rehab-item" onClick={() => setDialog({ open: true, ex: e })}>
                      <span className="rehab-item-name">{exerciseName(e, lang)}</span>
                      {(purpose || e.rehab_purpose_zh || e.rehab_purpose_en) && (
                        <span className="rehab-item-purpose">{purpose || e.rehab_purpose_zh || e.rehab_purpose_en}</span>
                      )}
                      <span className="rehab-item-meta">
                        {(cues || e.rehab_cues_zh || e.rehab_cues_en) && <span>{cues || e.rehab_cues_zh || e.rehab_cues_en}</span>}
                        {e.rehab_dosage && <span className="rehab-dosage">{e.rehab_dosage}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      {dialog.open && (
        <RehabExerciseDialog
          lang={lang}
          exercise={dialog.ex}
          onSaved={() => { setDialog({ open: false }); void reload() }}
          onClose={() => setDialog({ open: false })}
        />
      )}
    </div>
  )
}
