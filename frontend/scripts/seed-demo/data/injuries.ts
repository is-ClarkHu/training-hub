// Four complete injury stories at different lifecycle stages, each with a bilingual
// note, stage-transition checkpoints, a declining pain-assessment series, and an
// assigned rehab-exercise plan. Two active injuries also get a handful of logged
// rehab-training entries so they surface in History too.
import { rid, TODAY, addDays, ymd, atTime, rand } from '../util.ts'
import { exByKey, type SeedExercise } from './exercises.ts'

type Row = Record<string, unknown>
export interface BuiltInjuries { injuries: Row[]; entries: Row[]; sets: Row[] }

const ago = (d: number) => ymd(addDays(TODAY, -d))

interface Story {
  zh: string; en: string; part: string; laterality: string | null; type: string; scenario: string
  severity: number; startedDaysAgo: number; status: string; resolvedDaysAgo: number | null
  noteZh: string; noteEn: string
  checkpoints: { status: string; daysAgo: number; note?: string }[]
  pains: { daysAgo: number; pain: number; note?: string }[]
  rehabKeys: string[]
  logRehab?: boolean // also emit rehab-training entries over the last ~3 weeks
}

const STORIES: Story[] = [
  {
    zh: '右膝 髌腱', en: 'Right knee (patellar tendon)', part: 'legs', laterality: 'right', type: 'overuse', scenario: 'running',
    severity: 3, startedDaysAgo: 98, status: 'recovered', resolvedDaysAgo: 28,
    noteZh: '跑量骤增后髌腱下缘疼痛,上下楼加重。等长负荷 + 逐步复训后痊愈。',
    noteEn: 'Patellar-tendon pain below the kneecap after a running-volume spike; worse on stairs. Resolved with isometric loading + graded return.',
    checkpoints: [
      { status: 'newly_occurred', daysAgo: 98 }, { status: 'observing', daysAgo: 92 },
      { status: 'treating', daysAgo: 84, note: '开始西班牙深蹲等长' }, { status: 'rehab_training', daysAgo: 63 },
      { status: 'returning', daysAgo: 42 }, { status: 'recovered', daysAgo: 28, note: '无痛完成深蹲' },
    ],
    pains: [{ daysAgo: 98, pain: 7 }, { daysAgo: 84, pain: 6, note: '上楼仍痛' }, { daysAgo: 63, pain: 4 }, { daysAgo: 42, pain: 2 }, { daysAgo: 28, pain: 1 }],
    rehabKeys: ['spanish_squat', 'terminal_knee_ext'],
  },
  {
    zh: '左踝 外侧扭伤', en: 'Left ankle (lateral sprain)', part: 'legs', laterality: 'left', type: 'sprain', scenario: 'competition',
    severity: 3, startedDaysAgo: 35, status: 'returning', resolvedDaysAgo: null,
    noteZh: '飞盘联赛落地踩到对方脚,外侧韧带 I–II 度扭伤。消肿后开始本体感觉训练。',
    noteEn: 'Rolled the ankle landing on an opponent at a frisbee league game — grade I–II lateral ligament sprain. Proprioception work after swelling settled.',
    checkpoints: [
      { status: 'newly_occurred', daysAgo: 35, note: 'RICE, 冰敷' }, { status: 'observing', daysAgo: 32 },
      { status: 'treating', daysAgo: 28 }, { status: 'rehab_training', daysAgo: 18, note: '字母操 + 提踵' },
      { status: 'returning', daysAgo: 7 },
    ],
    pains: [{ daysAgo: 35, pain: 6 }, { daysAgo: 28, pain: 5 }, { daysAgo: 18, pain: 3 }, { daysAgo: 7, pain: 2, note: '慢跑无痛' }],
    rehabKeys: ['ankle_alphabet', 'calf_raise_rehab'],
    logRehab: true,
  },
  {
    zh: '右肩 撞击', en: 'Right shoulder (impingement)', part: 'shoulders', laterality: 'right', type: 'overuse', scenario: 'strength',
    severity: 2, startedDaysAgo: 49, status: 'rehab_training', resolvedDaysAgo: null,
    noteZh: '卧推与过顶推举后肩前侧夹挤感,过顶弧度疼痛。减量并加入肩胛稳定训练。',
    noteEn: 'Anterior pinching after bench/overhead pressing, painful through the overhead arc. Deloaded pressing and added scapular-stability work.',
    checkpoints: [
      { status: 'newly_occurred', daysAgo: 49 }, { status: 'observing', daysAgo: 44 },
      { status: 'treating', daysAgo: 35 }, { status: 'rehab_training', daysAgo: 21, note: '肩胛俯卧撑 + 弹力带' },
    ],
    pains: [{ daysAgo: 49, pain: 5 }, { daysAgo: 35, pain: 4 }, { daysAgo: 21, pain: 3 }, { daysAgo: 5, pain: 2 }],
    rehabKeys: ['scap_pushup', 'band_pullapart'],
    logRehab: true,
  },
  {
    zh: '下背 拉伤', en: 'Lower back (strain)', part: 'core', laterality: null, type: 'strain', scenario: 'daily',
    severity: 2, startedDaysAgo: 77, status: 'recovered', resolvedDaysAgo: 49,
    noteZh: '搬重物姿势不良导致腰部拉伤。核心抗旋转训练后恢复,硬拉回归。',
    noteEn: 'Tweaked the lower back lifting a box with poor form. Recovered with anti-rotation core work; returned to deadlifts.',
    checkpoints: [
      { status: 'newly_occurred', daysAgo: 77 }, { status: 'treating', daysAgo: 70 },
      { status: 'rehab_training', daysAgo: 60, note: '鸟狗式' }, { status: 'recovered', daysAgo: 49 },
    ],
    pains: [{ daysAgo: 77, pain: 5 }, { daysAgo: 63, pain: 3 }, { daysAgo: 49, pain: 1 }],
    rehabKeys: ['bird_dog'],
  },
]

function rehabSets(ex: SeedExercise, entryId: string): Row[] {
  const perSide = ex.default_per_side ?? false
  const base = { id: '', entry_id: entryId, set_type: 'normal', weight: null, reps: null, duration_sec: null, per_side: perSide, sub_sets: [] as unknown[], distance: null, calories: null, bpm: null }
  if (ex.measure_type === 'duration') return [1, 2, 3].map((i) => ({ ...base, id: rid(), set_index: i, duration_sec: Math.round(rand(30, 50)) }))
  return [1, 2, 3].map((i) => ({ ...base, id: rid(), set_index: i, reps: Math.round(rand(10, 15)) }))
}

export function buildInjuries(): BuiltInjuries {
  const injuries: Row[] = []; const entries: Row[] = []; const sets: Row[] = []
  for (const s of STORIES) {
    const injuryId = rid()
    injuries.push({
      id: injuryId, body_area: s.en, body_area_zh: s.zh, body_area_en: s.en, body_part: s.part,
      laterality: s.laterality, injury_type: s.type, scenario: s.scenario,
      started_on: ago(s.startedDaysAgo), status: s.status, resolved_on: s.resolvedDaysAgo == null ? null : ago(s.resolvedDaysAgo),
      severity: s.severity, note_raw: s.noteZh, note_zh: s.noteZh, note_en: s.noteEn,
      checkpoints: s.checkpoints.map((c) => ({ status: c.status, date: ago(c.daysAgo), note: c.note })),
      attachments: [], rehab_plan_exercise_ids: s.rehabKeys.map((k) => exByKey[k].id),
      assessments: s.pains.map((p) => ({ date: ago(p.daysAgo), pain: p.pain, note: p.note })),
    })
    if (s.logRehab) {
      for (let wk = 3; wk >= 1; wk--) {
        const d = addDays(TODAY, -wk * 7 + 1)
        s.rehabKeys.forEach((k, ki) => {
          const ex = exByKey[k]; if (!ex.is_rehab) return
          const eid = rid()
          entries.push({
            id: eid, date: ymd(d), exercise_id: ex.id, is_superset: false, superset_group: null,
            note_raw: '康复训练', note_tags: ['injury'], cycle_day_label: null, cycle_id: null, cycle_round_id: null,
            module_part: null, sort_order: Date.parse(atTime(d, 8, ki * 5)), injury_modified: 'reduced', injury_id: injuryId,
            needs_review: false, needs_translation: false,
          })
          sets.push(...rehabSets(ex, eid))
        })
      }
    }
  }
  return { injuries, entries, sets }
}
