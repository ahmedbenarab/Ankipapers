import React, { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, Save, Sun, Moon, HardDrive } from 'lucide-react'
import { exportPapersToDisk } from '../bridge'
import SettingsAI from './SettingsAI'

const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')

const COLOR_SCHEMES = [
  { id: 'purple', label: 'Original purple', swatch: 'linear-gradient(135deg, #6c5ce7, #a855f7)' },
  { id: 'mono', label: 'Black & white', swatch: 'linear-gradient(135deg, #111111 50%, #ffffff 50%)' },
  { id: 'carolina', label: 'Carolina blue', swatch: 'linear-gradient(135deg, #4b9cd3 50%, #19468d 50%)' },
  { id: 'crimson', label: 'Crimson', swatch: 'linear-gradient(135deg, #9e1b32 50%, #ffffff 50%)' },
]

export default function Settings({ settings, onSave, onClose, onConvertEmphasis, initialSection = null }) {
  const [local, setLocal] = useState({ ...settings })
  const update = (key, value) => setLocal(prev => ({ ...prev, [key]: value }))
  const aiRef = useRef(null)
  useEffect(() => {
    if (initialSection === 'ai') setTimeout(() => aiRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
  }, [initialSection])

  // ── Papers on disk (phase 1) ────────────────────────────────────────────
  // Writes a copy of every paper to the Anki profile folder. Nothing reads
  // those files yet — they exist so their contents can be checked against
  // what the collection holds before anything starts depending on them.
  const [diskReport, setDiskReport] = useState(null)
  const [diskBusy, setDiskBusy] = useState(false)
  const runDiskExport = async (mode) => {
    setDiskBusy(true)
    try { setDiskReport(await exportPapersToDisk(mode)) }
    finally { setDiskBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title"><SettingsIcon size={18} /> Settings</div>

        {/* Only this part scrolls, so the title and the Save button always
            stay on screen however short the window is. */}
        <div className="settings-body">
        <div className="settings-grid">
          <label className="settings-label">Default Deck</label>
          <input className="modal-input" value={local.default_deck || 'Default'}
            onChange={e => update('default_deck', e.target.value)} />

          <label className="settings-label">Auto-save Interval (seconds)</label>
          <input className="modal-input" type="number" min={5} max={300}
            value={local.auto_save_interval_seconds || 30}
            onChange={e => update('auto_save_interval_seconds', parseInt(e.target.value) || 30)} />

          <label className="settings-label">Editor Font Size</label>
          <input className="modal-input" type="number" min={10} max={24}
            value={local.font_size || 14}
            onChange={e => update('font_size', parseInt(e.target.value) || 14)} />

          <label className="settings-label">Editor Font Family</label>
          <select className="deck-select" style={{ width: '100%', marginBottom: 12 }}
            value={local.font_family || 'JetBrains Mono'}
            onChange={e => update('font_family', e.target.value)}>
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Cascadia Code">Cascadia Code</option>
            <option value="Fira Code">Fira Code</option>
            <option value="Consolas">Consolas</option>
            <option value="Source Code Pro">Source Code Pro</option>
            <option value="monospace">System Monospace</option>
          </select>

          <label className="settings-label">Theme</label>
          <div className="theme-toggle-group">
            <button
              className={`theme-btn ${(local.editor_theme || 'dark') === 'dark' ? 'active' : ''}`}
              onClick={() => update('editor_theme', 'dark')}>
              <Moon size={14} /> Dark
            </button>
            <button
              className={`theme-btn ${local.editor_theme === 'light' ? 'active' : ''}`}
              onClick={() => update('editor_theme', 'light')}>
              <Sun size={14} /> Light
            </button>
          </div>

          <label className="settings-label">Toolbar</label>
          <p className="settings-field-hint">
            On a narrow window the toolbar can either wrap onto a second line or stay on one line
            that scrolls sideways (with the trackpad, a mouse wheel, or the thin scrollbar under it).
          </p>
          <div className="theme-toggle-group">
            <button
              className={`theme-btn ${!local.toolbar_scroll ? 'active' : ''}`}
              onClick={() => update('toolbar_scroll', false)}>
              Wrap onto more lines
            </button>
            <button
              className={`theme-btn ${local.toolbar_scroll ? 'active' : ''}`}
              onClick={() => update('toolbar_scroll', true)}>
              Scroll sideways
            </button>
          </div>

          <label className="settings-label">Color Scheme</label>
          <p className="settings-field-hint">
            Colors the whole app in both Dark and Light, and the Basic card style on your
            Anki cards. Source view stays black on white in every scheme.
          </p>
          <div className="theme-toggle-group scheme-toggle-group">
            {COLOR_SCHEMES.map(({ id, label, swatch }) => (
              <button key={id}
                className={`theme-btn ${(local.color_scheme || 'carolina') === id ? 'active' : ''}`}
                onClick={() => update('color_scheme', id)}>
                <span className="scheme-swatch" style={{ background: swatch }} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <label className="settings-label">Show Card Indicators</label>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.show_card_indicators !== false}
              onChange={e => update('show_card_indicators', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.show_card_indicators !== false ? 'Enabled' : 'Disabled'}</span>
          </label>

          <label className="settings-label">Weak-Spot Markers</label>
          <p className="settings-field-hint">
            Marks lines whose cards you keep missing in Anki: amber after 3 lapses, red for a
            leech Anki has suspended. Rest the pointer on one for its review history.
          </p>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.weak_spot_markers !== false}
              onChange={e => update('weak_spot_markers', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.weak_spot_markers !== false ? 'Enabled' : 'Disabled'}</span>
          </label>

          <label className="settings-label">Chapter Bar</label>
          <p className="settings-field-hint">
            The line above a paper that is a chapter of its folder's book or course: which book,
            which chapter, and a step to the previous or next one. On shows it on every such
            paper. Off hides it, except on papers where you've turned it on with the book
            button in the toolbar.
          </p>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.show_chapter_bar === true}
              onChange={e => update('show_chapter_bar', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.show_chapter_bar === true ? 'On for every paper' : 'Only where turned on'}</span>
          </label>

          <label className="settings-label">Chapters Waiting for a Paper</label>
          <p className="settings-field-hint">
            When a folder has a book or course attached, list its chapters that don't have a
            paper yet in the sidebar, faded, inside the folder they belong in. Click one to
            create its paper, already linked.
          </p>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.show_waiting_chapters === true}
              onChange={e => update('show_waiting_chapters', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.show_waiting_chapters === true ? 'Shown' : 'Hidden'}</span>
          </label>

          <label className="settings-label">Line Numbers</label>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.show_line_numbers !== false}
              onChange={e => update('show_line_numbers', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.show_line_numbers !== false ? 'Enabled' : 'Disabled'}</span>
          </label>

          {IS_MAC && (
            <>
              <label className="settings-label">macOS Text Replacements</label>
              <p className="settings-field-hint">
                Type a shortcut from System Settings → Keyboard → Text Replacements, then Space
                or Return, and it becomes its phrase. Control+Z brings the shortcut back.
              </p>
              <label className="settings-toggle">
                <input type="checkbox" checked={local.text_replacements_enabled !== false}
                  onChange={e => update('text_replacements_enabled', e.target.checked)} />
                <span className="toggle-slider" />
                <span className="toggle-text">{local.text_replacements_enabled !== false ? 'Enabled' : 'Disabled'}</span>
              </label>
            </>
          )}

          <label className="settings-label">Card Style</label>
          <p className="settings-field-hint">
            How your Anki cards look, in the color scheme chosen above: each scheme has its
            own Basic and Solarized version (Original purple keeps the classic Solarized).
            Solarized is light when Anki is in light mode and dark in dark mode. Saving
            restyles every Anki Papers card at once.
          </p>
          <div className="theme-toggle-group">
            <button
              className={`theme-btn ${(local.card_style || 'basic') === 'basic' ? 'active' : ''}`}
              onClick={() => update('card_style', 'basic')}>
              Basic
            </button>
            <button
              className={`theme-btn ${local.card_style === 'solarized' ? 'active' : ''}`}
              onClick={() => update('card_style', 'solarized')}>
              Solarized Styling
            </button>
          </div>

          <label className="settings-label">When Anki note differs from paper</label>
          <p className="settings-field-hint">
            Applies when the paper line is unchanged but the note was edited in Browse / note editor.
          </p>
          <select
            className="deck-select"
            style={{ width: '100%', marginBottom: 12 }}
            value={local.anki_edit_conflict || 'ask'}
            onChange={(e) => update('anki_edit_conflict', e.target.value)}
          >
            <option value="ask">Ask me each time (recommended)</option>
            <option value="preserve">Always keep Anki edits (no prompt)</option>
            <option value="overwrite">Always use paper text (no prompt)</option>
            <option value="abort">Stop generate and show error (no changes)</option>
          </select>
        </div>

        <SettingsAI local={local} update={update} sectionRef={aiRef} />

        <div className="settings-info">
          <div className="settings-shortcuts-title">
            <HardDrive size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Papers on disk
          </div>
          <p className="settings-field-hint">
            Writes a copy of every paper into your Anki profile folder as one
            markdown file each, so you can read, back up and version them.
            Your papers stay exactly where they are — this only adds files.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="modal-btn" disabled={diskBusy}
                    onClick={() => runDiskExport('preview')}>
              {diskBusy ? 'Working…' : 'Preview'}
            </button>
            <button className="modal-btn" disabled={diskBusy}
                    onClick={() => runDiskExport('write')}>
              Write files
            </button>
          </div>
          {diskReport && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
              {diskReport.error ? (
                <div style={{ color: 'var(--red)' }}>{diskReport.error}</div>
              ) : (
                <>
                  <div>
                    {diskReport.dry_run ? 'Would write' : 'Wrote'}{' '}
                    <b>{diskReport.written?.length ?? 0}</b> papers
                    {' '}({diskReport.card_ref_count} card links)
                    {diskReport.failed?.length ? (
                      <span style={{ color: 'var(--red)' }}>
                        {' '}· {diskReport.failed.length} failed
                      </span>
                    ) : null}
                  </div>
                  <div style={{ opacity: .7, wordBreak: 'break-all' }}>{diskReport.root}</div>
                  {diskReport.renamed?.length > 0 && (
                    <div style={{ marginTop: 6, color: 'var(--orange)' }}>
                      {diskReport.renamed.length} title(s) adjusted to fit a filename —
                      the full title is kept inside each file.
                    </div>
                  )}
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16, maxHeight: 150, overflowY: 'auto' }}>
                    {(diskReport.written || []).map((w) => (
                      <li key={w.id} style={{ opacity: .85 }}>
                        {w.path || w.md} <span style={{ opacity: .6 }}>· {w.cards ?? 0} cards</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        {onConvertEmphasis && (
          <div className="settings-info">
            <div className="settings-shortcuts-title">Bold &amp; italic format</div>
            <p className="settings-field-hint">
              Bold and italic are now saved as &lt;b&gt; and &lt;i&gt; tags. This converts any
              older **bold** and *italic* in your papers to match, once. It shows how many it
              found and asks first, saves a backup of every paper, and leaves code and maths
              alone. Your cards look exactly the same afterwards.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="modal-btn" onClick={onConvertEmphasis}>Convert old bold &amp; italic…</button>
            </div>
          </div>
        )}

        <div className="settings-info">
          <div className="settings-shortcuts-title">Keyboard Shortcuts</div>
          <div className="settings-shortcut"><kbd>Ctrl+S</kbd> Save</div>
          <div className="settings-shortcut"><kbd>Ctrl+G</kbd> Generate Cards</div>
          <div className="settings-shortcut"><kbd>Ctrl+B</kbd> Bold</div>
          <div className="settings-shortcut"><kbd>Ctrl+I</kbd> Italic</div>
          <div className="settings-shortcut"><kbd>Ctrl+Shift+E</kbd> Switch between Editor and Source</div>
          <div className="settings-shortcut"><kbd>Ctrl+Shift+V</kbd> Paste as plain text</div>
          <div className="settings-shortcut"><kbd>Ctrl+Shift+D</kbd> Draft cards from the selected lines</div>
          <div className="settings-shortcut"><kbd>Ctrl+Shift+A</kbd> Ask about this paper</div>
        </div>

        </div>

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={() => { onSave(local); onClose() }}>
            <Save size={14} /> Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
