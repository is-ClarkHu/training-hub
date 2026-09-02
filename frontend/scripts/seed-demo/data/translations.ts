// Translation dictionary: the bilingual DATA cache. Mixes AI-generated entries
// (source 'ai', unverified) with manual user overrides (source 'user', verified) —
// including one term where the user corrected the AI's translation — plus a few seed
// terms. Demonstrates the AI-translate + manual-override subsystem.
import { rid } from '../util.ts'

type Row = Record<string, unknown>

interface Entry { domain: string; zh: string; en: string; source: string; verified: boolean }
const ENTRIES: Entry[] = [
  { domain: 'exercise', zh: '杠铃卧推', en: 'Barbell bench press', source: 'ai', verified: false },
  { domain: 'exercise', zh: '罗马尼亚硬拉', en: 'Romanian deadlift', source: 'ai', verified: false },
  { domain: 'exercise', zh: '保加利亚分腿蹲', en: 'Bulgarian split squat', source: 'user', verified: true },
  // Manual override: the AI first returned "Goat push-ups"; the user corrected it.
  { domain: 'exercise', zh: '双杠臂屈伸', en: 'Dips', source: 'user', verified: true },
  { domain: 'exercise', zh: '面拉', en: 'Face pull', source: 'ai', verified: false },
  { domain: 'body_part', zh: '肱二头肌', en: 'Biceps', source: 'seed', verified: true },
  { domain: 'body_part', zh: '核心', en: 'Core', source: 'seed', verified: true },
  { domain: 'body_part', zh: '腘绳肌', en: 'Hamstrings', source: 'ai', verified: false },
  { domain: 'note_tag', zh: '力竭', en: 'to failure', source: 'ai', verified: false },
  { domain: 'note_tag', zh: '康复训练', en: 'rehab session', source: 'user', verified: true },
  { domain: 'sport', zh: '飞盘', en: 'Ultimate Frisbee', source: 'user', verified: true },
  { domain: 'sport', zh: '体操', en: 'Gymnastics', source: 'ai', verified: false },
]

export function translationRows(): Row[] {
  return ENTRIES.map((e) => ({ id: rid(), domain: e.domain, zh: e.zh, en: e.en, source: e.source, verified: e.verified }))
}
