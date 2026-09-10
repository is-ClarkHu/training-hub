// Settings tab — Optional trackers (SPEC §6C). v1 ships ONE tracker: intimacy.
// Strict privacy: OFF by default, enabled only via this toggle, hidden entirely
// when off, minimal data (date + count), and an explicit "delete all" action.
// (Excluded from Phase-2 AI context by default — enforced when the assistant ships.)
import { useEffect, useState } from 'react'
import {
  ensureDefaultSport,
  getSports,
  softDeleteSport,
} from '../../db'
import { useLanguage, useTheme, type ThemePref } from '../../i18n'
import { useAuth } from '../auth'
import { syncNow } from '../../sync'
import { importLegacyCsv, downloadBackup, importBackup } from '../../migration'
import { AddSportDialog, sportName } from '../sports'
import {
  INTIMACY_VISIBLE_KEY,
  setIntimacyVisible,
} from '../intimacy'
import type { Sport } from '../../supabase/types'
import {
  AI_PROVIDERS,
  getKey,
  setKey,
  getTaskCfg,
  setTaskCfg,
  catalogFor,
  lastCheckedAt,
  modelFor,
  refreshProvider,
  setTier,
  tierFor,
  NO_KEY,
  TIERS,
  type AiProvider,
  type AiTask,
  type TierKey,
} from '../../ai'
import './settings.css'

export function SettingsScreen() {
  const { lang } = useLanguage()
  const { pref: themePref, setPref: setThemePref } = useTheme()
  const THEMES: { key: ThemePref; zh: string; en: string }[] = [
    { key: 'light', zh: '浅色', en: 'Light' },
    { key: 'dark', zh: '深色', en: 'Dark' },
    { key: 'auto', zh: '自动', en: 'Auto' },
  ]
  const { session, signOut } = useAuth()
  const [sports, setSports] = useState<Sport[]>([])
  const [sportDialog, setSportDialog] = useState<{ open: boolean; sport?: Sport }>({ open: false })
  const [enabled, setEnabled] = useState(() => localStorage.getItem(INTIMACY_VISIBLE_KEY) === '1')
  const [syncMsg, setSyncMsg] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const [dataMsg, setDataMsg] = useState('')
  const [aiKeys, setAiKeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(AI_PROVIDERS.map((p) => [p, getKey(p)])),
  )
  const [taskT, setTaskT] = useState(() => getTaskCfg('translation'))
  const [taskA, setTaskA] = useState(() => getTaskCfg('assistant'))
  // Model tiers: `tiers` mirrors localStorage so the selects re-render after an
  // update; `modelReport` is the per-provider log of what "Update models" moved.
  const [tiers, setTiers] = useState<Record<string, TierKey>>(() =>
    Object.fromEntries(AI_PROVIDERS.map((p) => [p, tierFor(p)])),
  )
  const [catalogs, setCatalogs] = useState(() =>
    Object.fromEntries(AI_PROVIDERS.map((p) => [p, catalogFor(p)])),
  )
  const [modelReport, setModelReport] = useState<string[]>([])
  const [checking, setChecking] = useState('')
  const [checkedAtMs, setCheckedAtMs] = useState(() => lastCheckedAt())

  function updTier(p: AiProvider, tier: TierKey) {
    setTier(p, tier)
    setTiers((t) => ({ ...t, [p]: tier }))
  }

  // Reads each keyed provider's live /models list WITH THE USER'S OWN KEY and
  // re-resolves that provider's five tiers. Providers without a key are skipped
  // rather than failing the whole run.
  async function updateModels() {
    const keyed = AI_PROVIDERS.filter((p) => aiKeys[p])
    setModelReport([])
    if (!keyed.length) {
      setModelReport([lang === 'zh'
        ? '先在下面填一个提供方的 API key —— 模型列表是用你自己的 key 读的。'
        : 'Add a provider key below first — the model list is read with your own key.'])
      return
    }
    const lines: string[] = []
    for (const p of keyed) {
      setChecking(p)
      try {
        const { changes, count } = await refreshProvider(p, aiKeys[p])
        lines.push(changes.length
          ? `${p}: ${changes.map((c) => `${c.tier.toUpperCase()} ${c.from || '—'} → ${c.to || '—'} (${c.reason})`).join(' · ')}`
          : lang === 'zh' ? `${p}: 已是最新(提供 ${count} 个模型)。` : `${p}: already current (${count} models offered).`)
      } catch (e) {
        const msg = (e as Error).message === NO_KEY ? (lang === 'zh' ? '没有 key' : 'no key') : (e as Error).message
        lines.push(lang === 'zh' ? `${p}: 检查失败 —— ${msg}` : `${p}: couldn't check — ${msg}`)
      }
      setModelReport([...lines])
    }
    const skipped = AI_PROVIDERS.length - keyed.length
    if (skipped) {
      lines.push(lang === 'zh' ? `跳过 ${skipped} 个提供方(没填 key)。` : `${skipped} provider(s) skipped — no key on file.`)
      setModelReport([...lines])
    }
    setChecking('')
    setCatalogs(Object.fromEntries(AI_PROVIDERS.map((p) => [p, catalogFor(p)])))
    setCheckedAtMs(lastCheckedAt())
  }

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
    setIntimacyVisible(on)
    setEnabled(on)
  }

  async function doSync() {
    setSyncMsg(lang === 'zh' ? '同步中…' : 'Syncing…')
    try {
      const r = await syncNow()
      if (!r) {
        setSyncMsg(lang === 'zh' ? '未登录或离线(需先登录)' : 'not signed in / offline')
      } else if (r.errors.length) {
        setSyncMsg((lang === 'zh' ? `已推送 ${r.pushed} · 已拉取 ${r.pulled} · ${r.errors.length} 个错误:\n` : `pushed ${r.pushed} · pulled ${r.pulled} · ${r.errors.length} errors:\n`) + r.errors.join('\n'))
      } else {
        setSyncMsg(lang === 'zh' ? `已推送 ${r.pushed} · 已拉取 ${r.pulled} ✓` : `pushed ${r.pushed} · pulled ${r.pulled} ✓`)
      }
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

  async function onExport() {
    setDataMsg(lang === 'zh' ? '导出中…' : 'Exporting…')
    try {
      await downloadBackup()
      setDataMsg(lang === 'zh' ? '已导出备份 JSON' : 'Backup JSON downloaded')
    } catch (e) {
      setDataMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function onImportBackup(file: File) {
    setDataMsg(lang === 'zh' ? '恢复中…' : 'Restoring…')
    try {
      const r = await importBackup(await file.text())
      setDataMsg(lang === 'zh' ? `恢复 ${r.imported} 行 / ${r.tables} 表` : `restored ${r.imported} rows across ${r.tables} tables`)
    } catch (e) {
      setDataMsg(e instanceof Error ? e.message : String(e))
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
        <span className="th-label">{lang === 'zh' ? '外观' : 'Appearance'}</span>
        <div className="set-row">
          <div className="set-desc">{lang === 'zh' ? '主题' : 'Theme'}</div>
          <div className="set-theme">
            {THEMES.map((th) => (
              <button key={th.key} type="button" className={`th-pill ${themePref === th.key ? 'on' : ''}`} onClick={() => setThemePref(th.key)}>
                {lang === 'zh' ? th.zh : th.en}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? '运动项目' : 'Activities'}</span>
        <div className="set-ai">
          <p className="set-desc">{lang === 'zh' ? '管理运动库与自定义属性(Log 里记录场次)。' : 'Manage sports and custom fields (log sessions in the Log tab).'}</p>
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
        <span className="th-label">{lang === 'zh' ? '私密显示' : 'Private display'}</span>

        <div className={`set-row set-intimacy-head ${enabled ? 'on' : ''}`}>
          <div>
            <div className="set-name">{lang === 'zh' ? '成人亲密健康' : 'Adult wellness'}</div>
            <div className="set-desc">
              {lang === 'zh'
                ? '私密 · 默认隐藏 · 关闭只是不显示,记录仍保留'
                : 'Private · hidden by default · turning off only hides existing records'}
            </div>
          </div>
          <label className="set-switch">
            <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
            <span>{enabled ? (lang === 'zh' ? '开' : 'on') : (lang === 'zh' ? '关' : 'off')}</span>
          </label>
        </div>

        {enabled && (
          <div className="set-tracker set-intimacy-note">
            <p className="set-desc">
              {lang === 'zh'
                ? '开启后,Log 会出现独立的私密记录入口,History 和 Dashboard 也会显示相关数据。关闭后这些记录不会显示,但数据仍保留；如需删除,请在 History 里删除单条记录。'
                : 'When enabled, Log shows a separate private entry point, and History/Dashboard include the data. Turning this off hides those records without deleting them; delete individual records from History.'}
            </p>
          </div>
        )}
      </section>

      <section className="set-section">
        <span className="th-label">{lang === 'zh' ? 'AI 设置' : 'AI'}</span>
        <div className="set-ai">
          <p className="set-desc">
            {lang === 'zh'
              ? '每类任务选提供方,模型跟随该提供方的档位(下方可调,留空模型框即可);填对应的 API key(只存本机)。翻译是浏览器直连——填了 key 联网即用,不用跑后端。提示:DeepSeek/OpenAI 等可能被浏览器 CORS 挡,翻译建议选 Gemini 或 Anthropic(可直连)。助手仍走后端。'
              : 'Pick a provider per task — the model follows that provider’s tier (set below; leave the model box empty) — and paste that provider’s API key (stored on this device). Translation runs browser-direct — set a key + go online, no backend needed. Note: DeepSeek/OpenAI may be CORS-blocked in the browser; for translation prefer Gemini or Anthropic. The assistant still uses the backend.'}
          </p>

          {(['translation', 'assistant'] as AiTask[]).map((t) => {
            const cfg = t === 'translation' ? taskT : taskA
            return (
              <div key={t} className="set-ai-row">
                <span className="set-ai-task">{t === 'translation' ? (lang === 'zh' ? '翻译' : 'Translation') : (lang === 'zh' ? '助手' : 'Assistant')}</span>
                {/* Switching provider drops any pinned id — the new provider's tier decides. */}
                <select
                  className="th-input set-ai-prov"
                  value={cfg.provider}
                  onChange={(e) => updTask(t, e.target.value as AiProvider, '')}
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  className="th-input"
                  value={cfg.model}
                  onChange={(e) => updTask(t, cfg.provider, e.target.value)}
                  placeholder={modelFor(cfg.provider)}
                  aria-label={`${t} model`}
                  title={lang === 'zh'
                    ? '留空 = 用该提供方所选档位的模型;填了就是固定这个 id。'
                    : 'Leave empty to follow the provider’s tier; type an id to pin it.'}
                />
              </div>
            )
          })}

          <span className="th-label set-ai-keys-label">{lang === 'zh' ? '模型档位(按提供方)' : 'Model tier (per provider)'}</span>
          <p className="set-desc">
            {lang === 'zh'
              ? '每个提供方有五档:T1 最新最强 → T5 最小最快。只有 T1 跟随前沿——点「更新模型」会用你自己的 key 读取该提供方当前在售的模型列表,把 T1 重新指向最强的那个,并修复已下架的档位(替补永远不会跳到上一档之上)。T2–T5 只要还在服务就不动。'
              : 'Five graded slots per provider: T1 newest & strongest → T5 smallest & fastest. Only T1 tracks the frontier — “Update models” reads that provider’s live model list with your own key, re-points T1 at the strongest model on offer, and repairs any slot whose pin was retired (a replacement never jumps above the tier over it). T2–T5 stay put while they’re still served.'}
          </p>
          <div className="set-row">
            <button className="th-btn set-log" type="button" onClick={() => void updateModels()} disabled={!!checking}>
              {checking
                ? (lang === 'zh' ? `检查 ${checking}…` : `Checking ${checking}…`)
                : (lang === 'zh' ? '更新模型' : 'Update models')}
            </button>
            <div className="set-desc">
              {checkedAtMs
                ? (lang === 'zh' ? `上次检查 ${new Date(checkedAtMs).toLocaleString()}` : `Last checked ${new Date(checkedAtMs).toLocaleString()}`)
                : (lang === 'zh' ? '从未检查 —— 用的是内置默认值' : 'Never checked — showing the shipped defaults')}
            </div>
          </div>
          {AI_PROVIDERS.map((p) => {
            const cat = catalogs[p] ?? {}
            return (
              <div key={p} className="set-ai-row">
                <span className="set-ai-task">{p}</span>
                <select
                  className="th-input"
                  value={tiers[p]}
                  onChange={(e) => updTier(p, e.target.value as TierKey)}
                  aria-label={`${p} model tier`}
                >
                  {TIERS.map((tier) => (
                    <option key={tier.key} value={tier.key} disabled={!cat[tier.key]} title={lang === 'zh' ? tier.zh : tier.en}>
                      {tier.label} — {cat[tier.key] || (lang === 'zh' ? '暂无' : 'unavailable')}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
          {modelReport.length > 0 && (
            <div className="set-ai-report">
              {modelReport.map((line, i) => (
                <div key={i} className="set-desc">{line}</div>
              ))}
            </div>
          )}

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
        <span className="th-label">{lang === 'zh' ? '数据(导入 / 导出)' : 'Data (import / export)'}</span>
        <div className="set-import">
          <div className="set-row">
            <div className="set-desc">{lang === 'zh' ? '导出全部数据为 JSON 备份' : 'Export all data as a JSON backup'}</div>
            <button className="th-btn set-log" type="button" onClick={onExport}>{lang === 'zh' ? '导出备份' : 'Export'}</button>
          </div>

          <label className="set-desc set-file">
            {lang === 'zh' ? '恢复备份(JSON):' : 'Restore backup (JSON):'}
            <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && void onImportBackup(e.target.files[0])} />
          </label>

          <label className="set-desc set-file">
            {lang === 'zh' ? '导入旧 CSV(workout_log.csv):' : 'Import legacy CSV (workout_log.csv):'}
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
          </label>

          {(dataMsg || importMsg) && <p className="set-desc set-datamsg">{dataMsg || importMsg}</p>}
          <p className="set-desc">{lang === 'zh' ? '导入均为可重复安全(按 id 覆盖);导入后到「同步」上云。' : 'Imports are re-run safe (upsert by id); Sync now to push to the cloud.'}</p>
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
