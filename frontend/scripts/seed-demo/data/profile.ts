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
    profile: [{ id: rid(), bodyweight_kg: 75, goal: 'Recomp — keep adding strength while dropping body fat', injuries: [], split: null, notes: '3 lifting days/week + frisbee and running' }],
    basics: [{
      id: rid(), age: 29, sex: 'male', biological_sex: 'male', height_cm: 178, training_years: 6,
      training_level: 'intermediate', work_type: 'sedentary', sleep_hours: 7, resting_hr: 56, max_hr: 190,
    }],
    body_measurements: measurements(),
    notes: [
      { id: rid(), content: 'Goal: 100kg bench and 140kg squat by the end of the year.', tag: 'goal' },
      { id: rid(), content: 'Full meal ~2h before training; protein within 30 min after.', tag: 'habit' },
      { id: rid(), content: 'Warm the right shoulder up before any overhead work — keeps the impingement from flaring.', tag: 'injury' },
      { id: rid(), content: 'At home: adjustable dumbbells 2–32kg and a pull-up bar.', tag: 'equipment' },
      { id: rid(), content: 'Squat cue: track the knees out, never let them cave in.', tag: 'training' },
    ],
    supplements: [
      { id: rid(), name: 'Creatine monohydrate', brand: 'Optimum Nutrition', dose: '5 g', timing: 'Same time daily', frequency: 'daily', still_using: true },
      { id: rid(), name: 'Whey protein', brand: 'MyProtein', dose: '30 g', timing: 'Post-workout', frequency: 'training-days', still_using: true },
      { id: rid(), name: 'Vitamin D3', brand: 'NOW', dose: '2000 IU', timing: 'With breakfast', frequency: 'daily', still_using: true },
      { id: rid(), name: 'Fish oil', brand: 'Nordic Naturals', dose: '2 capsules', timing: 'With dinner', frequency: 'daily', still_using: true },
      { id: rid(), name: 'Caffeine', brand: '—', dose: '200 mg', timing: 'Pre-workout', frequency: 'training-days', still_using: true },
      { id: rid(), name: 'ZMA', brand: '—', dose: '3 capsules', timing: 'Before bed', frequency: 'as-needed', still_using: false },
    ],
    training_env: [{
      id: rid(), gym: 'Anytime Fitness (downstairs from the office)', equipment: 'Barbells, squat rack, bench, cable crossover, dumbbells to 40kg, leg press, seated row',
      home_equipment: 'Adjustable dumbbells 2–32kg, pull-up bar, resistance bands, ab wheel',
    }],
    medical_background: [{
      id: rid(), conditions: 'No major chronic conditions; seasonal allergic rhinitis in spring.',
      surgeries: 'None.', restrictions: 'Right shoulder: warm up thoroughly before overhead pressing, reduce load inside the painful arc.',
      allergies: 'Pollen; no known drug allergies.', family_history: 'Father has hypertension.',
      recent_labs: 'Physical six months ago: lipids and glucose normal, resting HR 56.',
    }],
  }
}
