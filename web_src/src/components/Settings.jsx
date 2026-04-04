import React, { useState } from 'react'
import { Settings as SettingsIcon, Save, Sun, Moon } from 'lucide-react'

export default function Settings({ settings, onSave, onClose }) {
  const [local, setLocal] = useState({ ...settings })
  const update = (key, value) => setLocal(prev => ({ ...prev, [key]: value }))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title"><SettingsIcon size={18} /> Settings</div>

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

          <label className="settings-label">Show Card Indicators</label>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.show_card_indicators !== false}
              onChange={e => update('show_card_indicators', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.show_card_indicators !== false ? 'Enabled' : 'Disabled'}</span>
          </label>

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

        <div className="settings-info">
          <div className="settings-shortcuts-title">Keyboard Shortcuts</div>
          <div className="settings-shortcut"><kbd>Ctrl+S</kbd> Save</div>
          <div className="settings-shortcut"><kbd>Ctrl+G</kbd> Generate Cards</div>
          <div className="settings-shortcut"><kbd>Ctrl+B</kbd> Bold</div>
          <div className="settings-shortcut"><kbd>Ctrl+I</kbd> Italic</div>
          <div className="settings-shortcut"><kbd>Ctrl+Shift+V</kbd> Toggle View</div>
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
