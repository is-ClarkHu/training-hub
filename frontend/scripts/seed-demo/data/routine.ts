// The 15-week training engine. Generates two cycles (an older COMPLETED Push/Pull/
// Legs cycle and the CURRENT in-progress Upper/Lower cycle), their rounds, and the
// workout_entries + sets + entry_cycle_assignments for ~3 sessions/week. Weight rises
// ~1.2%/week so PR detection and previous-session comparisons light up; warm-up sets,
// a superset, a dropset, per-side sets, reps-only and duration/cardio all appear.
import { rid, TODAY, addDays, ymd, atTime, rand, round, pick } from '../util.ts'
import { exByKey, type SeedExercise } from './exercises.ts'

type Row = Record<string, unknown>
export interface Built { cycles: Row[]; rounds: Row[]; entries: Row[]; sets: Row[]; assignments: Row[] }

interface Day { label: string; title_zh: string; title_en: string; body_parts: string[]; keys: string[] }
interface Cycle {
  id: string; name: string; active: boolean; display_mode: 'body' | 'circle'
  weeks: number[]; days: Day[]; supersets: [string, string][]
}

const OLD: Cycle = {
  id: rid(), name: 'Push / Pull / Legs (PPL)', active: false, display_mode: 'circle', weeks: [0, 1, 2, 3, 4, 5, 6],
  supersets: [['triceps_pushdown', 'lateral_raise']],
  days: [
    { label: 'A', title_zh: '推', title_en: 'Push', body_parts: ['chest', 'shoulders', 'triceps'], keys: ['bench', 'incline_db', 'ohp', 'lateral_raise', 'triceps_pushdown', 'dips'] },
    { label: 'B', title_zh: '拉', title_en: 'Pull', body_parts: ['back', 'biceps'], keys: ['deadlift', 'pullup', 'barbell_row', 'lat_pulldown', 'barbell_curl', 'face_pull'] },
    { label: 'C', title_zh: '腿', title_en: 'Legs', body_parts: ['legs', 'core'], keys: ['squat', 'rdl', 'leg_press', 'leg_curl', 'calf_raise', 'plank'] },
  ],
}
const CUR: Cycle = {
  id: rid(), name: 'Upper / Lower split', active: true, display_mode: 'body', weeks: [7, 8, 9, 10, 11, 12, 13, 14],
  supersets: [['hammer_curl', 'skullcrusher']],
  days: [
    { label: 'A', title_zh: '上肢', title_en: 'Upper', body_parts: ['chest', 'back', 'shoulders', 'arms'], keys: ['bench', 'barbell_row', 'db_shoulder', 'lat_pulldown', 'hammer_curl', 'skullcrusher'] },
    { label: 'B', title_zh: '下肢', title_en: 'Lower', body_parts: ['legs', 'core'], keys: ['squat', 'rdl', 'bulgarian', 'leg_curl', 'calf_raise', 'hanging_leg_raise'] },
    { label: 'C', title_zh: '全身 + 有氧', title_en: 'Full + cardio', body_parts: ['back', 'shoulders', 'core', 'cardio'], keys: ['deadlift', 'ohp', 'pullup', 'cable_crunch', 'treadmill'] },
  ],
}

const BASE_W: Record<string, number> = {
  bench: 60, incline_db: 26, cable_fly: 15, ohp: 40, db_shoulder: 22, lateral_raise: 10, face_pull: 25,
  deadlift: 100, assisted_pullup: 30, barbell_row: 60, lat_pulldown: 55, seated_row: 55,
  squat: 85, front_squat: 60, leg_press: 160, rdl: 80, bulgarian: 22, leg_curl: 45, calf_raise: 80, walking_lunge: 20,
  barbell_curl: 30, db_curl: 14, hammer_curl: 16, triceps_pushdown: 30, skullcrusher: 25, cable_crunch: 40, pallof: 25,
}
const BASE_REPS: Record<string, number> = { pullup: 6, pushup: 20, dips: 8, hanging_leg_raise: 10, ab_wheel: 8, band_pullapart: 15 }
const BASE_SEC: Record<string, number> = { plank: 45, treadmill: 1500, rowing: 600, stairmaster: 600, assault_bike: 300, jumprope: 180, dynamic_stretch: 300 }
const COMPOUND = new Set(['bench', 'deadlift', 'squat', 'ohp', 'barbell_row', 'front_squat', 'rdl', 'leg_press'])
const FAILURE_NOTE = () => pick(['last set to failure', 'to failure', 'tough but felt strong', 'slow eccentric'])

function setsFor(ex: SeedExercise, entryId: string, wk: number, group: string | null): Row[] {
  const rows: Row[] = []
  const perSide = ex.default_per_side ?? false
  let idx = 1
  const add = (o: Partial<Row>) => rows.push({ id: rid(), entry_id: entryId, set_index: idx++, set_type: 'normal', weight: null, reps: null, duration_sec: null, per_side: perSide, sub_sets: [], distance: null, calories: null, bpm: null, ...o })

  if (ex.measure_type === 'weight_reps') {
    const base = BASE_W[ex.key] ?? 20
    const mult = ex.assisted ? 1 - 0.01 * wk : 1 + 0.012 * wk
    const top = Math.max(2.5, round(base * mult * rand(0.99, 1.01), 2.5))
    const reps = COMPOUND.has(ex.key) ? Math.round(rand(4, 6)) : Math.round(rand(8, 12))
    if (COMPOUND.has(ex.key)) { add({ set_type: 'warmup', weight: round(top * 0.5, 2.5), reps: 8 }); add({ set_type: 'warmup', weight: round(top * 0.75, 2.5), reps: 5 }) }
    for (let s = 0; s < 3; s++) {
      const last = s === 2
      add({ set_type: group ? 'superset' : 'normal', weight: last ? round(top - 2.5, 2.5) : top, reps: last ? reps : reps + 1, note: last && Math.random() < 0.25 ? FAILURE_NOTE() : undefined })
    }
    // one dropset demo on lateral_raise
    if (ex.key === 'lateral_raise') add({ set_type: 'dropset', weight: top, reps: 10, sub_sets: [{ weight: round(top * 0.7, 2.5), reps: 8, duration_sec: null }, { weight: round(top * 0.5, 2.5), reps: 8, duration_sec: null }] })
  } else if (ex.measure_type === 'reps_only') {
    const base = BASE_REPS[ex.key] ?? 10
    const reps = Math.round(base + 0.4 * wk + rand(-1, 1))
    for (let s = 0; s < 3; s++) add({ reps: Math.max(3, reps - s), weight: null })
  } else { // duration
    const base = BASE_SEC[ex.key] ?? 60
    if (ex.key === 'treadmill') {
      const sec = Math.round(base + 20 * wk)
      add({ duration_sec: sec, distance: round((sec / 300) * rand(0.9, 1.1), 0.1), calories: Math.round(sec / 5), bpm: Math.round(rand(150, 170)) })
    } else if (ex.body_parts.includes('cardio')) {
      const sec = Math.round(base + 15 * wk)
      add({ duration_sec: sec, calories: Math.round(sec / 6), bpm: Math.round(rand(140, 165)) })
    } else {
      for (let s = 0; s < 3; s++) add({ duration_sec: Math.round(base + 3 * wk + rand(-3, 3)) })
    }
  }
  return rows
}

export function buildTraining(): Built {
  const cycles: Row[] = []; const rounds: Row[] = []; const entries: Row[] = []; const sets: Row[] = []; const assignments: Row[] = []
  const dayOffset = [0, 2, 4] // Mon/Wed/Fri within the week
  const weekStart = (w: number) => addDays(TODAY, -(14 - w) * 7 - 4)
  const todayStr = ymd(TODAY)

  for (const cyc of [OLD, CUR]) {
    cycles.push({ id: cyc.id, name: cyc.name, active: cyc.active, display_mode: cyc.display_mode, days: cyc.days.map((d) => ({ label: d.label, title: `${d.title_zh} / ${d.title_en}`, title_zh: d.title_zh, title_en: d.title_en, body_parts: d.body_parts, exercise_ids: d.keys.map((k) => exByKey[k].id) })) })

    cyc.weeks.forEach((w, wi) => {
      const roundId = rid()
      const startOn = ymd(weekStart(w))
      const completed: string[] = []
      let lastDate = startOn
      let anyLogged = false

      cyc.days.forEach((day, di) => {
        const d = addDays(weekStart(w), dayOffset[di])
        const dateStr = ymd(d)
        if (dateStr >= todayStr) return // don't log today/future → current round stays in-progress
        anyLogged = true; completed.push(day.label); lastDate = dateStr

        // optional warm-up exercise at the top of the session
        if (Math.random() < 0.5) {
          const wex = exByKey[pick(['jumprope', 'dynamic_stretch'])]
          const eid = rid()
          entries.push(entry(eid, dateStr, wex.id, cyc.id, roundId, day.label, atTime(d, 18), false, null))
          sets.push(...setsFor(wex, eid, w, null))
        }

        day.keys.forEach((key, ki) => {
          const ex = exByKey[key]
          const pair = cyc.supersets.find((p) => p.includes(key))
          const group = pair ? `${roundId}:${pair[0]}` : null
          const eid = rid()
          entries.push(entry(eid, dateStr, ex.id, cyc.id, roundId, day.label, atTime(d, 18, 5 + ki * 6), !!pair, group))
          sets.push(...setsFor(ex, eid, w, group))
          assignments.push({ id: rid(), entry_id: eid, cycle_id: cyc.id, cycle_round_id: roundId, cycle_day_label: day.label })
        })
      })

      if (!anyLogged) return
      const isCurrentOpen = cyc.active && wi === cyc.weeks.length - 1 && completed.length < cyc.days.length
      rounds.push({
        id: roundId, cycle_id: cyc.id, index: wi + 1, started_on: startOn,
        ended_on: isCurrentOpen ? null : lastDate, completed_labels: completed, skipped: false,
      })
    })
  }
  return { cycles, rounds, entries, sets, assignments }
}

function entry(id: string, date: string, exerciseId: string, cycleId: string, roundId: string, dayLabel: string, iso: string, isSuperset: boolean, group: string | null): Row {
  return {
    id, date, exercise_id: exerciseId, is_superset: isSuperset, superset_group: group,
    note_raw: '', note_tags: [], cycle_day_label: dayLabel, cycle_id: cycleId, cycle_round_id: roundId,
    module_part: null, sort_order: Date.parse(iso), injury_modified: null, injury_id: null,
    needs_review: false, needs_translation: false,
  }
}
