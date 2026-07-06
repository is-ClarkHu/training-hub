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
  DEFAULT_MODEL,
  getKey,
  setKey,
  getTaskCfg,
  setTaskCfg,
  type AiProvider,
  type AiTask,
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
              ? '每类任务选提供方/模型,填对应的 API key(只存本机)。翻译是浏览器直连——填了 key 联网即用,不用跑后端。提示:DeepSeek/OpenAI 等可能被浏览器 CORS 挡,翻译建议选 Gemini 或 Anthropic(可直连)。助手仍走后端。'
              : 'Pick a provider/model per task and paste that provider’s API key (stored on this device). Translation runs browser-direct — set a key + go online, no backend needed. Note: DeepSeek/OpenAI may be CORS-blocked in the browser; for translation prefer Gemini or Anthropic. The assistant still uses the backend.'}
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
