// Per-set inputs driven by the exercise's measure_type (SPEC §6):
//   weight_reps → weight (lb) + reps      reps_only → reps (+ per-side)
//   duration    → mm:ss
import type { MeasureType } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { emptySet, type SetDraft } from './util'

export function SetEditor({
  lang,
  measureType,
  sets,
  onChange,
}: {
  lang: TranslationTarget
  measureType: MeasureType
  sets: SetDraft[]
  onChange: (sets: SetDraft[]) => void
}) {
  function update(i: number, patch: Partial<SetDraft>) {
    onChange(sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function remove(i: number) {
    onChange(sets.length > 1 ? sets.filter((_, idx) => idx !== i) : sets)
  }

  const perSideLabel = lang === 'zh' ? '每侧' : 'per side'

  return (
    <div className="log-sets">
      {sets.map((s, i) => (
        <div key={i} className="log-set">
          <span className="log-set-idx">{i + 1}</span>

          {measureType === 'weight_reps' && (
            <>
              <input className="th-input log-num" inputMode="decimal" value={s.weight}
                onChange={(e) => update(i, { weight: e.target.value })} placeholder="lb" aria-label="weight" />
              <span className="log-x">×</span>
              <input className="th-input log-num" inputMode="numeric" value={s.reps}
                onChange={(e) => update(i, { reps: e.target.value })} placeholder={lang === 'zh' ? '次' : 'reps'} aria-label="reps" />
            </>
          )}

          {measureType === 'reps_only' && (
            <input className="th-input log-num" inputMode="numeric" value={s.reps}
              onChange={(e) => update(i, { reps: e.target.value })} placeholder={lang === 'zh' ? '次' : 'reps'} aria-label="reps" />
          )}

          {measureType === 'duration' && (
            <input className="th-input log-num" value={s.duration}
              onChange={(e) => update(i, { duration: e.target.value })} placeholder="mm:ss" aria-label="duration" />
          )}

          {measureType !== 'duration' && (
            <label className="log-perside">
              <input type="checkbox" checked={s.per_side} onChange={(e) => update(i, { per_side: e.target.checked })} />
              {perSideLabel}
            </label>
          )}

          <button type="button" className="log-set-del" onClick={() => remove(i)} aria-label="remove set" disabled={sets.length === 1}>
            ×
          </button>
        </div>
      ))}

      <button type="button" className="th-btn-ghost log-addset" onClick={() => onChange([...sets, emptySet()])}>
        + add set
      </button>
    </div>
  )
}
