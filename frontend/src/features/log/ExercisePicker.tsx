// Exercise search/select grouped by the 7 body parts, showing each name in the
// current language (SPEC §7.1).
import { useMemo, useState } from 'react'
import { BODY_PARTS, BODY_PART_LABELS, type Exercise } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { exerciseName } from './util'

export function ExercisePicker({
  lang,
  exercises,
  selectedId,
  onSelect,
  onAddNew,
}: {
  lang: TranslationTarget
  exercises: Exercise[]
  selectedId: string | null
  onSelect: (ex: Exercise) => void
  onAddNew: (query: string) => void
}) {
  const [query, setQuery] = useState('')

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = exercises.filter(
      (e) =>
        !q ||
        e.name_zh.toLowerCase().includes(q) ||
        e.name_en.toLowerCase().includes(q),
    )
    return BODY_PARTS.map((bp) => ({
      bp,
      items: matches.filter((e) => e.body_part === bp),
    })).filter((g) => g.items.length > 0)
  }, [exercises, query])

  return (
    <div className="log-picker">
      <div className="log-row">
        <input
          className="th-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'zh' ? '搜索动作…' : 'Search exercises…'}
        />
        <button className="th-btn-ghost log-suggest" type="button" onClick={() => onAddNew(query)}>
          + New
        </button>
      </div>

      {exercises.length === 0 ? (
        <p className="log-empty">No exercises yet — add your first with “+ New”.</p>
      ) : grouped.length === 0 ? (
        <p className="log-empty">No match. Add it with “+ New”.</p>
      ) : (
        <div className="log-groups">
          {grouped.map(({ bp, items }) => (
            <div key={bp} className="log-group">
              <span className="log-group-label">{BODY_PART_LABELS[bp][lang]}</span>
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
