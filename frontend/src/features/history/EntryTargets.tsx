// One entry's cycle memberships (M2M, §6B) as editable rows: each row is a
// (split, round, day) target, and an entry can carry several — or none, which is
// free training that counts toward no split at all.
//
// Shared by the History assign dialog and the entry edit dialog so "free training",
// "new round (R5)" and multi-split assignment behave identically wherever you edit.
import type { CycleRound, EntryCycleAssignment, TrainingCycle, WorkoutEntry } from '../../supabase/types'
import { cycleDayTitle } from '../cycle/day'
import { nextRoundIndex, openRound } from '../cycle/rounds'

export interface UITarget { cycleId: string; roundId: string | null; dayLabel: string }

/** A fresh target's default round: the split's latest still-open round, else a new one. */
export function latestOpenRoundId(rounds: CycleRound[]): string | null {
  return openRound(rounds.filter((r) => !r.skipped))?.id ?? null
}

/** An entry's current targets — assignment rows, falling back to its legacy cycle_*
 *  columns for entries logged before the M2M table was populated. */
export function initialTargets(entry: WorkoutEntry, assignments: EntryCycleAssignment[]): UITarget[] {
  const rows = assignments
    .filter((a) => !a.deleted && a.entry_id === entry.id)
    .map((a) => ({ cycleId: a.cycle_id, roundId: a.cycle_round_id, dayLabel: a.cycle_day_label }))
  if (rows.length === 0 && entry.cycle_id && entry.cycle_day_label) {
    rows.push({ cycleId: entry.cycle_id, roundId: entry.cycle_round_id ?? null, dayLabel: entry.cycle_day_label })
  }
  return rows
}

/** "新一轮 (R5)" — the round picker always names the round it is about to create,
 *  so starting a new one is never a silent side effect. */
export function newRoundLabel(rounds: CycleRound[], lang: 'en' | 'zh'): string {
  const n = nextRoundIndex(rounds)
  return lang === 'zh' ? `新一轮 (R${n})` : `New round (R${n})`
}

export function roundOptionLabel(round: CycleRound, lang: 'en' | 'zh'): string {
  if (round.skipped) return `R${round.index} · ${lang === 'zh' ? '已跳过' : 'skipped'}`
  if (!round.ended_on) return `R${round.index} · ${lang === 'zh' ? '进行中' : 'open'}`
  return `R${round.index}`
}

export function EntryTargets({
  cycles,
  roundsByCycle,
  targets,
  lang,
  onChange,
}: {
  cycles: TrainingCycle[]
  roundsByCycle: Record<string, CycleRound[]>
  targets: UITarget[]
  lang: 'en' | 'zh'
  onChange: (next: UITarget[]) => void
}) {
  const firstCycle = cycles[0]?.id ?? ''
  const add = () =>
    onChange([...targets, { cycleId: firstCycle, roundId: latestOpenRoundId(roundsByCycle[firstCycle] ?? []), dayLabel: '' }])
  const remove = (i: number) => onChange(targets.filter((_, j) => j !== i))
  const patch = (i: number, p: Partial<UITarget>) => onChange(targets.map((t, j) => (j === i ? { ...t, ...p } : t)))

  return (
    <>
      {targets.length === 0 && (
        <p className="hist-assign-none">
          {lang === 'zh' ? '自由训练 · 不计入任何分化' : 'Free training · counts toward no split'}
        </p>
      )}
      {targets.map((tg, i) => {
        const rounds = roundsByCycle[tg.cycleId] ?? []
        const rs = [...rounds].sort((a, b) => b.index - a.index)
        const days = cycles.find((c) => c.id === tg.cycleId)?.days ?? []
        return (
          <div key={i} className="hist-assign-target">
            <select
              className="th-input"
              value={tg.cycleId}
              onChange={(ev) => patch(i, { cycleId: ev.target.value, roundId: latestOpenRoundId(roundsByCycle[ev.target.value] ?? []), dayLabel: '' })}
            >
              {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="th-input" value={tg.roundId ?? ''} onChange={(ev) => patch(i, { roundId: ev.target.value || null })}>
              <option value="">{newRoundLabel(rounds, lang)}</option>
              {rs.map((r) => <option key={r.id} value={r.id}>{roundOptionLabel(r, lang)}</option>)}
            </select>
            <select className="th-input" value={tg.dayLabel} onChange={(ev) => patch(i, { dayLabel: ev.target.value })}>
              <option value="">{lang === 'zh' ? '选日' : 'day'}</option>
              {days.map((d) => <option key={d.label} value={d.label}>{d.label} · {cycleDayTitle(d, lang)}</option>)}
            </select>
            <button type="button" className="hist-assign-x" onClick={() => remove(i)} aria-label="remove" title={lang === 'zh' ? '移除' : 'remove'}>×</button>
          </div>
        )
      })}
      <button type="button" className="hist-assign-add" onClick={add} disabled={cycles.length === 0}>
        + {lang === 'zh' ? '添加分化' : 'Add split'}
      </button>
    </>
  )
}
