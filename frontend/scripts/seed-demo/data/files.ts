// Three fictional reference files (uploaded to the public-files bucket) with both the
// extracted `content` and an LLM-style `summary`. They're granted to specific AI
// chatrooms (see chatrooms.ts) to demo per-room file access.
import { rid, UID_TOKEN, type Asset } from '../util.ts'

type Row = Record<string, unknown>
export interface BuiltFiles { public_files: Row[]; assets: Asset[]; ids: Record<string, string> }

interface Doc { key: string; name: string; content: string; summary: string }
const DOCS: Doc[] = [
  {
    key: 'plan',
    name: 'training-plan-upper-lower.txt',
    content: [
      'Upper / Lower split (8 weeks)', '',
      'A Upper: bench 4×5, barbell row 4×6, DB shoulder press 3×8, lat pulldown 3×10, hammer curl 3×12, skullcrusher 3×12',
      'B Lower: back squat 4×5, Romanian deadlift 3×6, Bulgarian split squat 3×10/side, leg curl 3×12, calf raise 4×15, hanging leg raise 3×12',
      'C Full body + cardio: deadlift 3×5, overhead press 3×6, pull-ups 4×AMRAP, cable crunch 3×15, treadmill 25min',
      '', 'Progression: +2.5kg per week on the main lifts; drop one rep when a set goes to failure. Deload every 4th week.',
      'Cautions: warm the right shoulder up before overhead work; swap in Spanish squats when the knee is cranky.',
    ].join('\n'),
    summary: '8-week upper/lower split (A upper, B lower, C full body + cardio). Linear +2.5kg/week on the main lifts, deload every 4th week. Includes shoulder and knee injury cautions.',
  },
  {
    key: 'coach',
    name: 'coach-feedback-2026Q2.txt',
    content: [
      'Quarterly coach feedback (2026 Q2)', '',
      'Strengths: squat depth and tempo clearly improved; back stays neutral on deadlifts.',
      'To fix: bench descent is too fast — aim for a 2s eccentric; not enough scapular retraction.',
      'Goals: 100kg bench by year end; add unilateral lower-body work to even out the left/right gap.',
      'Nutrition: another 50g of carbs on training days; keep protein at 1.8g/kg.',
    ].join('\n'),
    summary: 'Coach feedback: squat and deadlift technique improving; bench needs a slower eccentric and more scapular retraction. Target 100kg bench, add unilateral leg work. More carbs on training days, protein at 1.8g/kg.',
  },
  {
    key: 'labs',
    name: 'annual-physical-summary.txt',
    content: [
      'Annual physical — summary', '',
      'Height 178cm, weight 76kg, BMI 24.0, resting HR 56',
      'Blood pressure 118/74, lipids normal, fasting glucose 5.1 mmol/L',
      'Vitamin D slightly low (supplementing); everything else in range.',
      'Advice: keep up the cardio, continue vitamin D, watch for spring allergies.',
    ].join('\n'),
    summary: 'Physical came back normal: BP 118/74, lipids and glucose in range, resting HR 56; vitamin D slightly low (now supplemented). Advice: keep the cardio, mind seasonal allergies.',
  },
]

export function buildFiles(): BuiltFiles {
  const public_files: Row[] = []; const assets: Asset[] = []; const ids: Record<string, string> = {}
  for (const doc of DOCS) {
    const id = rid(); ids[doc.key] = id
    const storage_path = `${UID_TOKEN}/${id}.txt`
    assets.push({ bucket: 'public-files', path: storage_path, body: doc.content, contentType: 'text/plain; charset=utf-8' })
    public_files.push({ id, name: doc.name, storage_path, content: doc.content, summary: doc.summary })
  }
  return { public_files, assets, ids }
}
