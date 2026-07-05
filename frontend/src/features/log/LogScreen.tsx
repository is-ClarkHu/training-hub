// Log tab (SPEC §7.1, redesigned): one place to log everything. Pick an activity
// — a strength exercise (→ per-set inputs) or a sport (→ tier + hours). Date is
// shared; when an active training cycle is set you can tag the cycle day and the
// day's planned exercises appear as a quick-pick. Local-first writes.
import { useEffect, useState } from 'react'
import {
  createEntryWithSets,
  createSportSession,
  getActiveCycle,
  getExercises,
  getInjuries,
  getSports,
  logTracker,
  softDeleteEntry,
  softDeleteSportSession,
  deleteTrackerEntry,
  today,
  type NewSetInput,
} from '../../db'
import { parseNote, noteTagLabel } from '../../translation'
import { useLanguage } from '../../i18n'
import { fieldLabel } from '../sports'
import { INTIMACY_CATEGORIES, intimacyLabel, intimacyVisible } from '../intimacy'
import type {
  Exercise,
  IntimacyCategory,
  Injury,
  InjuryModified,
  Sport,
  TrainingCycle,
} from '../../supabase/types'
import { ExercisePicker } from './ExercisePicker'
import { SetEditor } from './SetEditor'
import { AddExerciseDialog } from './AddExerciseDialog'
import { draftsToSetInputs, emptySet, exerciseName, parseHours, formatHours, type SetDraft } from './util'
import './log.css'

type Selection =
  | { kind: 'exercise'; ex: Exercise }
  | { kind: 'sport'; sport: Sport }
  | null

interface LoggedItem { id: string; name: string; detail: string; tagKeys: string[]; kind: 'exercise' | 'sport' | 'intimacy'; realId: string }

export function LogScreen() {
  const { lang } = useLanguage()
  const [date, setDate] = useState(today())
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [activeInjuries, setActiveInjuries] = useState<Injury[]>([])
  const [activeCycle, setActiveCycle] = useState<TrainingCycle | null>(null)
  const [cycleDay, setCycleDay] = useState('')

  const [sel, setSel] = useState<Selection>(null)
  const [dialog, setDialog] = useState<{ open: boolean; name: string }>({ open: false, name: '' })
  const [logged, setLogged] = useState<LoggedItem[]>([])
  const [saving, setSaving] = useState(false)

  // exercise form
  const [sets, setSets] = useState<SetDraft[]>([emptySet()])
  const [injuryMod, setInjuryMod] = useState<InjuryModified | 'none'>('none')
  const [injuryId, setInjuryId] = useState('')
  // sport form
  const [hours, setHours] = useState('')
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [showIntimacy, setShowIntimacy] = useState(false)
  const [intimacyCat, setIntimacyCat] = useState<IntimacyCategory>('partner_active')
  const [intimacyCount, setIntimacyCount] = useState('1')
  // shared
  const [note, setNote] = useState('')

  useEffect(() => {
    void getExercises().then(setExercises)
    void getSports().then(setSports)
    void getInjuries().then((l) => setActiveInjuries(l.filter((i) => i.status !== 'recovered')))
    void getActiveCycle().then(setActiveCycle)
    setShowIntimacy(intimacyVisible())
  }, [])

  const parsed = parseNote(note)

  function resetForms() {
    setSets([emptySet()])
    setInjuryMod('none')
    setInjuryId('')
    setHours('')
    setAttrs({})
    setNote('')
  }
  function selectExercise(ex: Exercise) {
    setSel({ kind: 'exercise', ex })
    resetForms()
    if (ex.default_per_side) setSets([{ ...emptySet(), per_side: true }]) // learned default (§ per-side)
  }
  function selectSport(sport: Sport) {
    setSel({ kind: 'sport', sport })
    resetForms()
  }
  function onExerciseCreated(ex: Exercise) {
    setExercises((prev) => [...prev, ex])
    setDialog({ open: false, name: '' })
    selectExercise(ex)
  }

  // day's planned exercises (§6B) as a quick-pick
  const planExercises: Exercise[] = (() => {
    const day = activeCycle?.days.find((d) => d.label === cycleDay)
    if (!day?.exercise_ids?.length) return []
    return day.exercise_ids.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e)
  })()

  function buildSets(): NewSetInput[] {
    if (sel?.kind !== 'exercise') return []
    return draftsToSetInputs(sets, sel.ex.measure_type, parsed)
  }

  const canSaveExercise = sel?.kind === 'exercise' && buildSets().length > 0 && !saving
  const canSaveSport = sel?.kind === 'sport' && (parseHours(hours) ?? 0) > 0 && !saving

  async function saveExercise() {
    if (sel?.kind !== 'exercise') return
    const setInputs = buildSets()
    if (setInputs.length === 0) return
    setSaving(true)
    const { entry } = await createEntryWithSets(
      {
        date,
        exercise_id: sel.ex.id,
        is_superset: setInputs.some((s) => s.set_type === 'superset'),
        note_raw: note,
        note_tags: parsed.tagKeys,
        cycle_day_label: cycleDay || null,
        injury_modified: injuryMod === 'none' ? null : injuryMod,
        injury_id: injuryMod === 'none' ? null : injuryId || null,
      },
      setInputs,
    )
    const detail = setInputs
      .map((s) =>
        sel.ex.measure_type === 'duration'
          ? `${s.duration_sec}s`
          : sel.ex.measure_type === 'reps_only'
            ? `${s.reps}${s.per_side ? '/side' : ''}`
            : `${s.weight ?? '–'}×${s.reps ?? '–'}`,
      )
      .join(', ')
    finishSave(exerciseName(sel.ex, lang), detail, 'exercise', entry.id)
  }

  async function saveSport() {
    if (sel?.kind !== 'sport') return
    const h = parseHours(hours)
    if (!h || h <= 0) return
    setSaving(true)
    const injured = activeInjuries.length > 0 // auto: derived from active injuries (§6A)
    const session = await createSportSession({
      date,
      sport_id: sel.sport.id,
      hours: h,
      attributes: attrs,
      injury: injured,
      note_raw: note,
      note_tags: parsed.tagKeys,
    })
    const attrSummary = (sel.sport.fields ?? [])
      .map((f) => attrs[f.key])
      .filter(Boolean)
      .join(' · ')
    finishSave(
      (lang === 'zh' ? sel.sport.name_zh : sel.sport.name_en) || sel.sport.name_zh,
      `${formatHours(h)}${attrSummary ? ' · ' + attrSummary : ''}${injured ? ' · injury' : ''}`,
      'sport',
      session.id,
    )
  }

  async function saveIntimacy() {
    const n = parseInt(intimacyCount, 10)
    if (!Number.isFinite(n) || n <= 0 || saving) return
    setSaving(true)
    const row = await logTracker('intimacy', date, n, intimacyCat)
    setLogged((prev) => [{
      id: crypto.randomUUID(),
      name: lang === 'zh' ? '成人亲密健康' : 'Adult wellness',
      detail: `${intimacyLabel(intimacyCat, lang, true)} ×${n}`,
      tagKeys: [],
      kind: 'intimacy',
      realId: row.id,
    }, ...prev])
    setIntimacyCount('1')
    setSaving(false)
  }

  function finishSave(name: string, detail: string, kind: 'exercise' | 'sport' | 'intimacy', realId: string) {
    setLogged((prev) => [{ id: crypto.randomUUID(), name, detail, tagKeys: parsed.tagKeys, kind, realId }, ...prev])
    setSel(null)
    resetForms()
    setSaving(false)
  }

  async function deleteLogged(item: LoggedItem) {
    if (item.kind === 'exercise') await softDeleteEntry(item.realId)
    else if (item.kind === 'sport') await softDeleteSportSession(item.realId)
    else await deleteTrackerEntry(item.realId)
    setLogged((prev) => prev.filter((x) => x.id !== item.id))
  }

  return (
    <div className="log-screen">
      <header className="log-head">
        <div className="log-field">
          <label className="th-label" htmlFor="log-date">{lang === 'zh' ? '日期' : 'Date'}</label>
          <input id="log-date" className="th-input log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {activeCycle && activeCycle.days.length > 0 && (
          <div className="log-field">
            <label className="th-label" htmlFor="log-cd">{lang === 'zh' ? '循环日' : 'Cycle day'}</label>
            <select id="log-cd" className="th-input log-cycleday" value={cycleDay} onChange={(e) => setCycleDay(e.target.value)}>
              <option value="">—</option>
              {activeCycle.days.map((d) => (
                <option key={d.label} value={d.label}>{d.label}{d.title ? ` · ${d.title}` : ''}</option>
              ))}
            </select>
          </div>
        )}
      </header>

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
            <select className="th-input" value={intimacyCat} onChange={(e) => setIntimacyCat(e.target.value as IntimacyCategory)}>
              {INTIMACY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{intimacyLabel(c, lang)}</option>
              ))}
            </select>
            <input className="th-input log-intimacy-count" inputMode="numeric" value={intimacyCount} onChange={(e) => setIntimacyCount(e.target.value)} aria-label="count" />
            <button className="th-btn log-intimacy-save" type="button" onClick={saveIntimacy} disabled={saving}>
              {lang === 'zh' ? '记录' : 'Log'}
            </button>
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
        <section className="log-entry">
          <div className="log-entry-head">
            <h3>{exerciseName(sel.ex, lang)}</h3>
            <span className="log-superset-hint">{lang === 'zh' ? '每组可标 超级组/递减/热身' : 'mark each set: superset/dropset/warmup'}</span>
          </div>

          <SetEditor lang={lang} measureType={sel.ex.measure_type} sets={sets} onChange={setSets} />

          <NoteField lang={lang} note={note} setNote={setNote} tagKeys={parsed.tagKeys} />

          {activeInjuries.length > 0 && (
            <div className="log-field">
              <label className="th-label">{lang === 'zh' ? '伤病影响' : 'Injury impact'}</label>
              <div className="log-row">
                <select className="th-input" value={injuryMod} onChange={(e) => setInjuryMod(e.target.value as InjuryModified | 'none')}>
                  <option value="none">{lang === 'zh' ? '无' : 'none'}</option>
                  <option value="reduced">{lang === 'zh' ? '减量' : 'reduced'}</option>
                  <option value="paused">{lang === 'zh' ? '暂停' : 'paused'}</option>
                </select>
                {injuryMod !== 'none' && (
                  <select className="th-input" value={injuryId} onChange={(e) => setInjuryId(e.target.value)}>
                    <option value="">{lang === 'zh' ? '关联伤病…' : 'link injury…'}</option>
                    {activeInjuries.map((i) => (<option key={i.id} value={i.id}>{i.body_area}</option>))}
                  </select>
                )}
              </div>
            </div>
          )}

          <button className="th-btn" type="button" onClick={saveExercise} disabled={!canSaveExercise}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存' : 'Save exercise'}
          </button>
        </section>
      )}

      {sel?.kind === 'sport' && (
        <section className="log-entry">
          <div className="log-entry-head">
            <h3>{(lang === 'zh' ? sel.sport.name_zh : sel.sport.name_en) || sel.sport.name_zh}</h3>
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
          {activeInjuries.length > 0 && (
            <p className="log-hint">{lang === 'zh' ? '⚠ 有活动伤病,本场次自动标记为带伤(可在 Injuries 里管理状态)' : '⚠ Active injury — this session is auto-flagged as injured (manage status in Injuries)'}</p>
          )}
          <NoteField lang={lang} note={note} setNote={setNote} tagKeys={parsed.tagKeys} />
          <button className="th-btn" type="button" onClick={saveSport} disabled={!canSaveSport}>
            {saving ? 'Saving…' : lang === 'zh' ? '保存场次' : 'Save session'}
          </button>
        </section>
      )}

      {logged.length > 0 && (
        <section className="log-session">
          <span className="th-label">{lang === 'zh' ? '本次已记录' : 'Logged this session'}</span>
          <ul className="log-session-list">
            {logged.map((item) => (
              <li key={item.id} className="log-session-item">
                <span className="log-session-name">{item.name}</span>
                <span className="log-session-detail">{item.detail}</span>
                {item.tagKeys.map((k) => (<span key={k} className="log-tagchip sm">{noteTagLabel(k, lang)}</span>))}
                <button className="hist-link danger log-session-del" type="button" onClick={() => void deleteLogged(item)}>{lang === 'zh' ? '删除' : 'delete'}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog.open && (
        <AddExerciseDialog lang={lang} initialName={dialog.name} existing={exercises} onCreated={onExerciseCreated} onClose={() => setDialog({ open: false, name: '' })} />
      )}
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
