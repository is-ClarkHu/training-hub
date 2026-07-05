// Per-set inputs driven by the exercise's measure_type (SPEC §6). Each set is its
// own record with its own type (normal/warmup/dropset) and its own note (§5.3).
import type { MeasureType, SetType } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { emptySet, type SetDraft } from './util'

const SET_TYPES: SetType[] = ['normal', 'warmup', 'superset', 'dropset']
const TYPE_LABEL: Record<SetType, { zh: string; en: string }> = {
  normal: { zh: '常规', en: 'normal' },
  warmup: { zh: '热身', en: 'warmup' },
  dropset: { zh: '递减', en: 'dropset' },
  superset: { zh: '超级组', en: 'superset' },
}

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
        <div key={i} className="log-set-block">
          <div className="log-set">
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

            <select className="th-input log-settype" value={s.set_type} onChange={(e) => update(i, { set_type: e.target.value as SetType })} aria-label="set type">
              {SET_TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t][lang]}</option>))}
            </select>

            <button type="button" className="log-set-del" onClick={() => remove(i)} aria-label="remove set" disabled={sets.length === 1}>×</button>
          </div>

          <input className="th-input log-set-note" value={s.note} onChange={(e) => update(i, { note: e.target.value })}
            placeholder={lang === 'zh' ? '本组笔记(如 力竭)' : 'set note (e.g. to failure)'} />
        </div>
      ))}

      <button type="button" className="th-btn-ghost log-addset" onClick={() => onChange([...sets, { ...emptySet(), per_side: sets[sets.length - 1]?.per_side ?? false }])}>
        {lang === 'zh' ? '+ 加一组' : '+ add set'}
      </button>
    </div>
  )
}
