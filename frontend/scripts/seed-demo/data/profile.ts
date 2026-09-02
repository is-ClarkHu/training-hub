// Profile + pre-fillable AI data modules: basics, a ~14-week body-measurement trend
// (weight/body-fat/muscle/waist, so the Data-panel chart is non-empty), notes,
// supplements, training environment, and a medical background. Single-row modules
// (basics / training_env / medical_background) are one row each per the unique index.
import { rid, TODAY, addDays, ymd, round } from '../util.ts'

type Row = Record<string, unknown>
export interface BuiltProfile {
  profile: Row[]; basics: Row[]; body_measurements: Row[]; notes: Row[]
  supplements: Row[]; training_env: Row[]; medical_background: Row[]
}

function measurements(): Row[] {
  const rows: Row[] = []
  for (let w = 13; w >= 0; w--) {
    const d = addDays(TODAY, -w * 7)
    const p = (13 - w) / 13 // 0→1 over the window
    rows.push({
      id: rid(), date: ymd(d),
      weight_kg: round(78 - 3 * p + (Math.random() - 0.5) * 0.6, 0.1),
      body_fat_pct: round(20 - 4 * p + (Math.random() - 0.5) * 0.4, 0.1),
      muscle_kg: round(34 + 1.5 * p + (Math.random() - 0.5) * 0.3, 0.1),
      waist_cm: round(84 - 4 * p + (Math.random() - 0.5) * 0.4, 0.1),
    })
  }
  return rows
}

export function buildProfile(): BuiltProfile {
  return {
    profile: [{ id: rid(), bodyweight_kg: 75, goal: '增肌减脂 / recomp:力量进步同时降体脂', injuries: [], split: null, notes: '每周 3 练 + 飞盘/跑步' }],
    basics: [{
      id: rid(), age: 29, sex: 'male', biological_sex: 'male', height_cm: 178, training_years: 6,
      training_level: 'intermediate', work_type: 'sedentary', sleep_hours: 7, resting_hr: 56, max_hr: 190,
    }],
    body_measurements: measurements(),
    notes: [
      { id: rid(), content: '目标:年底卧推 100kg、深蹲 140kg。', tag: 'goal' },
      { id: rid(), content: '训练前 2h 一顿正餐,训练后 30 分钟内补蛋白。', tag: 'habit' },
      { id: rid(), content: '右肩过顶动作先热身,避免撞击复发。', tag: 'injury' },
      { id: rid(), content: '家里有可调哑铃 2–32kg 和一根引体杆。', tag: 'equipment' },
      { id: rid(), content: '深蹲时注意膝盖外展,别内扣。', tag: 'training' },
    ],
    supplements: [
      { id: rid(), name: '肌酸 Creatine', brand: 'Optimum Nutrition', dose: '5 g', timing: '每日固定', frequency: 'daily', still_using: true },
      { id: rid(), name: '乳清蛋白 Whey', brand: 'MyProtein', dose: '30 g', timing: '训练后', frequency: 'training-days', still_using: true },
      { id: rid(), name: '维生素 D3', brand: 'NOW', dose: '2000 IU', timing: '早餐', frequency: 'daily', still_using: true },
      { id: rid(), name: '鱼油 Fish oil', brand: 'Nordic Naturals', dose: '2 粒', timing: '晚餐', frequency: 'daily', still_using: true },
      { id: rid(), name: '咖啡因 Caffeine', brand: '—', dose: '200 mg', timing: '训练前', frequency: 'training-days', still_using: true },
      { id: rid(), name: 'ZMA', brand: '—', dose: '3 粒', timing: '睡前', frequency: 'as-needed', still_using: false },
    ],
    training_env: [{
      id: rid(), gym: 'Anytime Fitness(公司楼下)', equipment: '杠铃/深蹲架/卧推凳/龙门架/哑铃到 40kg/腿举/坐姿划船',
      home_equipment: '可调哑铃 2–32kg、引体杆、弹力带、腹肌轮',
    }],
    medical_background: [{
      id: rid(), conditions: '无重大慢性病;季节性过敏性鼻炎(春季)。',
      surgeries: '无。', restrictions: '右肩:过顶推举先充分热身,疼痛弧内减量。',
      allergies: '花粉;无药物过敏。', family_history: '父亲高血压。',
      recent_labs: '半年前体检:血脂/血糖正常,静息心率 56。',
    }],
  }
}
