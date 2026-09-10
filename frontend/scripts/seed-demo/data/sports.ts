// Three sports (Frisbee = default, Running, Gymnastics) + ~28 sessions across the
// 15-week window, so the Sports tab and its per-sport mini-charts are non-empty.
import { rid, TODAY, addDays, ymd, pick, round, rand } from '../util.ts'
import { FRISBEE_FIELDS } from './fields.ts'

export const SPORTS = {
  frisbee: { id: rid(), name_zh: '飞盘', name_en: 'Ultimate Frisbee', is_default: true, fields: FRISBEE_FIELDS },
  running: { id: rid(), name_zh: '跑步', name_en: 'Running', is_default: false, fields: [] as unknown[] },
  gym: { id: rid(), name_zh: '体操', name_en: 'Gymnastics', is_default: false, fields: [] as unknown[] },
}

export function sportRows(): Record<string, unknown>[] {
  return Object.values(SPORTS).map((s) => ({
    id: s.id, name_zh: s.name_zh, name_en: s.name_en,
    is_default: s.is_default, name_locked: false, needs_translation: false, fields: s.fields,
  }))
}

const FRISBEE_LEVELS = ['toss', 'casual', 'club', 'major']

export function sportSessionRows(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const START = addDays(TODAY, -15 * 7)

  // Frisbee ~ once a week (14 sessions), a couple of them competition-level.
  for (let w = 0; w < 15; w++) {
    if (w === 5) continue // one bye week
    const d = addDays(START, w * 7 + 6) // weekend
    const level = w >= 11 ? pick(['club', 'major']) : pick(['casual', 'club'])
    rows.push({
      id: rid(), date: ymd(d), sport_id: SPORTS.frisbee.id,
      hours: round(rand(1.5, 3), 0.5), attributes: { level },
      injury: false, note_raw: level === 'major' ? 'League day — lots of running' : 'Regular pickup session',
      note_tags: [], calories: Math.round(rand(600, 1100)), bpm: Math.round(rand(140, 165)),
    })
  }
  // Running ~ 8 easy/tempo runs.
  for (let i = 0; i < 8; i++) {
    const d = addDays(START, Math.round(rand(3, 100)))
    rows.push({
      id: rid(), date: ymd(d), sport_id: SPORTS.running.id,
      hours: round(rand(0.5, 1.2), 0.25), attributes: {},
      injury: false, note_raw: pick(['Easy run', 'Tempo run 5km', 'Intervals 8×400m']),
      note_tags: [], calories: Math.round(rand(300, 650)), bpm: Math.round(rand(150, 175)),
    })
  }
  // Gymnastics ~ 6 skill sessions.
  for (let i = 0; i < 6; i++) {
    const d = addDays(START, Math.round(rand(10, 103)))
    rows.push({
      id: rid(), date: ymd(d), sport_id: SPORTS.gym.id,
      hours: round(rand(1, 2), 0.5), attributes: {},
      injury: false, note_raw: pick(['Handstand practice', 'Rings basics', 'Front-lever progression']),
      note_tags: [], calories: Math.round(rand(400, 700)), bpm: Math.round(rand(120, 150)),
    })
  }
  return rows
}
