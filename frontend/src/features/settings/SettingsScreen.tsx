// Settings tab — Optional trackers (SPEC §6C). v1 ships ONE tracker: intimacy.
// Strict privacy: OFF by default, enabled only via this toggle, hidden entirely
// when off, minimal data (date + count), and an explicit "delete all" action.
// (Excluded from Phase-2 AI context by default — enforced when the assistant ships.)
import { useEffect, useState } from 'react'
import {
  deleteAllTracker,
  getTrackerEntries,
  logTracker,
  today,
  ensureDefaultSport,
  getSports,
  softDeleteSport,
} from '../../db'
import { useLanguage } from '../../i18n'
import { useAuth } from '../auth'
import { syncNow } from '../../sync'
import { importLegacyCsv } from '../../migration'
import { AddSportDialog, sportName } from '../sports'
import type { Sport } from '../../supabase/types'
import {
  AI_PROVIDERS,
  DEFAULT_MODEL,
  getKey,
  setKey,
  getTaskCfg,
  setTaskCfg,
  type AiProvider,
  type AiTask,
} from '../../ai'
import type { OptionalTracker } from '../../supabase/types'
import './settings.css'

const ENABLED_KEY = 'th.tracker.intimacy.enabled'

export function SettingsScreen() {
  const { lang } = useLanguage()
  const { session, signOut } = useAuth()
  const [sports, setSports] = useState<Sport[]>([])
  const [sportDialog, setSportDialog] = useState<{ open: boolean; sport?: Sport }>({ open: false })
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === '1')
  const [date, setDate] = useState(today())
  const [count, setCount] = useState('1')
  const [rows, setRows] = useState<OptionalTracker[]>([])
  const [syncMsg, setSyncMsg] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const [aiKeys, setAiKeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(AI_PROVIDERS.map((p) => [p, getKey(p)])),
  )
  const [taskT, setTaskT] = useState(() => getTaskCfg('translation'))
  const [taskA, setTaskA] = useState(() => getTaskCfg('assistant'))

  function updKey(p: AiProvider, v: string) {
    setKey(p, v)
    setAiKeys((k) => ({ ...k, [p]: v }))
  }
  function updTask(t: AiTask, provider: AiProvider, model: string) {
    const cfg = { provider, model }
    setTaskCfg(t, cfg)
    ;(t === 'translation' ? setTaskT : setTaskA)(cfg)
  }

  useEffect(() => {
    if (enabled) void getTrackerEntries('intimacy').then(setRows)
  }, [enabled])

  useEffect(() => {
    void ensureDefaultSport().then(setSports)
  }, [])

  async function reloadSports() {
    setSports(await getSports())
  }
  async function delSport(s: Sport) {
    if (sports.length <= 1) return
    if (!confirm(lang === 'zh' ? `删除运动「${sportName(s, lang)}」?` : `Delete sport “${sportName(s, lang)}”?`)) return
    await softDeleteSport(s.id)
    await reloadSports()
  }

  function toggle(on: boolean) {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
    setEnabled(on)
  }

  async function add() {
    const n = parseInt(count, 10)
    if (!Number.isFinite(n) || n <= 0) return
    await logTracker('intimacy', date, n)
    setRows(await getTrackerEntries('intimacy'))
    setCount('1')
  }

  async function deleteAll() {
    if (!confirm(lang === 'zh' ? '删除全部该追踪数据?' : 'Delete all data for this tracker?')) return
    await deleteAllTracker('intimacy')
    setRows([])
  }

  async function doSync() {
    setSyncMsg(lang === 'zh' ? '同步中…' : 'Syncing…')
    try {
      const r = await syncNow()
      setSyncMsg(r ? (lang === 'zh' ? `已推送 ${r.pushed} · 已拉取 ${r.pulled}` : `pushed ${r.pushed} · pulled ${r.pulled}`) : (lang === 'zh' ? '未登录或离线' : 'not signed in / offline'))
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function onImport(file: File) {
    setImportMsg(lang === 'zh' ? '导入中…' : 'Importing…')
    try {
      const rep = await importLegacyCsv(await file.text())
      setImportMsg(
        lang === 'zh'
          ? `导入 ${rep.entries} 条 · ${rep.sportSessions} 场次 · 跳过 ${rep.skipped} · 待复核 ${rep.needsReview.length}`
          : `imported ${rep.entries} entries · ${rep.sportSessions} sessions · ${rep.skipped} skipped · ${rep.needsReview.length} need review`,
      )
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="set-screen">
      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? '账户' : 'Account'}</span>
        <div className="set-row">
          <div className="set-desc">{session?.user.email}</div>
          <button className="th-btn-ghost set-log" type="button" onClick={() => void signOut()}>{lang === 'zh' ? '登出' : 'Sign out'}</button>
        </div>
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? '运动项目' : 'Activities'}</span>
        <div className="set-ai">
          <p className="set-desc">{lang === 'zh' ? '管理运动库与它们的 4 档强度(Log 里记录场次)。' : 'Manage your sports and their 4 intensity tiers (log sessions in the Log tab).'}</p>
          {sports.map((s) => (
            <div key={s.id} className="set-row set-activity">
              <div className="set-name">{sportName(s, lang)}</div>
              <div className="set-act-buttons">
                <button className="hist-link" type="button" onClick={() => setSportDialog({ open: true, sport: s })}>edit</button>
                {sports.length > 1 && <button className="hist-link danger" type="button" onClick={() => delSport(s)}>delete</button>}
              </div>
            </div>
          ))}
          <button className="th-btn-ghost set-log" type="button" onClick={() => setSportDialog({ open: true })}>{lang === 'zh' ? '+ 运动' : '+ Sport'}</button>
        </div>
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? '可选追踪' : 'Optional trackers'}</span>

        <div className="set-row">
          <div>
            <div className="set-name">{lang === 'zh' ? '亲密度' : 'Intimacy'}</div>
            <div className="set-desc">
              {lang === 'zh' ? '私密 · 仅记日期与次数 · 默认关闭' : 'Private · date + count only · off by default'}
            </div>
          </div>
          <label className="set-switch">
            <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
            <span>{enabled ? (lang === 'zh' ? '开' : 'on') : (lang === 'zh' ? '关' : 'off')}</span>
          </label>
        </div>

        {enabled && (
          <div className="set-tracker">
            <div className="set-tracker-form">
              <input className="th-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <input className="th-input set-count" inputMode="numeric" value={count}
                onChange={(e) => setCount(e.target.value)} aria-label="count" />
              <button className="th-btn set-log" type="button" onClick={add}>{lang === 'zh' ? '记录' : 'Log'}</button>
            </div>

            {rows.length > 0 && (
              <ul className="set-list">
                {rows.slice(0, 20).map((r) => (
                  <li key={r.id} className="set-list-item">
                    <span>{r.date}</span>
                    <span className="set-count-v">×{r.count}</span>
                  </li>
                ))}
              </ul>
            )}

            <button className="hist-link danger" type="button" onClick={deleteAll}>
              {lang === 'zh' ? '删除全部亲密度数据' : 'Delete all intimacy data'}
            </button>
          </div>
        )}
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? 'AI 设置' : 'AI'}</span>
        <div className="set-ai">
          <p className="set-desc">
            {lang === 'zh'
              ? '每类任务选提供方/模型,并填对应的 API key。key 只存在本机,经你本地后端(:8000)中转调用。'
              : 'Pick a provider/model per task and paste that provider’s API key. Keys stay on this device and calls relay through your local backend (:8000).'}
          </p>

          {(['translation', 'assistant'] as AiTask[]).map((t) => {
            const cfg = t === 'translation' ? taskT : taskA
            return (
              <div key={t} className="set-ai-row">
                <span className="set-ai-task">{t === 'translation' ? (lang === 'zh' ? '翻译' : 'Translation') : (lang === 'zh' ? '助手' : 'Assistant')}</span>
                <select
                  className="th-input set-ai-prov"
                  value={cfg.provider}
                  onChange={(e) => updTask(t, e.target.value as AiProvider, DEFAULT_MODEL[e.target.value as AiProvider])}
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  className="th-input"
                  value={cfg.model}
                  onChange={(e) => updTask(t, cfg.provider, e.target.value)}
                  placeholder="model"
                  aria-label={`${t} model`}
                />
              </div>
            )
          })}

          <span className="th-label set-ai-keys-label">{lang === 'zh' ? 'API Keys(按提供方)' : 'API keys (per provider)'}</span>
          {AI_PROVIDERS.map((p) => (
            <div key={p} className="set-ai-row">
              <span className="set-ai-task">{p}</span>
              <input
                className="th-input"
                type="password"
                autoComplete="off"
                value={aiKeys[p] ?? ''}
                onChange={(e) => updKey(p, e.target.value)}
                placeholder={`${p} API key`}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? '同步' : 'Sync'}</span>
        <div className="set-row">
          <div className="set-desc">{syncMsg || (lang === 'zh' ? '后台自动同步 · 也可手动' : 'Auto-syncs in background · or manually')}</div>
          <button className="th-btn set-log" type="button" onClick={doSync}>{lang === 'zh' ? '立即同步' : 'Sync now'}</button>
        </div>
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? '导入旧数据' : 'Import legacy data'}</span>
        <div className="set-import">
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
          {importMsg && <p className="set-desc">{importMsg}</p>}
          <p className="set-desc">{lang === 'zh' ? '上传旧 workout_log.csv → 解析入库(可重复导入)。' : 'Upload the legacy workout_log.csv → parsed into the local store (re-import safe).'}</p>
        </div>
      </section>

      <p className="set-note">{lang === 'zh' ? '更多设置(资料、翻译管理、导出)稍后加入。' : 'More settings (profile, translation manager, export) come later.'}</p>

      {sportDialog.open && (
        <AddSportDialog
          lang={lang}
          sport={sportDialog.sport}
          onSaved={() => { setSportDialog({ open: false }); void reloadSports() }}
          onClose={() => setSportDialog({ open: false })}
        />
      )}
    </div>
  )
}
