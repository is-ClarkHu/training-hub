// Presentational History rows, shared by the History screen and the long-image
// export. They live here so the export renders the EXACT same components the user
// sees rather than a parallel re-implementation — the old export had its own
// simplified copy and drifted (no circuits, wrong sport/intimacy rows, ad-hoc
// module blocks). Interactive affordances are driven by props; the export passes
// no-ops and hides the remaining chrome via CSS scoped to .hx-sheet.
import { useState } from 'react'
import { categoryKeys, categoryLabel } from '../../categories'
import { noteTagLabel } from '../../translation'
import type { Exercise, ExerciseSet, OptionalTracker, Sport, SportSession, WorkoutEntry } from '../../supabase/types'
import { sportName, attrLabel } from '../sports'
import { intimacyCategory, intimacyLabel } from '../intimacy'
import {
  ACTIVITY_COLORS,
  displayNote,
  exerciseKind,
  exerciseName,
  exerciseNeedsTranslation,
  formatHours,
  formatMetrics,
  formatSetLine,
  entryModule,
} from '../log/util'
import { EditEntryDialog } from './EditEntryDialog'

/** Loop context for a date: which split day(s) were trained, and the round(s).
 *  A date can span several rounds now (M2M, §6B) — e.g. R2's leg day + R3's chest
 *  day logged together. */
export interface LoopInfo {
  labels: { label: string; title: string }[]
  rounds: number[]
}

/** Group a date's entries into category modules, ordered by category order. */
export function groupByModule(
  items: WorkoutEntry[],
  exById: Record<string, Exercise>,
): { key: string; items: WorkoutEntry[] }[] {
  const order = categoryKeys()
  const groups = new Map<string, WorkoutEntry[]>()
  for (const e of items) {
    const ex = exById[e.exercise_id]
    const key = entryModule(e, ex) ?? '__none'
    const arr = groups.get(key)
    if (arr) arr.push(e)
    else groups.set(key, [e])
  }
  return [...groups.entries()]
    .map(([key, its]) => ({ key, items: its }))
    .sort((a, b) => {
      const ai = order.indexOf(a.key); const bi = order.indexOf(b.key)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
}

/** Split a date's entries into circuits (≥2 entries sharing a superset_group —
 *  alternating/交替 movements) and standalone singles. */
export function partitionCircuits(items: WorkoutEntry[]): { circuits: WorkoutEntry[][]; singles: WorkoutEntry[] } {
  const groups = new Map<string, WorkoutEntry[]>()
  const singles: WorkoutEntry[] = []
  for (const e of items) {
    if (e.superset_group) {
      const g = groups.get(e.superset_group)
      if (g) g.push(e); else groups.set(e.superset_group, [e])
    } else singles.push(e)
  }
  const circuits: WorkoutEntry[][] = []
  for (const g of groups.values()) { if (g.length >= 2) circuits.push(g); else singles.push(...g) }
  return { circuits, singles }
}

export function setSummary(sets: ExerciseSet[], lang: 'en' | 'zh'): string {
  const base = `${sets.length} ${lang === 'zh' ? '组' : sets.length === 1 ? 'set' : 'sets'}`
  const extras = [
    ['superset', sets.filter((s) => s.set_type === 'superset').length],
    ['dropset', sets.filter((s) => s.set_type === 'dropset').length],
  ] as const
  const shown = extras.filter(([, n]) => n > 0)
  if (shown.length === 0) return base
  const suffix = shown.map(([type, n]) => {
    if (lang === 'zh') return `${n}组${type === 'superset' ? '超级组' : '递减组'}`
    return `${n} ${type}${n === 1 ? '' : 's'}`
  }).join(lang === 'zh' ? '、' : ', ')
  return lang === 'zh' ? `${base}（含${suffix}）` : `${base} (${suffix})`
}

export function SportRow({
  ss, sport, lang, selectMode, selected, onToggle, onOpen,
}: {
  ss: SportSession
  sport: Sport | undefined
  lang: 'en' | 'zh'
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const levelField = sport?.fields?.find((f) => f.type === 'select' && ss.attributes?.[f.key])
  const level = levelField ? attrLabel(levelField, ss.attributes[levelField.key], lang) : null
  const detailFields = (sport?.fields ?? []).filter((f) => f.key !== levelField?.key)
  return (
    <div
      className={`hist-row hist-sport ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`}
      onClick={() => (selectMode ? onToggle() : onOpen())}
    >
      {selectMode && (
        <input type="checkbox" className="hist-check" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="select" />
      )}
      <div className="hist-row-main">
        <div className="hist-row-top">
          <span className="hist-dot" style={{ background: ACTIVITY_COLORS.sport }} />
          <span className="hist-name">🏃 {sport ? sportName(sport, lang) : '(sport)'}</span>
          {level && <span className="hist-sport-level">{level}</span>}
          {ss.injury && <span className="hist-badge injury">{lang === 'zh' ? '带伤' : 'injury'}</span>}
        </div>
        <div className="hist-sets">
          <span className="hist-set">{formatHours(ss.hours)}{formatMetrics(ss)}</span>
          {detailFields.map((f) => ss.attributes?.[f.key] && (
            <span key={f.key} className="hist-settype">{attrLabel(f, ss.attributes[f.key], lang)}</span>
          ))}
        </div>
        {ss.note_raw && <div className="hist-tags"><span className="hist-note-inline">{ss.note_raw}</span></div>}
      </div>
    </div>
  )
}

export function IntimacyRow({
  r, lang, discreet, selectMode, selected, onToggle, onOpen,
}: {
  r: OptionalTracker
  lang: 'en' | 'zh'
  discreet: boolean
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={`hist-row hist-intimacy ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`}
      onClick={() => (selectMode ? onToggle() : onOpen())}
    >
      {selectMode && (
        <input type="checkbox" className="hist-check" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="select" />
      )}
      <div className="hist-row-main">
        <div className="hist-row-top">
          <span className="hist-dot" style={{ background: '#f472b6' }} />
          <span className="hist-name">{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</span>
        </div>
        {!discreet && (
          <div className="hist-sets">
            <span className="hist-intimacy-pill">{intimacyLabel(intimacyCategory(r), lang)}</span>
            <span className="hist-set">×{r.count}</span>
            {r.note && <em className="hist-setnote"> · {r.note}</em>}
          </div>
        )}
      </div>
    </div>
  )
}

export function CircuitCard({
  members,
  exById,
  setMap,
  lang,
  discreet,
  onUnmerge,
  variant = 'card',
}: {
  members: WorkoutEntry[]
  exById: Record<string, Exercise>
  setMap: Record<string, ExerciseSet[]>
  lang: 'en' | 'zh'
  discreet: boolean
  onUnmerge: () => void
  variant?: 'row' | 'card'
}) {
  const cols = members.map((e) => ({ ex: exById[e.exercise_id], sets: setMap[e.id] ?? [] }))
  const maxRounds = Math.max(0, ...cols.map((c) => c.sets.length))
  // Body parts this circuit trains = the displayed part of each member (its chosen
  // module_part, else the exercise's primary category), deduped.
  const parts = [
    ...new Set(
      members
        .map((e) => entryModule(e, exById[e.exercise_id]))
        .filter((p): p is string => !!p),
    ),
  ]
  // Flatten to one line per set, in the order performed (set 1 of each movement,
  // then set 2, …). Uneven set counts just contribute fewer lines.
  const lines: { name: string; set: ExerciseSet; ex: Exercise }[] = []
  for (let r = 0; r < maxRounds; r++) {
    for (const c of cols) {
      const st = c.sets[r]
      if (st && c.ex) lines.push({ name: exerciseName(c.ex, lang), set: st, ex: c.ex })
    }
  }
  return (
    <div className={`hist-circuit ${variant === 'row' ? 'wide' : ''}`}>
      <div className="hist-circuit-top">
        <span className="hist-dot" style={{ background: ACTIVITY_COLORS.bodyweight }} />
        <span className="hist-name">{lang === 'zh' ? '循环 · 交替' : 'Circuit'}</span>
        {parts.length > 0 && (
          <span className="hist-circuit-bp">
            {parts.map((p) => (
              <span key={p} className="hist-bpchip">{categoryLabel(p, lang)}</span>
            ))}
          </span>
        )}
        <button type="button" className="hist-circuit-split" onClick={onUnmerge}>{lang === 'zh' ? '拆开' : 'split'}</button>
      </div>
      {variant === 'row' ? (
        // List/bar mode: full-width 2-row table — headers = movements, row below = what
        // was done (each set stacked under its movement; just set counts when discreet).
        <div className="hist-circuit-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c, i) => (
            <div key={`h${i}`} className="hist-circuit-col-head">{c.ex ? exerciseName(c.ex, lang) : '–'}</div>
          ))}
          {cols.map((c, i) => (
            <div key={`v${i}`} className="hist-circuit-col-sets">
              {discreet ? (
                <span className="hist-set">{c.sets.length} {lang === 'zh' ? '组' : 'sets'}</span>
              ) : (
                c.sets.map((s) => (
                  <span key={s.id} className="hist-set">{c.ex ? formatSetLine(s, c.ex.measure_type, lang, c.ex.duration_hm) : '–'}</span>
                ))
              )}
            </div>
          ))}
        </div>
      ) : discreet ? (
        // Grouped/card compact: which movements + how many sets each, no reps/weights.
        <div className="hist-circuit-flat">
          {cols.map((c, i) =>
            c.ex ? (
              <div key={i} className="hist-circuit-line">
                <span className="hist-circuit-nm">{exerciseName(c.ex, lang)}</span>
                <span className="hist-set">{c.sets.length} {lang === 'zh' ? '组' : 'sets'}</span>
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <div className="hist-circuit-flat">
          {lines.map((ln, i) => (
            <div key={i} className="hist-circuit-line">
              <span className="hist-circuit-nm">{ln.name}</span>
              <span className="hist-set">{formatSetLine(ln.set, ln.ex.measure_type, lang, ln.ex.duration_hm)}</span>
              {ln.set.note && <em className="hist-setnote"> · {ln.set.note}</em>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function EntryCard({
  entry,
  exercise,
  allExercises,
  sets,
  lang,
  onChanged,
  selectMode,
  selected,
  onToggleSelect,
  discreet,
  variant,
  onChooseModule,
  reorderMode = false,
  onDragStart,
}: {
  entry: WorkoutEntry
  exercise: Exercise | undefined
  allExercises: Exercise[]
  sets: ExerciseSet[]
  lang: 'en' | 'zh'
  onChanged: () => Promise<void> | void
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  discreet: boolean
  variant: 'row' | 'card'
  onChooseModule: () => void
  reorderMode?: boolean
  onDragStart?: (ev: React.PointerEvent) => void
}) {
  const [editing, setEditing] = useState(false)

  const needsAttention =
    entry.needs_review ||
    entry.needs_translation ||
    exerciseNeedsTranslation(exercise)

  const name = exercise ? exerciseName(exercise, lang) : '(deleted exercise)'
  // Hidden during select mode so the ⇄ chip doesn't collide with the checkbox.
  const canChooseModule = variant === 'card' && !selectMode && !reorderMode && !!exercise && exercise.body_parts.length > 1

  const badges = (
    <>
      {entry.injury_modified && (
        <span className="hist-badge injury">{entry.injury_modified === 'paused' ? (lang === 'zh' ? '因伤暂停' : 'paused') : (lang === 'zh' ? '因伤减量' : 'reduced')}</span>
      )}
      {entry.needs_review && <span className="hist-badge review">{lang === 'zh' ? '待复核' : 'review'}</span>}
      {(entry.needs_translation || exerciseNeedsTranslation(exercise)) && (
        <span className="hist-badge translate">{lang === 'zh' ? '待翻译' : 'translate'}</span>
      )}
    </>
  )

  const setsBlock = discreet ? (
    <span className="hist-set">{setSummary(sets, lang)}</span>
  ) : (
    sets.map((s) => (
      <span key={s.id} className="hist-set">
        {exercise ? formatSetLine(s, exercise.measure_type, lang, exercise.duration_hm) : '–'}
        {s.set_type !== 'normal' && <em className="hist-settype"> {s.set_type}</em>}
        {s.note && <em className="hist-setnote"> · {s.note}</em>}
      </span>
    ))
  )

  // Note-tag chips + the raw note (with any legacy "lb；" unit prefix stripped).
  const shownNote = displayNote(entry.note_raw)
  const notesBlock = (shownNote || entry.note_tags.length > 0) && (
    <div className="hist-tags">
      {entry.note_tags.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
      {shownNote && <span className="hist-note-inline">{shownNote}</span>}
    </div>
  )

  const onClick = () => (selectMode ? onToggleSelect() : exercise && setEditing(true))

  const dialog = editing && exercise && (
    <EditEntryDialog
      entry={entry}
      exercise={exercise}
      allExercises={allExercises}
      sets={sets}
      lang={lang}
      onChanged={onChanged}
      onClose={() => setEditing(false)}
    />
  )

  if (variant === 'card') {
    return (
      <>
        <div
          data-eid={entry.id}
          className={`hist-card ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''} ${!selectMode && !reorderMode ? 'clickable' : ''} ${reorderMode ? 'reordering' : ''}`}
          onClick={reorderMode ? undefined : onClick}
        >
          <div className="hist-card-top">
            {reorderMode && (
              <button type="button" className="hist-drag" aria-label={lang === 'zh' ? '拖动排序' : 'drag to reorder'}
                onPointerDown={onDragStart} onClick={(e) => e.stopPropagation()} style={{ touchAction: 'none' }}>⠿</button>
            )}
            <span className="hist-dot" style={{ background: exercise ? ACTIVITY_COLORS[exerciseKind(exercise)] : 'var(--text-dim)' }} />
            <span className="hist-name">{name}</span>
            {selectMode && (
              <input type="checkbox" className="hist-check" checked={selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} aria-label="select" />
            )}
          </div>
          <div className="hist-card-badges">{badges}</div>
          <div className="hist-card-sets">{setsBlock}</div>
          {notesBlock}
          {canChooseModule && (
            <button
              type="button"
              className="hist-module-chip"
              title={lang === 'zh' ? '改归到其他模块' : 'File under another module'}
              onClick={(e) => { e.stopPropagation(); onChooseModule() }}
            >
              ⇄
            </button>
          )}
        </div>
        {dialog}
      </>
    )
  }

  return (
    <>
      <div className={`hist-row ${needsAttention ? 'needs' : ''} ${selected ? 'sel' : ''} ${selectMode ? '' : 'clickable'}`} onClick={onClick}>
        {selectMode && (
          <input type="checkbox" className="hist-check" checked={selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} aria-label="select" />
        )}
        <div className="hist-row-main">
          <div className="hist-row-top">
            <span className="hist-dot" style={{ background: exercise ? ACTIVITY_COLORS[exerciseKind(exercise)] : 'var(--text-dim)' }} />
            <span className="hist-name">{name}</span>
            {badges}
          </div>
          <div className="hist-sets">{setsBlock}</div>
          {notesBlock}
        </div>
      </div>
      {dialog}
    </>
  )
}
