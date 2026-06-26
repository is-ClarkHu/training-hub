// Settings tab — Optional trackers (SPEC §6C). v1 ships ONE tracker: intimacy.
// Strict privacy: OFF by default, enabled only via this toggle, hidden entirely
// when off, minimal data (date + count), and an explicit "delete all" action.
// (Excluded from Phase-2 AI context by default — enforced when the assistant ships.)
import { useEffect, useState } from 'react'
import { deleteAllTracker, getTrackerEntries, logTracker, today } from '../../db'
import { useLanguage } from '../../i18n'
import type { OptionalTracker } from '../../supabase/types'
import './settings.css'

const ENABLED_KEY = 'th.tracker.intimacy.enabled'

export function SettingsScreen() {
  const { lang } = useLanguage()
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === '1')
  const [date, setDate] = useState(today())
  const [count, setCount] = useState('1')
  const [rows, setRows] = useState<OptionalTracker[]>([])

  useEffect(() => {
    if (enabled) void getTrackerEntries('intimacy').then(setRows)
  }, [enabled])

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

  return (
    <div className="set-screen">
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

      <p className="set-note">{lang === 'zh' ? '更多设置(资料、翻译管理、导出)稍后加入。' : 'More settings (profile, translation manager, export) come later.'}</p>
    </div>
  )
}
