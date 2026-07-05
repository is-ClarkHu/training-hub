// Convert the read-only legacy CSV (raw_data/) into an import-ready backup file
// under data/ (SPEC §10). The output uses the same JSON shape as Settings →
// Export, so you restore it via Settings → 数据 → 恢复备份 (Restore backup).
// raw_data/ is never modified. Idempotent: stable ids mean re-import upserts.
//
// Run with Node's type stripping (Node ≥ 22.18):
//   node --experimental-strip-types migration/migrate.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLegacyCsv } from '../frontend/src/migration/parseLegacy.ts'

const here = dirname(fileURLToPath(import.meta.url))
const csv = readFileSync(resolve(here, '../raw_data/workout_log.csv'), 'utf8')
const result = parseLegacyCsv(csv)

// ── fill English names via DeepSeek (cheap; runs from Node, no CORS) ──
// Reads DEEPSEEK_API_KEY from the repo root .env. Skip with --no-translate.
function loadEnvKey(name: string): string {
  try {
    const env = readFileSync(resolve(here, '../.env'), 'utf8')
    const m = env.match(new RegExp(`^${name}=(.+)$`, 'm'))
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

async function translateBatch(names: string[], key: string): Promise<Record<string, string>> {
  const sys =
    'You translate Chinese strength-training exercise names into standard English gym ' +
    'terminology (not literal): 牧师凳弯举→Preacher Curl, 高位下拉→Lat Pulldown. ' +
    'Reply ONLY with a JSON object mapping each input to its English name.'
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 2000,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify(names) },
      ],
    }),
  })
  if (!r.ok) throw new Error(`deepseek ${r.status}: ${await r.text()}`)
  const j = await r.json()
  const txt: string = j.choices?.[0]?.message?.content ?? '{}'
  const m = txt.match(/\{[\s\S]*\}/)
  return m ? JSON.parse(m[0]) : {}
}

const noTranslate = process.argv.includes('--no-translate')
const key = loadEnvKey('DEEPSEEK_API_KEY')
if (!noTranslate && key) {
  const need = result.exercises.filter((e) => !e.name_en)
  if (need.length) {
    process.stdout.write(`translating ${need.length} exercise names via DeepSeek… `)
    try {
      const map = await translateBatch(need.map((e) => e.name_zh), key)
      let filled = 0
      for (const ex of need) {
        const en = map[ex.name_zh]
        if (en) {
          ex.name_en = en
          ex.needs_translation = false
          filled++
        }
      }
      console.log(`filled ${filled}`)
    } catch (e) {
      console.log(`skipped (${e instanceof Error ? e.message : e})`)
    }
  }
} else if (!key) {
  console.log('(no DEEPSEEK_API_KEY in .env — English names left blank, flagged needs_translation)')
}

const ts = new Date().toISOString()
const stamp = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, user_id: '', updated_at: ts }))

// Backup shape (matches Settings → Export). Table keys are the DB table names.
const backup = {
  version: 1,
  exported_at: ts,
  source: 'legacy-migration',
  tables: {
    exercises: stamp(result.exercises),
    workout_entries: stamp(result.entries),
    sets: stamp(result.sets),
    sports: stamp(result.sports),
    sport_sessions: stamp(result.sportSessions),
  },
}

const outDir = resolve(here, '../data')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'training-hub-import.json'), JSON.stringify(backup, null, 2))
writeFileSync(resolve(outDir, 'import-report.json'), JSON.stringify(result.report, null, 2))

console.log('→ data/training-hub-import.json  (import via Settings → 数据 → 恢复备份)')
console.log(
  `entries=${result.report.entries} · sets=${result.sets.length} · exercises=${result.exercises.length} · ` +
    `sport sessions=${result.report.sportSessions} · needsReview=${result.report.needsReview.length}`,
)
