// ~50 bilingual exercises spanning every measure type + flag the app understands:
// weight_reps / reps_only / duration, warmup, rehab, per-side, bodyweight, cardio.
// Each has a stable `key` so the routine engine and cycles can reference it; a fresh
// uuid `id` is minted per run (the whole demo account is wiped + reseeded daily).
import { rid } from '../util.ts'

export interface SeedExercise {
  key: string
  id: string
  name_zh: string
  name_en: string
  measure_type: 'weight_reps' | 'reps_only' | 'duration'
  body_parts: string[]
  assisted?: boolean
  bodyweight?: boolean
  default_per_side?: boolean
  duration_hm?: boolean
  is_warmup?: boolean
  is_rehab?: boolean
  rehab_purpose_zh?: string
  rehab_purpose_en?: string
  rehab_cues_zh?: string
  rehab_cues_en?: string
  rehab_dosage?: string
}

type Def = Omit<SeedExercise, 'id'>

const DEFS: Def[] = [
  // ── warm-ups (own picker group) ──
  { key: 'jumprope', name_zh: '跳绳', name_en: 'Jump rope', measure_type: 'duration', body_parts: ['warmup', 'cardio'], is_warmup: true },
  { key: 'dynamic_stretch', name_zh: '动态拉伸', name_en: 'Dynamic stretching', measure_type: 'duration', body_parts: ['warmup'], is_warmup: true },
  { key: 'band_pullapart', name_zh: '弹力带肩外展', name_en: 'Band pull-apart', measure_type: 'reps_only', body_parts: ['warmup', 'shoulders'], is_warmup: true },

  // ── chest ──
  { key: 'bench', name_zh: '杠铃卧推', name_en: 'Barbell bench press', measure_type: 'weight_reps', body_parts: ['chest'] },
  { key: 'incline_db', name_zh: '上斜哑铃卧推', name_en: 'Incline dumbbell press', measure_type: 'weight_reps', body_parts: ['chest'] },
  { key: 'cable_fly', name_zh: '龙门夹胸', name_en: 'Cable fly', measure_type: 'weight_reps', body_parts: ['chest'] },
  { key: 'pushup', name_zh: '俯卧撑', name_en: 'Push-up', measure_type: 'reps_only', body_parts: ['chest'], bodyweight: true },

  // ── back ──
  { key: 'deadlift', name_zh: '硬拉', name_en: 'Deadlift', measure_type: 'weight_reps', body_parts: ['back', 'legs'] },
  { key: 'pullup', name_zh: '引体向上', name_en: 'Pull-up', measure_type: 'reps_only', body_parts: ['back'], bodyweight: true },
  { key: 'assisted_pullup', name_zh: '辅助引体向上', name_en: 'Assisted pull-up', measure_type: 'weight_reps', body_parts: ['back'], assisted: true },
  { key: 'barbell_row', name_zh: '杠铃划船', name_en: 'Barbell row', measure_type: 'weight_reps', body_parts: ['back'] },
  { key: 'lat_pulldown', name_zh: '高位下拉', name_en: 'Lat pulldown', measure_type: 'weight_reps', body_parts: ['back'] },
  { key: 'seated_row', name_zh: '坐姿划船', name_en: 'Seated cable row', measure_type: 'weight_reps', body_parts: ['back'] },

  // ── shoulders ──
  { key: 'ohp', name_zh: '站姿推举', name_en: 'Overhead press', measure_type: 'weight_reps', body_parts: ['shoulders'] },
  { key: 'db_shoulder', name_zh: '哑铃肩推', name_en: 'Dumbbell shoulder press', measure_type: 'weight_reps', body_parts: ['shoulders'] },
  { key: 'lateral_raise', name_zh: '侧平举', name_en: 'Lateral raise', measure_type: 'weight_reps', body_parts: ['shoulders'] },
  { key: 'face_pull', name_zh: '面拉', name_en: 'Face pull', measure_type: 'weight_reps', body_parts: ['shoulders', 'back'] },

  // ── legs ──
  { key: 'squat', name_zh: '深蹲', name_en: 'Back squat', measure_type: 'weight_reps', body_parts: ['legs'] },
  { key: 'front_squat', name_zh: '前蹲', name_en: 'Front squat', measure_type: 'weight_reps', body_parts: ['legs'] },
  { key: 'leg_press', name_zh: '腿举', name_en: 'Leg press', measure_type: 'weight_reps', body_parts: ['legs'] },
  { key: 'rdl', name_zh: '罗马尼亚硬拉', name_en: 'Romanian deadlift', measure_type: 'weight_reps', body_parts: ['legs', 'back'] },
  { key: 'bulgarian', name_zh: '保加利亚分腿蹲', name_en: 'Bulgarian split squat', measure_type: 'weight_reps', body_parts: ['legs'], default_per_side: true },
  { key: 'leg_curl', name_zh: '腿弯举', name_en: 'Leg curl', measure_type: 'weight_reps', body_parts: ['legs'] },
  { key: 'calf_raise', name_zh: '提踵', name_en: 'Calf raise', measure_type: 'weight_reps', body_parts: ['legs'] },
  { key: 'walking_lunge', name_zh: '行走箭步蹲', name_en: 'Walking lunge', measure_type: 'weight_reps', body_parts: ['legs'], default_per_side: true },

  // ── arms ──
  { key: 'barbell_curl', name_zh: '杠铃弯举', name_en: 'Barbell curl', measure_type: 'weight_reps', body_parts: ['biceps', 'arms'] },
  { key: 'db_curl', name_zh: '哑铃弯举', name_en: 'Dumbbell curl', measure_type: 'weight_reps', body_parts: ['biceps', 'arms'], default_per_side: true },
  { key: 'hammer_curl', name_zh: '锤式弯举', name_en: 'Hammer curl', measure_type: 'weight_reps', body_parts: ['biceps', 'arms'] },
  { key: 'triceps_pushdown', name_zh: '三头下压', name_en: 'Triceps pushdown', measure_type: 'weight_reps', body_parts: ['triceps', 'arms'] },
  { key: 'skullcrusher', name_zh: '仰卧臂屈伸', name_en: 'Skull crusher', measure_type: 'weight_reps', body_parts: ['triceps', 'arms'] },
  { key: 'dips', name_zh: '双杠臂屈伸', name_en: 'Dips', measure_type: 'reps_only', body_parts: ['triceps', 'chest'], bodyweight: true },

  // ── core ──
  { key: 'plank', name_zh: '平板支撑', name_en: 'Plank', measure_type: 'duration', body_parts: ['core'], bodyweight: true },
  { key: 'hanging_leg_raise', name_zh: '悬垂举腿', name_en: 'Hanging leg raise', measure_type: 'reps_only', body_parts: ['core'], bodyweight: true },
  { key: 'cable_crunch', name_zh: '绳索卷腹', name_en: 'Cable crunch', measure_type: 'weight_reps', body_parts: ['core'] },
  { key: 'ab_wheel', name_zh: '腹肌轮', name_en: 'Ab wheel rollout', measure_type: 'reps_only', body_parts: ['core'], bodyweight: true },
  { key: 'pallof', name_zh: 'Pallof 抗旋转', name_en: 'Pallof press', measure_type: 'weight_reps', body_parts: ['core'], default_per_side: true },

  // ── cardio (duration; some hh:mm) ──
  { key: 'treadmill', name_zh: '跑步机', name_en: 'Treadmill run', measure_type: 'duration', body_parts: ['cardio'], duration_hm: true },
  { key: 'rowing', name_zh: '划船机', name_en: 'Rowing machine', measure_type: 'duration', body_parts: ['cardio'] },
  { key: 'stairmaster', name_zh: '爬楼机', name_en: 'Stair climber', measure_type: 'duration', body_parts: ['cardio'] },
  { key: 'assault_bike', name_zh: '风阻单车', name_en: 'Assault bike', measure_type: 'duration', body_parts: ['cardio'] },

  // ── rehab library (knee + shoulder + ankle + low-back stories) ──
  { key: 'terminal_knee_ext', name_zh: '终末伸膝 (TKE)', name_en: 'Terminal knee extension', measure_type: 'reps_only', body_parts: ['legs'], is_rehab: true, default_per_side: true, rehab_purpose_zh: '强化股内侧肌、稳定髌骨', rehab_purpose_en: 'Strengthens VMO, stabilizes the patella', rehab_cues_zh: '弹力带套膝后，缓慢完全伸直，顶峰收缩 2 秒', rehab_cues_en: 'Band behind the knee; extend fully and hold 2s', rehab_dosage: '3×15 / daily' },
  { key: 'spanish_squat', name_zh: '西班牙深蹲', name_en: 'Spanish squat', measure_type: 'duration', body_parts: ['legs'], is_rehab: true, rehab_purpose_zh: '髌腱等长负荷、减痛', rehab_purpose_en: 'Isometric patellar-tendon loading, analgesic', rehab_cues_zh: '弹力带固定膝后，后坐至 60° 保持', rehab_cues_en: 'Band behind knees; sit back to ~60° and hold', rehab_dosage: '5×45s / every other day' },
  { key: 'ankle_alphabet', name_zh: '踝关节字母操', name_en: 'Ankle alphabet', measure_type: 'reps_only', body_parts: ['legs'], is_rehab: true, default_per_side: true, rehab_purpose_zh: '恢复踝关节活动度', rehab_purpose_en: 'Restores ankle range of motion', rehab_cues_zh: '用脚尖在空中书写 A–Z，全程无痛', rehab_cues_en: 'Trace A–Z with the toes, pain-free', rehab_dosage: '2 sets / daily' },
  { key: 'calf_raise_rehab', name_zh: '单腿提踵 (康复)', name_en: 'Single-leg calf raise (rehab)', measure_type: 'reps_only', body_parts: ['legs'], is_rehab: true, default_per_side: true, rehab_purpose_zh: '重建跟腱/小腿负荷耐受', rehab_purpose_en: 'Rebuilds calf/Achilles load tolerance', rehab_cues_zh: '扶墙单腿缓起缓落，3 秒离心', rehab_cues_en: 'Slow 3s eccentric, hold the wall for balance', rehab_dosage: '3×12 / every other day' },
  { key: 'scap_pushup', name_zh: '肩胛俯卧撑', name_en: 'Scapular push-up', measure_type: 'reps_only', body_parts: ['shoulders'], is_rehab: true, bodyweight: true, rehab_purpose_zh: '前锯肌激活、肩胛稳定', rehab_purpose_en: 'Serratus activation, scapular control', rehab_cues_zh: '肘不弯，只做肩胛前伸/后缩', rehab_cues_en: 'Keep elbows straight; protract/retract only', rehab_dosage: '3×12 / daily' },
  { key: 'bird_dog', name_zh: '鸟狗式', name_en: 'Bird-dog', measure_type: 'reps_only', body_parts: ['core'], is_rehab: true, default_per_side: true, rehab_purpose_zh: '腰椎抗旋稳定', rehab_purpose_en: 'Anti-rotation lumbar stability', rehab_cues_zh: '对侧手脚伸展，骨盆不晃', rehab_cues_en: 'Extend opposite arm/leg; keep hips level', rehab_dosage: '3×10 / daily' },
]

export const EXERCISES: SeedExercise[] = DEFS.map((d) => ({ ...d, id: rid() }))
export const exByKey: Record<string, SeedExercise> = Object.fromEntries(EXERCISES.map((e) => [e.key, e]))

/** Turn a SeedExercise into a full DB row (sync fields added by the caller/stamp). */
export function exerciseRows(): Record<string, unknown>[] {
  return EXERCISES.map((e) => ({
    id: e.id,
    name_zh: e.name_zh,
    name_en: e.name_en,
    body_parts: e.body_parts,
    measure_type: e.measure_type,
    assisted: e.assisted ?? false,
    is_custom: true,
    name_locked: false,
    needs_translation: false,
    default_per_side: e.default_per_side ?? false,
    duration_hm: e.duration_hm ?? false,
    bodyweight: e.bodyweight ?? false,
    is_warmup: e.is_warmup ?? false,
    is_rehab: e.is_rehab ?? false,
    rehab_purpose_zh: e.rehab_purpose_zh ?? '',
    rehab_purpose_en: e.rehab_purpose_en ?? '',
    rehab_cues_zh: e.rehab_cues_zh ?? '',
    rehab_cues_en: e.rehab_cues_en ?? '',
    rehab_dosage: e.rehab_dosage ?? '',
  }))
}
