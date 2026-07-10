// Per-set inputs driven by the exercise's measure_type (SPEC §6). Each SET is its
// own record with its own type + note. A set can hold multiple SUB-SETS (superset /
// dropset): e.g. one set = 25×13 + 20×13. "+ 子组" adds a sub-set inside a set.
import type { MeasureType, SetType } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'
import { emptySet, emptySub, maskTime, type SetDraft, type SubDraft } from './util'

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
  durationHm = false,
  cardio = false,
  sets,
  onChange,
}: {
  lang: TranslationTarget
  measureType: MeasureType
  durationHm?: boolean
  cardio?: boolean            // show optional distance / calories / bpm inputs
  sets: SetDraft[]
  onChange: (sets: SetDraft[]) => void
}) {
  function update(i: number, patch: Partial<SetDraft>) {
    onChange(sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function updateSub(si: number, subi: number, patch: Partial<SubDraft>) {
    onChange(sets.map((s, idx) => (idx === si ? { ...s, subs: s.subs.map((sub, j) => (j === subi ? { ...sub, ...patch } : sub)) } : s)))
  }
  function addSub(si: number) {
    onChange(sets.map((s, idx) => (idx === si ? { ...s, subs: [...s.subs, emptySub()] } : s)))
  }
  function removeSub(si: number, subi: number) {
    onChange(sets.map((s, idx) => (idx === si ? { ...s, subs: s.subs.length > 1 ? s.subs.filter((_, j) => j !== subi) : s.subs } : s)))
  }
  function removeSet(i: number) {
    onChange(sets.length > 1 ? sets.filter((_, idx) => idx !== i) : sets)
  }

  const perSideLabel = lang === 'zh' ? '每侧' : 'per side'

  return (
    <div className="log-sets">
      {sets.map((s, i) => {
        const isMulti = s.set_type === 'superset' || s.set_type === 'dropset'
        return (
          <div key={i} className="log-set-block">
            <div className="log-set-top">
              <span className="log-set-idx">{i + 1}</span>
              <select className="th-input log-settype" value={s.set_type} onChange={(e) => update(i, { set_type: e.target.value as SetType })} aria-label="set type">
                {SET_TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t][lang]}</option>))}
              </select>
              {measureType !== 'duration' && (
                <label className="log-perside">
                  <input type="checkbox" checked={s.per_side} onChange={(e) => update(i, { per_side: e.target.checked })} />
                  {perSideLabel}
                </label>
              )}
              <button type="button" className="log-set-del" onClick={() => removeSet(i)} aria-label="remove set" disabled={sets.length === 1}>×</button>
            </div>

            {s.subs.map((sub, subi) => (
              <div key={subi} className="log-sub">
                {isMulti && <span className="log-sub-idx">{subi + 1}</span>}
                {measureType === 'weight_reps' && (
                  <>
                    <input className="th-input log-num" inputMode="decimal" value={sub.weight}
                      onChange={(e) => updateSub(i, subi, { weight: e.target.value })} placeholder="lb" aria-label="weight" />
                    <span className="log-x">×</span>
                    <input className="th-input log-num" inputMode="numeric" value={sub.reps}
                      onChange={(e) => updateSub(i, subi, { reps: e.target.value })} placeholder={lang === 'zh' ? '次' : 'reps'} aria-label="reps" />
                  </>
                )}
                {measureType === 'reps_only' && (
                  <input className="th-input log-num" inputMode="numeric" value={sub.reps}
                    onChange={(e) => updateSub(i, subi, { reps: e.target.value })} placeholder={lang === 'zh' ? '次' : 'reps'} aria-label="reps" />
                )}
                {measureType === 'duration' && (
                  <input className="th-input log-num" inputMode="numeric" value={sub.duration}
                    onChange={(e) => updateSub(i, subi, { duration: maskTime(e.target.value) })} placeholder={durationHm ? 'hh:mm' : 'mm:ss'} aria-label="duration" />
                )}
                {isMulti && s.subs.length > 1 && (
                  <button type="button" className="log-sub-del" onClick={() => removeSub(i, subi)} aria-label="remove sub-set">×</button>
                )}
              </div>
            ))}

            {isMulti && (
              <button type="button" className="th-btn-ghost log-addsub" onClick={() => addSub(i)}>
                {lang === 'zh' ? '+ 子组' : '+ sub-set'}
              </button>
            )}

            {cardio && (
              <div className="log-cardio">
                <input className="th-input log-num" inputMode="decimal" value={s.distance}
                  onChange={(e) => update(i, { distance: e.target.value })} placeholder={lang === 'zh' ? '距离mi' : 'dist mi'} aria-label="distance" />
                <input className="th-input log-num" inputMode="numeric" value={s.calories}
                  onChange={(e) => update(i, { calories: e.target.value })} placeholder={lang === 'zh' ? '卡路里' : 'kcal'} aria-label="calories" />
                <input className="th-input log-num" inputMode="numeric" value={s.bpm}
                  onChange={(e) => update(i, { bpm: e.target.value })} placeholder={lang === 'zh' ? '心率bpm' : 'bpm'} aria-label="heart rate" />
              </div>
            )}

            <input className="th-input log-set-note" value={s.note} onChange={(e) => update(i, { note: e.target.value })}
              placeholder={lang === 'zh' ? '本组笔记(如 力竭)' : 'set note (e.g. to failure)'} />
          </div>
        )
      })}

      <button type="button" className="th-btn-ghost log-addset" onClick={() => onChange([...sets, { ...emptySet(), per_side: sets[sets.length - 1]?.per_side ?? false }])}>
        {lang === 'zh' ? '+ 加一组' : '+ add set'}
      </button>
    </div>
  )
}
