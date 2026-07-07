// Category (body-part) CRUD — add custom categories like "pull" / "upper body".
// Defaults (chest…core, warmup, sports) can be renamed but not deleted; custom
// ones are fully editable. Like adding an exercise: type one language, machine-
// translate the other (or fill both yourself).
import { useState } from 'react'
import {
  useCategories,
  addCategory,
  updateCategory,
  removeCategory,
  isCustomCategory,
  snapshotCategories,
  type Category,
} from '../../categories'
import { requestTranslation } from '../../translation'
import type { TranslationTarget } from '../../translation'
import { useUndo } from '../../undo'

const HAS_CJK = /[一-鿿]/

export function CategoryManager({ lang }: { lang: TranslationTarget }) {
  const cats = useCategories()
  const [editing, setEditing] = useState<Category | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="cyc-cat-mgr">
      <div className="cyc-cat-list">
        {cats.map((c) => (
          <button key={c.key} type="button" className="cyc-cat-chip" onClick={() => setEditing(c)}>
            {lang === 'zh' ? c.zh : c.en}
            {isCustomCategory(c.key) && <span className="cyc-cat-custom">·</span>}
          </button>
        ))}
        <button type="button" className="th-btn-ghost cyc-cat-add" onClick={() => setAdding(true)}>
          {lang === 'zh' ? '+ 分类' : '+ Category'}
        </button>
      </div>

      {(adding || editing) && (
        <CategoryDialog
          lang={lang}
          category={editing}
          onClose={() => { setAdding(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function CategoryDialog({
  lang,
  category,
  onClose,
}: {
  lang: TranslationTarget
  category: Category | null
  onClose: () => void
}) {
  const { push } = useUndo()
  const editing = !!category
  const custom = category ? isCustomCategory(category.key) : true
  const [raw, setRaw] = useState('')
  const [zh, setZh] = useState(category?.zh ?? '')
  const [en, setEn] = useState(category?.en ?? '')
  const [busy, setBusy] = useState(false)

  async function onSuggest() {
    if (!raw.trim()) return
    setBusy(true)
    const inputIsZh = HAS_CJK.test(raw)
    const target: TranslationTarget = inputIsZh ? 'en' : 'zh'
    try {
      const res = await requestTranslation('body_part', raw.trim(), target)
      setZh(inputIsZh ? raw.trim() : res.text)
      setEn(inputIsZh ? res.text : raw.trim())
    } catch {
      setZh(inputIsZh ? raw.trim() : '')
      setEn(inputIsZh ? '' : raw.trim())
    }
    setBusy(false)
  }

  function save() {
    if (!zh.trim() && !en.trim()) return
    const restore = snapshotCategories()
    const label = (lang === 'zh' ? zh : en).trim() || (lang === 'zh' ? en : zh).trim()
    if (category) updateCategory(category.key, { zh: zh.trim(), en: en.trim() })
    else addCategory({ zh: zh.trim(), en: en.trim() })
    onClose()
    push(
      category
        ? (lang === 'zh' ? `已保存分类「${label}」` : `Saved category “${label}”`)
        : (lang === 'zh' ? `已新建分类「${label}」` : `Added category “${label}”`),
      restore,
    )
  }
  function del() {
    if (!category) return
    if (!confirm(lang === 'zh' ? '删除该分类?(已用它的动作会保留原分类名)' : 'Delete this category? (exercises keep the raw key)')) return
    const restore = snapshotCategories()
    const label = lang === 'zh' ? category.zh : category.en
    removeCategory(category.key)
    onClose()
    push(lang === 'zh' ? `已删除分类「${label}」` : `Deleted category “${label}”`, restore)
  }

  return (
    <div className="log-dialog-backdrop" onClick={onClose}>
      <div className="log-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? (lang === 'zh' ? '编辑分类' : 'Edit category') : (lang === 'zh' ? '新分类' : 'New category')}</h3>

        {!editing && (
          <div className="log-field">
            <label className="th-label">{lang === 'zh' ? '名称(中/英,可自动翻译)' : 'Name (zh/en, auto-translate)'}</label>
            <div className="log-row">
              <input className="th-input" value={raw} onChange={(e) => setRaw(e.target.value)}
                placeholder={lang === 'zh' ? '例如 拉 / pull' : 'e.g. pull'} autoFocus />
              <button className="th-btn-ghost log-suggest" type="button" onClick={onSuggest} disabled={busy || !raw.trim()}>
                {busy ? '…' : 'Suggest'}
              </button>
            </div>
          </div>
        )}

        <div className="log-grid2">
          <div className="log-field">
            <label className="th-label">中文名</label>
            <input className="th-input" value={zh} onChange={(e) => setZh(e.target.value)} />
          </div>
          <div className="log-field">
            <label className="th-label">English</label>
            <input className="th-input" value={en} onChange={(e) => setEn(e.target.value)} />
          </div>
        </div>

        <div className="log-dialog-actions">
          {editing && custom && <button className="th-btn-ghost" type="button" onClick={del}>{lang === 'zh' ? '删除' : 'Delete'}</button>}
          <button className="th-btn-ghost" type="button" onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
          <button className="th-btn" type="button" onClick={save}>{lang === 'zh' ? '保存' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
