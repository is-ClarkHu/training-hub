// Unified activity picker (SPEC §7.1, redesigned): sports + exercises in one
// selector, grouped. Pick a sport → sport-session form; pick an exercise →
// set inputs. Exercises grouped by the 7 body parts; sports in their own group.
import { useMemo, useState } from 'react'
import { type Exercise, type Sport } from '../../supabase/types'
import { useCategories, categoryLabel } from '../../categories'
import type { TranslationTarget } from '../../translation'
import { exerciseName } from './util'

function sportLabel(s: Sport, lang: TranslationTarget): string {
  return (lang === 'zh' ? s.name_zh : s.name_en) || s.name_zh || s.name_en
}

export function ExercisePicker({
  lang,
  exercises,
  sports,
  selectedId,
  onSelect,
  onSelectSport,
  onAddNew,
}: {
  lang: TranslationTarget
  exercises: Exercise[]
  sports: Sport[]
  selectedId: string | null
  onSelect: (ex: Exercise) => void
  onSelectSport: (s: Sport) => void
  onAddNew: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  const cats = useCategories()

  const q = query.trim().toLowerCase()
  const exGroups = useMemo(() => {
    const matches = exercises.filter(
      (e) => !q || e.name_zh.toLowerCase().includes(q) || e.name_en.toLowerCase().includes(q),
    )
    // Rehab moves get their own group (below) — keep them out of the body-part groups.
    return cats.map((c) => ({ bp: c.key, items: matches.filter((e) => e.body_part === c.key && !e.is_rehab) })).filter(
      (g) => g.items.length > 0,
    )
  }, [exercises, q, cats])
  const rehabMatches = useMemo(
    () => exercises.filter(
      (e) => e.is_rehab && (!q || e.name_zh.toLowerCase().includes(q) || e.name_en.toLowerCase().includes(q)),
    ),
    [exercises, q],
  )
  const sportMatches = sports.filter(
    (s) => !q || s.name_zh.toLowerCase().includes(q) || s.name_en.toLowerCase().includes(q),
  )

  const empty = exercises.length === 0 && sports.length === 0

  return (
    <div className="log-picker">
      <div className="log-row">
        <input
          className="th-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'zh' ? '搜索动作 / 运动…' : 'Search activities…'}
        />
        <button className="th-btn-ghost log-suggest" type="button" onClick={() => onAddNew(query)}>
          {lang === 'zh' ? '+ 新动作' : '+ Exercise'}
        </button>
      </div>

      {empty ? (
        <p className="log-empty">{lang === 'zh' ? '还没有动作 —— 用「+ 新动作」添加' : 'No activities yet — add one with “+ Exercise”.'}</p>
      ) : (
        <div className="log-groups">
          {sportMatches.length > 0 && (
            <div className="log-group">
              <span className="log-group-label">{lang === 'zh' ? '运动' : 'Sports'}</span>
              <div className="log-chips">
                {sportMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`log-chip sport ${selectedId === s.id ? 'is-selected' : ''}`}
                    onClick={() => onSelectSport(s)}
                  >
                    {sportLabel(s, lang)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {rehabMatches.length > 0 && (
            <div className="log-group">
              <span className="log-group-label">{lang === 'zh' ? '康复' : 'Rehab'}</span>
              <div className="log-chips">
                {rehabMatches.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    className={`log-chip rehab ${selectedId === ex.id ? 'is-selected' : ''}`}
                    onClick={() => onSelect(ex)}
                  >
                    {exerciseName(ex, lang)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {exGroups.map(({ bp, items }) => (
            <div key={bp} className="log-group">
              <span className="log-group-label">{categoryLabel(bp, lang)}</span>
              <div className="log-chips">
                {items.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    className={`log-chip ${selectedId === ex.id ? 'is-selected' : ''}`}
                    onClick={() => onSelect(ex)}
                  >
                    {exerciseName(ex, lang)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
