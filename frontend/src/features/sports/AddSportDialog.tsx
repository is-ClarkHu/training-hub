// Add / edit a sport and its 4 tier labels (SPEC §4.5, §7.4). For a new sport the
// name is translated via the translation subsystem (domain 'sport'); tier labels
// default to a template the user can rename per sport.
import { useState } from 'react'
import { createSport, updateSport } from '../../db'
import { requestTranslation } from '../../translation'
import { DEFAULT_SPORT_TIERS, type Sport, type SportTier } from '../../supabase/types'
import type { TranslationTarget } from '../../translation'

const HAS_CJK = /[一-鿿]/

export function AddSportDialog({
  lang,
  sport,
  onSaved,
  onClose,
}: {
  lang: TranslationTarget
  sport?: Sport
  onSaved: (s: Sport) => void
  onClose: () => void
}) {
  const editing = !!sport
  const [raw, setRaw] = useState('')
  const [nameZh, setNameZh] = useState(sport?.name_zh ?? '')
  const [nameEn, setNameEn] = useState(sport?.name_en ?? '')
  const [tiers, setTiers] = useState<SportTier[]>(
    (sport?.tiers ?? DEFAULT_SPORT_TIERS).map((t) => ({ ...t })),
  )
  const [proposed, setProposed] = useState(editing)
  const [busy, setBusy] = useState(false)

  async function onSuggest() {
    if (!raw.trim()) return
    setBusy(true)
    const inputIsZh = HAS_CJK.test(raw)
    const target: TranslationTarget = inputIsZh ? 'en' : 'zh'
    try {
      const res = await requestTranslation('sport', raw.trim(), target)
      setNameZh(inputIsZh ? raw.trim() : res.text)
      setNameEn(inputIsZh ? res.text : raw.trim())
    } catch {
      setNameZh(inputIsZh ? raw.trim() : '')
      setNameEn(inputIsZh ? '' : raw.trim())
    }
    setProposed(true)
    setBusy(false)
  }

  function setTier(i: number, patch: Partial<SportTier>) {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }

  async function onSave() {
    if (!nameZh.trim() && !nameEn.trim()) return
    setBusy(true)
    if (sport) {
      await updateSport(sport.id, { name_zh: nameZh.trim(), name_en: nameEn.trim(), tiers })
      onSaved({ ...sport, name_zh: nameZh.trim(), name_en: nameEn.trim(), tiers })
    } else {
      const created = await createSport({
        name_zh: nameZh.trim(),
        name_en: nameEn.trim(),
        tiers,
        needs_translation: !nameZh.trim() || !nameEn.trim(),
      })
      onSaved(created)
    }
    setBusy(false)
  }

  return (
    <div className="sport-dialog-backdrop" onClick={onClose}>
      <div className="sport-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Edit sport' : 'Add sport'}</h3>

        {!editing && (
          <div className="sport-field">
            <label className="th-label" htmlFor="sp-raw">Name (Chinese or English)</label>
            <div className="sport-row">
              <input id="sp-raw" className="th-input" value={raw} onChange={(e) => setRaw(e.target.value)}
                placeholder={lang === 'zh' ? '例如 篮球' : 'e.g. basketball'} autoFocus />
              <button className="th-btn-ghost sport-suggest" type="button" onClick={onSuggest} disabled={busy || !raw.trim()}>
                {busy ? '…' : 'Suggest'}
              </button>
            </div>
          </div>
        )}

        {proposed && (
          <>
            <div className="sport-grid2">
              <div className="sport-field">
                <label className="th-label" htmlFor="sp-zh">中文名</label>
                <input id="sp-zh" className="th-input" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
              </div>
              <div className="sport-field">
                <label className="th-label" htmlFor="sp-en">English name</label>
                <input id="sp-en" className="th-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
            </div>

            <span className="th-label">Intensity tiers (1 → 4)</span>
            {tiers.map((t, i) => (
              <div key={t.level} className="sport-tier-row">
                <span className="sport-tier-lv">{t.level}</span>
                <input className="th-input" value={t.zh} onChange={(e) => setTier(i, { zh: e.target.value })} placeholder="中文" />
                <input className="th-input" value={t.en} onChange={(e) => setTier(i, { en: e.target.value })} placeholder="English" />
              </div>
            ))}
          </>
        )}

        <div className="sport-dialog-actions">
          <button className="th-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="th-btn" type="button" onClick={onSave} disabled={busy || !proposed || (!nameZh.trim() && !nameEn.trim())}>
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
