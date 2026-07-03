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
