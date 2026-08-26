// Log tab (SPEC §7.1, redesigned): one place to log everything. Pick an activity
// — a strength exercise (→ per-set inputs) or a sport (→ tier + hours). Date is
// shared; when an active training cycle is set you can tag the cycle day and the
// day's planned exercises appear as a quick-pick. Local-first writes.
import { useCallback, useEffect, useState } from 'react'
import {
  createEntryWithSets,
  createSportSession,
  ensureCycleRound,
  getActiveCycle,
  getCycles,
  getCycleRounds,
  getEntries,
  getExercises,
  getInjuries,
  getSetsByEntryIds,
  getSports,
  getSportSessions,
  getExerciseHistory,
  getTrackerEntries,
  logTracker,
  newId,
  patchEntry,
  recordCycleDay,
  softDeleteEntry,
  softDeleteSportSession,
  deleteTrackerEntry,
  today,
  withUndo,
  type NewSetInput,
} from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import { useUndo } from '../../undo'
import { fieldLabel } from '../sports'
import { currentRound, nextRoundIndex, targetRoundFor } from '../cycle/rounds'
import { cycleDayOptionLabel, cycleDayTitle, dayMatchScore, suggestCycleDay } from '../cycle/day'
import { INTIMACY_CATEGORIES, intimacyLabel, intimacyVisible } from '../intimacy'
import type {
  CycleRound,
  Exercise,
  ExerciseSet,
  IntimacyCategory,
  Injury,
  InjuryModified,
  Sport,
  SportSession,
  TrainingCycle,
  WorkoutEntry,
} from '../../supabase/types'
import { AddInjuryDialog, bodyAreaLabel } from '../injuries'
import { EditEntryDialog } from '../history/EditEntryDialog'
import { SportSessionDialog } from '../sports'
import { ExercisePicker } from './ExercisePicker'
import { SetEditor } from './SetEditor'
import { AddExerciseDialog } from './AddExerciseDialog'
import { draftsToSetInputs, emptySet, exerciseName, exerciseSummary, formatMetrics, formatSetLine, formatSubSet, parseHours, formatHours, toNumber, type ExerciseSummary, type SetDraft } from './util'
import './log.css'

type Selection =
  | { kind: 'exercise'; ex: Exercise }
  | { kind: 'sport'; sport: Sport }
  | null

// A row in "logged this session". Carries the underlying record so the row can open
// the same edit dialogs History uses — fixing a just-logged set (or its split) is the
// most common thing you do right after saving, and it used to mean leaving the tab.
interface LoggedItem {
  id: string
  name: string
  detail: string
  tagKeys: string[]
  kind: 'exercise' | 'sport' | 'intimacy'
  realId: string
  group?: string
  entry?: WorkoutEntry
  sets?: ExerciseSet[]
  session?: SportSession
}

export function LogScreen() {
  const { lang } = useLanguage()
  const { push } = useUndo()
  const [date, setDate] = useState(today())
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [activeInjuries, setActiveInjuries] = useState<Injury[]>([])
  const [cycles, setCycles] = useState<TrainingCycle[]>([])
  const [roundsByCycle, setRoundsByCycle] = useState<Record<string, CycleRound[]>>({})
  const [activeCycleId, setActiveCycleId] = useState('')
  const [cycleSel, setCycleSel] = useState('') // "cycleId::label" — a day from any cycle
  const [dayAuto, setDayAuto] = useState(false) // day was aimed from the exercise, not picked

  const [sel, setSel] = useState<Selection>(null)
  const [dialog, setDialog] = useState<{ open: boolean; name: string }>({ open: false, name: '' })
  const [logged, setLogged] = useState<LoggedItem[]>([])
  const [editing, setEditing] = useState<LoggedItem | null>(null)
  const [circuitSel, setCircuitSel] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // exercise form
  const [sets, setSets] = useState<SetDraft[]>([emptySet()])
  const [exSummary, setExSummary] = useState<ExerciseSummary | null>(null)
  const [injuryMod, setInjuryMod] = useState<InjuryModified | 'none'>('none')
  const [injuryId, setInjuryId] = useState('')
  const [injuryDialog, setInjuryDialog] = useState(false)
  // sport form
  const [hours, setHours] = useState('')
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [sportCal, setSportCal] = useState('')
  const [sportBpm, setSportBpm] = useState('')
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [intimacyCat, setIntimacyCat] = useState<IntimacyCategory>('partner_active')
  const [intimacyCount, setIntimacyCount] = useState(1)
  const [intimacyNote, setIntimacyNote] = useState('')
  // shared
  const [note, setNote] = useState('')

  useEffect(() => {
    void getExercises().then(setExercises)
    void getSports().then(setSports)
    void getInjuries().then((l) => setActiveInjuries(l.filter((i) => i.status !== 'recovered')))
    void (async () => {
      const [cs, active] = await Promise.all([getCycles(), getActiveCycle()])
      setCycles(cs)
      const pairs = await Promise.all(cs.map(async (c) => [c.id, await getCycleRounds(c.id)] as const))
      const byCycle = Object.fromEntries(pairs)
      setRoundsByCycle(byCycle)
      setActiveCycleId(active?.id ?? '')
      // Seed the picker with the active cycle's next owed day so "today's plan" has
      // something to show. It is only a starting point: picking an exercise re-aims
      // the day at what that exercise actually trains (`aimCycleDay`). Leaving it
      // fixed is what filed back workouts under the chest day — which completed that
      // day, closed the round, and silently opened the next one.
      if (active && active.days.length > 0) {
        const rv = currentRound(active, byCycle[active.id] ?? [])
        if (rv.nextLabel) setCycleSel(`${active.id}::${rv.nextLabel}`)
      }
    })()
    setShowIntimacy(intimacyVisible())
  }, [])

  const reloadRounds = async () => {
    const pairs = await Promise.all(cycles.map(async (c) => [c.id, await getCycleRounds(c.id)] as const))
    setRoundsByCycle(Object.fromEntries(pairs))
  }

  // Today's logged items, rebuilt from the store so the list survives navigating
  // away and back (it's not just this-session memory). Keyed by the real row id.
  const loadToday = useCallback(async () => {
    const [es, ss, exs] = await Promise.all([getEntries(), getSportSessions(), getExercises()])
    const dayEntries = es.filter((e) => e.date === date)
    const setsMap = await getSetsByEntryIds(dayEntries.map((e) => e.id))
    const exMap = Object.fromEntries(exs.map((e) => [e.id, e]))
    const items: LoggedItem[] = []
    for (const e of dayEntries) {
      const ex = exMap[e.exercise_id]
      const esets = setsMap[e.id] ?? []
      items.push({
        id: e.id, realId: e.id, kind: 'exercise',
        name: ex ? exerciseName(ex, lang) : '(deleted)',
        detail: ex ? esets.map((s) => formatSetLine(s, ex.measure_type, lang, ex.duration_hm)).join(' · ') : '',
        tagKeys: e.note_tags, group: e.superset_group ?? undefined,
        entry: e, sets: esets,
      })
    }
    for (const s of ss.filter((x) => x.date === date)) {
      const sp = sports.find((x) => x.id === s.sport_id)
      const attrSummary = (sp?.fields ?? []).map((f) => s.attributes?.[f.key]).filter(Boolean).join(' · ')
      items.push({
        id: s.id, realId: s.id, kind: 'sport',
        name: sp ? (lang === 'zh' ? sp.name_zh : sp.name_en) || sp.name_zh : 'sport',
        detail: `${formatHours(s.hours)}${attrSummary ? ' · ' + attrSummary : ''}${formatMetrics(s)}${s.injury ? ' · injury' : ''}`,
        tagKeys: s.note_tags,
        session: s,
      })
    }
    if (intimacyVisible()) {
      const trackers = await getTrackerEntries('intimacy')
      for (const r of trackers.filter((x) => x.date === date)) {
        items.push({
          id: r.id, realId: r.id, kind: 'intimacy',
          name: lang === 'zh' ? '成人亲密健康' : 'Adult wellness',
          detail: `${intimacyLabel(r.category ?? 'partner_active', lang, true)} ×${r.count}${r.note ? ' · ' + r.note : ''}`,
          tagKeys: [],
        })
      }
    }
    setLogged(items)
  }, [date, lang, sports])

  useEffect(() => { void loadToday() }, [loadToday])
  const selCycle = cycleSel ? cycles.find((c) => c.id === cycleSel.split('::')[0]) ?? null : null
  const selLabel = cycleSel ? cycleSel.split('::')[1] : ''
  const selDay = selCycle?.days.find((d) => d.label === selLabel) ?? null
  // Which round this log will land in — resolved exactly the way the write does
  // (`ensureCycleRound` → `targetRoundFor`), so the hint, the warning and the write can
  // never disagree about whether saving starts a new round.
  const selRounds = selCycle ? roundsByCycle[selCycle.id] ?? [] : []
  const targetRound = selCycle && selCycle.days.length > 0 ? targetRoundFor(selCycle, selRounds, date) : null
  const opensNewRound = !!selCycle && !!selLabel && !targetRound
  const newRoundIndex = selCycle ? nextRoundIndex(selRounds) : 0
  const dayLabels = selCycle?.days.map((d) => d.label) ?? []
  const roundDone = targetRound ? dayLabels.filter((l) => targetRound.completed_labels.includes(l)) : []
  const roundRemaining = dayLabels.filter((l) => !roundDone.includes(l))
  // The picked day trains nothing this exercise does — the mis-file that used to
  // quietly burn a round. `suggestedLabel` offers the day that does, when there is one.
  const suggestedLabel = sel?.kind === 'exercise' && selCycle ? suggestCycleDay(selCycle, sel.ex, roundRemaining) : null
  const dayMismatch = !!selDay && sel?.kind === 'exercise' && dayMatchScore(selDay, sel.ex) <= 0

  const parsed = parseNote(note)

  /** Aim the cycle day at the day that actually trains this exercise (null = free
   *  training). Runs on selection only, so a manual pick inside the modal sticks. */
  function aimCycleDay(ex: Exercise) {
    const cycle = selCycle ?? cycles.find((c) => c.id === activeCycleId) ?? null
    if (!cycle || cycle.days.length === 0) return
    const rounds = roundsByCycle[cycle.id] ?? []
    const target = targetRoundFor(cycle, rounds, date)
    const owed = cycle.days.map((d) => d.label).filter((l) => !target?.completed_labels.includes(l))
    const label = suggestCycleDay(cycle, ex, owed)
    setCycleSel(label ? `${cycle.id}::${label}` : '')
    setDayAuto(!!label)
  }
  function pickCycleDay(value: string) {
    setCycleSel(value)
    setDayAuto(false)
  }

  function resetForms() {
    setSets([emptySet()])
    setInjuryMod('none')
    setInjuryId('')
    setHours('')
    setAttrs({})
    setSportCal('')
    setSportBpm('')
    setNote('')
  }
  function selectExercise(ex: Exercise) {
    setSel({ kind: 'exercise', ex })
    resetForms()
    if (ex.default_per_side) setSets([{ ...emptySet(), per_side: true }]) // learned default (§ per-side)
    aimCycleDay(ex)
  }
  function selectSport(sport: Sport) {
    setSel({ kind: 'sport', sport })
    resetForms()
  }
  function closeEntryModal() {
    if (saving) return
    setSel(null)
    resetForms()
  }
  function onExerciseCreated(ex: Exercise) {
    setExercises((prev) => [...prev, ex])
    setDialog({ open: false, name: '' })
    selectExercise(ex)
  }

  // PR + last-session line for the open exercise. Recomputes when the exercise or the
  // log date changes, and after a save (logged) so a just-logged set folds in.
  useEffect(() => {
    if (sel?.kind !== 'exercise') { setExSummary(null); return }
    const ex = sel.ex
    let cancelled = false
    void (async () => {
      const history = await getExerciseHistory(ex.id)
      if (!cancelled) setExSummary(exerciseSummary(history, ex.measure_type, ex.assisted, date))
    })()
    return () => { cancelled = true }
  }, [sel, date, logged])

  // Log → injury one-step: register a new injury here and auto-link it to the
  // exercise being logged (defaults the impact to "reduced"). Fresh injuries are
  // active, so they belong in the active list immediately.
  function onInjuryCreated(inj: Injury) {
    setActiveInjuries((prev) => (inj.status !== 'recovered' ? [inj, ...prev] : prev))
    setInjuryId(inj.id)
    if (injuryMod === 'none') setInjuryMod('reduced')
    setInjuryDialog(false)
  }

  // day's planned exercises (§6B) as a quick-pick
  const planExercises: Exercise[] = (() => {
    const day = selCycle?.days.find((d) => d.label === selLabel)
    if (!day?.exercise_ids?.length) return []
    return day.exercise_ids.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e)
  })()

  function buildSets(): NewSetInput[] {
    if (sel?.kind !== 'exercise') return []
    return draftsToSetInputs(sets, sel.ex.measure_type, parsed, sel.ex.duration_hm)
  }

  const canSaveExercise = sel?.kind === 'exercise' && buildSets().length > 0 && !saving
  const canSaveSport = sel?.kind === 'sport' && (parseHours(hours) ?? 0) > 0 && !saving

  async function saveExercise() {
    if (sel?.kind !== 'exercise') return
    const setInputs = buildSets()
    if (setInputs.length === 0) return
    // Tagging a cycle day advances THAT cycle's current round (§6B) — days can
    // come from any cycle (multiple splits/day). Kept inside withUndo so undo
    // also rewinds the round.
    const roundCycle = selCycle && selLabel ? selCycle : null
    // Starting a round is never a side effect: say so and let the user back out.
    if (roundCycle && opensNewRound) {
      const ok = confirm(lang === 'zh'
        ? `上一轮已练完(或已跳过)，保存这条会开启新一轮 R${newRoundIndex}。继续?`
        : `The last round is complete (or was skipped) — saving this starts round R${newRoundIndex}. Continue?`)
      if (!ok) return
    }
    setSaving(true)
    const exName = exerciseName(sel.ex, lang)
    const { undo } = await withUndo(['workout_entries', 'sets', 'cycle_rounds', 'entry_cycle_assignments'], async () => {
      // Resolve (or open) the round FIRST and stamp it on the entry, instead of
      // leaving membership to be re-guessed from date ranges later — a date can sit
      // inside two rounds' spans, which is how one workout ended up counted twice.
      const round = roundCycle ? (await ensureCycleRound(roundCycle, date)).round : null
      const res = await createEntryWithSets(
        {
          date,
          exercise_id: sel.ex.id,
          is_superset: setInputs.some((s) => s.set_type === 'superset'),
          note_raw: note,
          note_tags: parsed.tagKeys,
          cycle_day_label: roundCycle ? selLabel : null,
          cycle_id: roundCycle?.id ?? null,
          cycle_round_id: round?.id ?? null,
          // rehab moves link straight to the injury they rehab (no modified flag);
          // strength lifts only link when marked reduced/paused.
          injury_modified: sel.ex.is_rehab ? null : injuryMod === 'none' ? null : injuryMod,
          injury_id: sel.ex.is_rehab ? injuryId || null : injuryMod === 'none' ? null : injuryId || null,
        },
        setInputs,
      )
      if (roundCycle) await recordCycleDay(roundCycle, selLabel, date)
      return res
    })
    if (roundCycle) void reloadRounds()
    finishSave()
    push(lang === 'zh' ? `已记录「${exName}」` : `Logged “${exName}”`, async () => {
      await undo()
      await loadToday()
      if (roundCycle) void reloadRounds()
    })
  }

  async function saveSport() {
    if (sel?.kind !== 'sport') return
    const h = parseHours(hours)
    if (!h || h <= 0) return
    setSaving(true)
    const injured = activeInjuries.length > 0 // auto: derived from active injuries (§6A)
    const sportName = (lang === 'zh' ? sel.sport.name_zh : sel.sport.name_en) || sel.sport.name_zh
    const { undo } = await withUndo(['sport_sessions'], () => createSportSession({
      date,
      sport_id: sel.sport.id,
      hours: h,
      attributes: attrs,
      injury: injured,
      note_raw: note,
      note_tags: parsed.tagKeys,
      calories: toNumber(sportCal),
      bpm: toNumber(sportBpm),
    }))
    finishSave()
    push(lang === 'zh' ? `已记录「${sportName}」` : `Logged “${sportName}”`, async () => {
      await undo()
      await loadToday()
    })
  }

  const bumpCount = (d: number) => setIntimacyCount((n) => Math.min(20, Math.max(1, n + d)))

  async function saveIntimacy() {
    const n = intimacyCount
    if (!Number.isFinite(n) || n <= 0 || saving) return
    setSaving(true)
    const { undo } = await withUndo(['optional_trackers'], () => logTracker('intimacy', date, n, intimacyCat, intimacyNote))
    const name = lang === 'zh' ? '成人亲密健康' : 'Adult wellness'
    setIntimacyCount(1)
    setIntimacyNote('')
    setSaving(false)
    void loadToday()
    push(lang === 'zh' ? `已记录「${name}」` : `Logged “${name}”`, async () => {
      await undo()
      await loadToday()
    })
  }

  function finishSave() {
    setSel(null)
    resetForms()
    setSaving(false)
    void loadToday()
  }

  function toggleCircuit(itemId: string) {
    setCircuitSel((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
      return next
    })
  }
  // Mark the selected just-logged exercises as one circuit (alternating movements) —
  // same superset_group used by the History merge, so it shows round-major there.
  async function mergeLoggedCircuit() {
    const picks = logged.filter((x) => x.kind === 'exercise' && circuitSel.has(x.id))
    if (picks.length < 2) return
    const gid = newId()
    for (const p of picks) await patchEntry(p.realId, { superset_group: gid })
    setCircuitSel(new Set())
    await loadToday()
  }

  // Intimacy rows have no shared edit dialog (History owns that one); everything else
  // opens the same modal History uses.
  function canEditLogged(item: LoggedItem): boolean {
    if (item.kind === 'exercise') return !!item.entry && exercises.some((e) => e.id === item.entry!.exercise_id)
    if (item.kind === 'sport') return !!item.session
    return false
  }

  async function afterEdit() {
    setEditing(null)
    await loadToday()
    await reloadRounds()
  }

  async function deleteLogged(item: LoggedItem) {
    const tables = item.kind === 'exercise' ? ['workout_entries', 'sets'] : item.kind === 'sport' ? ['sport_sessions'] : ['optional_trackers']
    const { undo } = await withUndo(tables, async () => {
      if (item.kind === 'exercise') await softDeleteEntry(item.realId)
      else if (item.kind === 'sport') await softDeleteSportSession(item.realId)
      else await deleteTrackerEntry(item.realId)
    })
    void loadToday()
    push(lang === 'zh' ? `已删除「${item.name}」` : `Deleted “${item.name}”`, async () => {
      await undo()
      await loadToday()
    })
  }

  return (
    <div className="log-screen">
      <header className="log-head">
        <div className="log-field">
          <label className="th-label" htmlFor="log-date">{lang === 'zh' ? '日期' : 'Date'}</label>
          <input id="log-date" className="th-input log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {cycles.some((c) => c.days.length > 0) && (
          <div className="log-field">
            <label className="th-label" htmlFor="log-cd">{lang === 'zh' ? '循环日' : 'Cycle day'}</label>
            <select id="log-cd" className="th-input log-cycleday" value={cycleSel} onChange={(e) => pickCycleDay(e.target.value)}>
              <option value="">{lang === 'zh' ? '自由训练 · 不计入分化' : 'Free training · no split'}</option>
              {cycles.filter((c) => c.days.length > 0).map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.days.map((d) => (
                    <option key={`${c.id}::${d.label}`} value={`${c.id}::${d.label}`}>
                      {cycleDayOptionLabel(d, lang)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
      </header>

      {selCycle && selCycle.days.length > 0 && (
        <div className="log-round-hint">
          <span className="log-round-badge">{selCycle.name} · Round {targetRound ? targetRound.index : newRoundIndex}</span>
          <span className="log-round-state">
            {targetRound
              ? (lang === 'zh' ? `还差 ${roundRemaining.join(' / ') || '—'}` : `remaining: ${roundRemaining.join(' / ') || '—'}`)
              : (lang === 'zh' ? `上一轮已收尾 · 新一轮 R${newRoundIndex} 待开始` : `last round wrapped up · R${newRoundIndex} not started`)}
          </span>
          {roundRemaining[0] && selLabel !== roundRemaining[0] && (
            <button type="button" className="hist-link log-round-pick" onClick={() => pickCycleDay(`${selCycle.id}::${roundRemaining[0]}`)}>
              {lang === 'zh' ? `选 ${roundRemaining[0]} 天` : `pick day ${roundRemaining[0]}`}
            </button>
          )}
        </div>
      )}

      {planExercises.length > 0 && (
        <div className="log-plan">
          <span className="log-group-label">{lang === 'zh' ? '今日计划' : 'Today’s plan'}</span>
          <div className="log-chips">
            {planExercises.map((ex) => (
              <button key={ex.id} type="button" className={`log-chip ${sel?.kind === 'exercise' && sel.ex.id === ex.id ? 'is-selected' : ''}`} onClick={() => selectExercise(ex)}>
                {exerciseName(ex, lang)}
              </button>
            ))}
          </div>
        </div>
      )}

      {showIntimacy && (
        <section className="log-intimacy" aria-label={lang === 'zh' ? '成人亲密健康' : 'adult wellness'}>
          <div className="log-intimacy-copy">
            <span className="log-intimacy-kicker">{lang === 'zh' ? '私密记录' : 'Private log'}</span>
            <strong>{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</strong>
          </div>
          <div className="log-intimacy-controls">
            {/* Chips, not a <select>: the select shared a flex row with the
                full-width note input and collapsed to a bare arrow, so the type
                was unpickable and every record silently defaulted to one value. */}
            <div className="log-intimacy-types" role="radiogroup" aria-label={lang === 'zh' ? '类型' : 'Type'}>
              {INTIMACY_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={intimacyCat === c}
                  className={`log-intimacy-type ${intimacyCat === c ? 'on' : ''}`}
                  onClick={() => setIntimacyCat(c)}
                >
                  {intimacyLabel(c, lang)}
                </button>
              ))}
            </div>
            <div className="log-intimacy-row">
              <div className="log-intimacy-stepper">
                <span className="log-intimacy-steplabel">{lang === 'zh' ? '次数' : 'Count'}</span>
                <button type="button" onClick={() => bumpCount(-1)} aria-label={lang === 'zh' ? '减少' : 'decrease'}>−</button>
                <b>{intimacyCount}</b>
                <button type="button" onClick={() => bumpCount(1)} aria-label={lang === 'zh' ? '增加' : 'increase'}>+</button>
              </div>
              <input className="th-input log-intimacy-note" value={intimacyNote} onChange={(e) => setIntimacyNote(e.target.value)}
                placeholder={lang === 'zh' ? '备注(可选)' : 'note (optional)'} />
              <button className="th-btn log-intimacy-save" type="button" onClick={saveIntimacy} disabled={saving}>
                {lang === 'zh' ? '记录' : 'Log'}
              </button>
            </div>
          </div>
        </section>
      )}

      <ExercisePicker
        lang={lang}
        exercises={exercises}
        sports={sports}
        selectedId={sel ? (sel.kind === 'exercise' ? sel.ex.id : sel.sport.id) : null}
        onSelect={selectExercise}
        onSelectSport={selectSport}
        onAddNew={(name) => setDialog({ open: true, name })}
      />

      {sel?.kind === 'exercise' && (
        <div className="log-entry-backdrop" onClick={closeEntryModal}>
          <section className="log-entry log-entry-modal" onClick={(e) => e.stopPropagation()}>
          <div className="log-entry-head">
            <h3>{exerciseName(sel.ex, lang)}</h3>
            <div className="log-entry-meta">
              <span className="log-superset-hint">
                {sel.ex.is_rehab
                  ? (lang === 'zh' ? '康复动作' : 'rehab exercise')
                  : (lang === 'zh' ? '每组可标 超级组/递减/热身' : 'mark each set: superset/dropset/warmup')}
              </span>
              <button className="log-entry-close" type="button" onClick={closeEntryModal} aria-label={lang === 'zh' ? '关闭' : 'close'}>×</button>
            </div>
          </div>

          {sel.ex.is_rehab && <RehabKnowledge ex={sel.ex} lang={lang} />}

          {/* Where this lift will be filed. It lives INSIDE the modal because on a
              phone the header picker is off-screen while you enter sets — which is
              how a back workout kept landing on the chest day. */}
          {cycles.some((c) => c.days.length > 0) && (
            <div className={`log-field log-entry-cycle ${dayMismatch || opensNewRound ? 'warn' : ''}`}>
              <label className="th-label" htmlFor="log-entry-cd">
                {lang === 'zh' ? '归入分化' : 'Counts toward'}
                {selCycle && selLabel && (
                  <span className="log-entry-round">
                    {targetRound ? `R${targetRound.index}` : lang === 'zh' ? `新一轮 R${newRoundIndex}` : `new R${newRoundIndex}`}
                  </span>
                )}
                {dayAuto && !dayMismatch && (
                  <span className="log-entry-auto">{lang === 'zh' ? '按动作自动选择' : 'auto-picked'}</span>
                )}
              </label>
              <select id="log-entry-cd" className="th-input" value={cycleSel} onChange={(e) => pickCycleDay(e.target.value)}>
                <option value="">{lang === 'zh' ? '自由训练 · 不计入分化' : 'Free training · no split'}</option>
                {cycles.filter((c) => c.days.length > 0).map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.days.map((d) => (
                      <option key={`${c.id}::${d.label}`} value={`${c.id}::${d.label}`}>
                        {cycleDayOptionLabel(d, lang)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {dayMismatch && selDay && (
                <p className="log-warn">
                  {lang === 'zh'
                    ? `「${exerciseName(sel.ex, lang)}」不练 ${selDay.label} · ${cycleDayTitle(selDay, lang)}。`
                    : `“${exerciseName(sel.ex, lang)}” isn’t part of ${selDay.label} · ${cycleDayTitle(selDay, lang)}.`}
                  {suggestedLabel && suggestedLabel !== selLabel && (
                    <button type="button" className="hist-link" onClick={() => pickCycleDay(`${selCycle!.id}::${suggestedLabel}`)}>
                      {lang === 'zh' ? `改为 ${suggestedLabel}` : `use ${suggestedLabel}`}
                    </button>
                  )}
                  <button type="button" className="hist-link" onClick={() => pickCycleDay('')}>
                    {lang === 'zh' ? '不计入分化' : 'no split'}
                  </button>
                </p>
              )}
              {opensNewRound && (
                <p className="log-warn">
                  {lang === 'zh'
                    ? `⚠ 上一轮已练完(或已跳过) — 保存会开启新一轮 R${newRoundIndex}。`
                    : `⚠ The last round is complete (or was skipped) — saving starts round R${newRoundIndex}.`}
                </p>
              )}
            </div>
          )}

          {exSummary && (exSummary.best || exSummary.last) && (
            <div className="log-hist">
              {exSummary.best && (
                <span className="log-hist-item">
                  <b>{lang === 'zh' ? (sel.ex.assisted ? '最佳(助力最少)' : '最好') : 'PR'}</b>{' '}
                  {formatSubSet(exSummary.best, sel.ex.measure_type, lang, sel.ex.duration_hm)}
                  {exSummary.best.perSide ? (lang === 'zh' ? '/侧' : '/side') : ''}
                  <span className="log-hist-date"> · {exSummary.best.date.slice(5)}</span>
                </span>
              )}
              {exSummary.last && (
                <span className="log-hist-item">
                  <b>{lang === 'zh' ? '上次' : 'last'}</b>{' '}
                  <span className="log-hist-date">{exSummary.last.date.slice(5)}</span>{' · '}
                  {exSummary.last.sets.map((s) => formatSetLine(s, sel.ex.measure_type, lang, sel.ex.duration_hm)).join(' · ')}
                </span>
              )}
            </div>
          )}

          <SetEditor lang={lang} measureType={sel.ex.measure_type} durationHm={sel.ex.duration_hm} cardio={sel.ex.body_parts.includes('cardio')} sets={sets} onChange={setSets} />

          <NoteField lang={lang} note={note} setNote={setNote} tagKeys={parsed.tagKeys} />

          {sel.ex.is_rehab ? (
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '关联伤病 (本动作康复的)' : 'For which injury'}</label>
              <div className="log-row">
                {activeInjuries.length > 0 && (
                  <select className="th-input" value={injuryId} onChange={(e) => setInjuryId(e.target.value)}>
                    <option value="">{lang === 'zh' ? '关联伤病…' : 'link injury…'}</option>
                    {activeInjuries.map((i) => (<option key={i.id} value={i.id}>{bodyAreaLabel(i, lang)}</option>))}
                  </select>
                )}
                <button className="th-btn-ghost log-suggest" type="button" onClick={() => setInjuryDialog(true)}>
                  {lang === 'zh' ? '+ 新建伤病' : '+ New injury'}
                </button>
              </div>
            </div>
          ) : (
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '伤病影响' : 'Injury impact'}</label>
              <div className="log-row">
                <select className="th-input" value={injuryMod} onChange={(e) => setInjuryMod(e.target.value as InjuryModified | 'none')}>
                  <option value="none">{lang === 'zh' ? '无' : 'none'}</option>
                  <option value="reduced">{lang === 'zh' ? '减量' : 'reduced'}</option>
                  <option value="paused">{lang === 'zh' ? '暂停' : 'paused'}</option>
                </select>
                {injuryMod !== 'none' && activeInjuries.length > 0 && (
                  <select className="th-input" value={injuryId} onChange={(e) => setInjuryId(e.target.value)}>
                    <option value="">{lang === 'zh' ? '关联伤病…' : 'link injury…'}</option>
                    {activeInjuries.map((i) => (<option key={i.id} value={i.id}>{bodyAreaLabel(i, lang)}</option>))}
                  </select>
                )}
                <button className="th-btn-ghost log-suggest" type="button" onClick={() => setInjuryDialog(true)}>
                  {lang === 'zh' ? '+ 新建伤病' : '+ New injury'}
                </button>
              </div>
            </div>
          )}

          <button className="th-btn" type="button" onClick={saveExercise} disabled={!canSaveExercise}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存' : 'Save exercise'}
          </button>
          </section>
        </div>
      )}

      {sel?.kind === 'sport' && (
        <div className="log-entry-backdrop" onClick={closeEntryModal}>
          <section className="log-entry log-entry-modal" onClick={(e) => e.stopPropagation()}>
          <div className="log-entry-head">
            <h3>{(lang === 'zh' ? sel.sport.name_zh : sel.sport.name_en) || sel.sport.name_zh}</h3>
            <button className="log-entry-close" type="button" onClick={closeEntryModal} aria-label={lang === 'zh' ? '关闭' : 'close'}>×</button>
          </div>
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '时长 (时:分)' : 'Duration (h:mm)'}</label>
            <input className="th-input" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1:30" />
          </div>
          {(sel.sport.fields ?? []).map((f) => (
            <div key={f.key} className="log-field">
              <label className="th-label">{fieldLabel(f, lang)}</label>
              {f.type === 'select' ? (
                <select className="th-input" value={attrs[f.key] ?? ''} onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (<option key={o.value} value={o.value}>{lang === 'zh' ? o.zh : o.en}</option>))}
                </select>
              ) : (
                <input className="th-input" type={f.type === 'number' ? 'number' : 'text'} value={attrs[f.key] ?? ''}
                  onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))} />
              )}
            </div>
          ))}
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '手表数据(可选)' : 'Watch data (optional)'}</label>
            <div className="log-cardio">
              <input className="th-input log-num" inputMode="numeric" value={sportCal}
                onChange={(e) => setSportCal(e.target.value)} placeholder={lang === 'zh' ? '卡路里' : 'kcal'} aria-label="calories" />
              <input className="th-input log-num" inputMode="numeric" value={sportBpm}
                onChange={(e) => setSportBpm(e.target.value)} placeholder={lang === 'zh' ? '心率bpm' : 'bpm'} aria-label="heart rate" />
            </div>
          </div>
          {activeInjuries.length > 0 && (
            <p className="log-hint">{lang === 'zh' ? '⚠ 有活动伤病,本场次自动标记为带伤(可在 Injuries 里管理状态)' : '⚠ Active injury — this session is auto-flagged as injured (manage status in Injuries)'}</p>
          )}
          <div className="log-row">
            <button className="th-btn-ghost log-suggest" type="button" onClick={() => setInjuryDialog(true)}>
              {lang === 'zh' ? '+ 新建伤病' : '+ New injury'}
            </button>
          </div>
          <NoteField lang={lang} note={note} setNote={setNote} tagKeys={parsed.tagKeys} />
          <button className="th-btn" type="button" onClick={saveSport} disabled={!canSaveSport}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存场次' : 'Save session'}
          </button>
          </section>
        </div>
      )}

      {logged.length > 0 && (
        <section className="log-session">
          <div className="log-session-head">
            <span className="th-label">{lang === 'zh' ? '本次已记录' : 'Logged this session'}</span>
            {logged.filter((x) => x.kind === 'exercise' && circuitSel.has(x.id)).length >= 2 && (
              <button className="th-pill accent" type="button" onClick={() => void mergeLoggedCircuit()}>
                ⛓ {lang === 'zh' ? '合并为循环' : 'merge circuit'}
              </button>
            )}
          </div>
          <p className="log-session-hint">{lang === 'zh' ? '点一条可修改(组数/日期/分化) · 勾选交替做的动作 → 合并为循环' : 'tap a row to edit (sets/date/split) · tick alternating moves → merge into a circuit'}</p>
          <ul className="log-session-list">
            {logged.map((item) => (
              <li key={item.id} className={`log-session-item ${item.group ? 'grouped' : ''}`}>
                {item.kind === 'exercise' && (
                  <input type="checkbox" className="log-session-check" checked={circuitSel.has(item.id)} onChange={() => toggleCircuit(item.id)} aria-label="circuit" />
                )}
                <button
                  type="button"
                  className="log-session-open"
                  onClick={() => setEditing(item)}
                  disabled={!canEditLogged(item)}
                  title={canEditLogged(item) ? (lang === 'zh' ? '修改这条' : 'edit this entry') : undefined}
                >
                  <span className="log-session-name">{item.name}</span>
                  <span className="log-session-detail">{item.detail}</span>
                </button>
                {item.group && <span className="log-tagchip sm">⛓ {lang === 'zh' ? '循环' : 'circuit'}</span>}
                {item.tagKeys.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
                <button className="hist-link danger log-session-del" type="button" onClick={() => void deleteLogged(item)}>{lang === 'zh' ? '删除' : 'delete'}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog.open && (
        <AddExerciseDialog lang={lang} initialName={dialog.name} existing={exercises} onCreated={onExerciseCreated}
          onChanged={() => { void getExercises().then(setExercises); setSel(null) }}
          onClose={() => setDialog({ open: false, name: '' })} />
      )}

      {injuryDialog && (
        <AddInjuryDialog lang={lang} onSaved={onInjuryCreated} onClose={() => setInjuryDialog(false)} />
      )}

      {editing?.kind === 'exercise' && editing.entry && (
        <EditEntryDialog
          entry={editing.entry}
          exercise={exercises.find((e) => e.id === editing.entry!.exercise_id)!}
          allExercises={exercises}
          sets={editing.sets ?? []}
          lang={lang}
          onChanged={afterEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === 'sport' && editing.session && (
        <SportSessionDialog
          lang={lang}
          sport={sports.find((s) => s.id === editing.session!.sport_id)}
          session={editing.session}
          onSaved={() => void afterEdit()}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// Read-only knowledge card shown when a rehab exercise is selected in Log.
function RehabKnowledge({ ex, lang }: { ex: Exercise; lang: 'en' | 'zh' }) {
  const purpose = (lang === 'zh' ? ex.rehab_purpose_zh : ex.rehab_purpose_en) || ex.rehab_purpose_zh || ex.rehab_purpose_en
  const cues = (lang === 'zh' ? ex.rehab_cues_zh : ex.rehab_cues_en) || ex.rehab_cues_zh || ex.rehab_cues_en
  if (!purpose && !cues && !ex.rehab_dosage) return null
  return (
    <div className="log-rehab-know">
      {purpose && <p><strong>{lang === 'zh' ? '作用' : 'Purpose'}:</strong> {purpose}</p>}
      {cues && <p><strong>{lang === 'zh' ? '要领/注意' : 'Cues'}:</strong> {cues}</p>}
      {ex.rehab_dosage && <p><strong>{lang === 'zh' ? '剂量' : 'Dosage'}:</strong> {ex.rehab_dosage}</p>}
    </div>
  )
}

function NoteField({ lang, note, setNote, tagKeys }: { lang: 'en' | 'zh'; note: string; setNote: (v: string) => void; tagKeys: string[] }) {
  return (
    <div className="log-field">
      <label className="th-label" htmlFor="log-note">{lang === 'zh' ? '笔记' : 'Note'}</label>
      <input id="log-note" className="th-input" value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={lang === 'zh' ? '例如 每侧 / 热身 / 力竭' : 'e.g. 每侧 / 热身 / 力竭'} />
      {tagKeys.length > 0 && (
        <div className="log-tagchips">
          {tagKeys.map((k) => (<span key={k} className="log-tagchip">{noteTagLabel(k, lang)}</span>))}
        </div>
      )}
    </div>
  )
}
