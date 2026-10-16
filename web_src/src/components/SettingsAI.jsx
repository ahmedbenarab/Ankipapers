import React, { useEffect, useState } from 'react'
import { Sparkles, KeyRound, Plug, CheckCircle2, Trash2, Loader2 } from 'lucide-react'
import { aiStatus, aiSaveKey, aiDeleteKey, aiTest } from '../aiBridge'

/**
 * Settings → AI. The key is saved on its own (straight into the macOS
 * Keychain via "Save key"), never into the add-on's config; everything else
 * here is ordinary settings, saved with the rest by "Save Settings".
 */

const PROVIDERS = [
  { id: 'anthropic', name: 'Claude', sub: 'Anthropic API key', keyLabel: 'Anthropic API key', get: 'console.anthropic.com → API keys', placeholder: 'sk-ant-…' },
  { id: 'gemini', name: 'Gemini', sub: 'Google AI Studio key', keyLabel: 'Google AI Studio key', get: 'aistudio.google.com → Get API key', placeholder: 'AIza…' },
  { id: 'openai', name: 'OpenAI-compatible', sub: 'OpenAI, OpenRouter, Ollama, LM Studio', keyLabel: 'API key (optional for a local model)', get: 'your provider’s dashboard; a local model needs none', placeholder: 'sk-… (leave empty for Ollama / LM Studio)' },
]

const LANGUAGES = ['Same as the source', 'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Arabic', 'Hindi', 'Chinese (Simplified)', 'Japanese', 'Korean']

export default function SettingsAI({ local, update, sectionRef }) {
  const [status, setStatus] = useState(null)
  const [keyInput, setKeyInput] = useState('')
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState(null) // { ok, models } | { error }
  const [saving, setSaving] = useState(false)
  const [keyMsg, setKeyMsg] = useState(null)

  const provider = local.ai_provider || 'anthropic'
  const meta = PROVIDERS.find((p) => p.id === provider)
  const modelKey = `ai_model_${provider}`
  const model = local[modelKey] ?? (provider === 'anthropic' ? 'claude-opus-5-5' : '')
  const types = { basic: true, reversible: true, cloze: true, ...(local.ai_card_types || {}) }
  const enabled = local.ai_enabled !== false
  const saved = status?.keys?.[provider]

  useEffect(() => { aiStatus().then(setStatus) }, [])

  const choose = (id) => {
    update('ai_provider', id)
    setTest(null); setKeyInput(''); setKeyMsg(null)
  }

  const saveKey = async () => {
    if (!keyInput.trim()) { setKeyMsg({ error: 'Paste a key first.' }); return }
    setSaving(true)
    const r = await aiSaveKey(provider, keyInput.trim())
    setSaving(false)
    if (r?.error) { setKeyMsg({ error: r.error }); return }
    setKeyInput('')
    setKeyMsg({ ok: r.where === 'keychain' ? 'Saved in the macOS Keychain' : 'Saved on this computer' })
    setStatus(await aiStatus())
  }

  const removeKey = async () => {
    if (!window.confirm(`Remove the saved ${meta.name} key from this computer?`)) return
    await aiDeleteKey(provider)
    setKeyMsg(null); setTest(null)
    setStatus(await aiStatus())
  }

  const runTest = async () => {
    setTesting(true); setTest(null)
    const r = await aiTest(provider, { key: keyInput.trim(), baseUrl: local.ai_base_url || '' })
    setTesting(false)
    if (r?.error) { setTest({ error: r.error }); return }
    const models = r.models || []
    setTest({ ok: true, models })
    if (!model && models.length) update(modelKey, models[0])
  }

  const models = test?.models?.length ? test.models : null

  return (
    <div className="settings-info settings-ai" ref={sectionRef}>
      <div className="settings-shortcuts-title"><Sparkles size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />AI: draft cards and Ask</div>
      <p className="settings-field-hint">
        Drafts cards from your lines or from a source, and answers questions about the open paper. Your key goes
        only to the provider you choose; Anki Papers calls it directly, with no server in between.
      </p>
      <label className="settings-toggle" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => update('ai_enabled', e.target.checked)} />
        <span className="toggle-slider" />
        <span className="toggle-text">{enabled ? 'AI features on' : 'AI features off (every AI button is hidden)'}</span>
      </label>

      {enabled && (
        <>
          <label className="settings-label">Provider</label>
          <div className="ai-providers">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" className={`ai-provider ${provider === p.id ? 'active' : ''}`} onClick={() => choose(p.id)}>
                <b>{p.name}</b>{p.sub}
              </button>
            ))}
          </div>

          {provider === 'openai' && (
            <>
              <label className="settings-label">Address</label>
              <p className="settings-field-hint">Leave empty for OpenAI. Ollama: <span className="mono">http://localhost:11434/v1</span> · LM Studio: <span className="mono">http://localhost:1234/v1</span> · OpenRouter: <span className="mono">https://openrouter.ai/api/v1</span></p>
              <input className="modal-input mono" placeholder="https://api.openai.com/v1" value={local.ai_base_url || ''}
                onChange={(e) => update('ai_base_url', e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </>
          )}

          <label className="settings-label">{meta.keyLabel}</label>
          <p className="settings-field-hint">Get one at {meta.get}. {status?.key_store === 'keychain'
            ? 'It’s stored in your macOS Keychain, not in the add-on’s settings files.'
            : 'It’s stored in this add-on’s settings on this computer.'}</p>
          <div className="ai-row">
            <input className="modal-input mono grow" style={{ margin: 0 }} type="password" autoComplete="off"
              placeholder={saved?.saved ? `Saved: ${saved.hint}  (paste a new key to replace it)` : meta.placeholder}
              value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setKeyMsg(null) }} onKeyDown={(e) => e.stopPropagation()} />
            <button type="button" className="modal-btn" disabled={saving || !keyInput.trim()} onClick={saveKey}>
              {saving ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />} Save key
            </button>
          </div>
          <div className="ai-row" style={{ marginTop: -4 }}>
            <button type="button" className="modal-btn" disabled={testing} onClick={runTest}>
              {testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />} Test connection
            </button>
            {test?.ok && <span className="ai-ok"><CheckCircle2 size={13} /> Connected · {test.models.length} models</span>}
            {test?.error && <span className="ai-bad">{test.error}</span>}
            <span className="grow" />
            {keyMsg?.ok && <span className="ai-key-saved"><KeyRound size={12} /> {keyMsg.ok}</span>}
            {keyMsg?.error && <span className="ai-bad">{keyMsg.error}</span>}
            {!keyMsg && saved?.saved && <span className="ai-key-saved"><KeyRound size={12} /> {status.key_store === 'keychain' ? 'Saved in Keychain' : 'Saved'} {saved.hint}</span>}
            {saved?.saved && <button type="button" className="icon-btn" title="Remove the saved key" onClick={removeKey}><Trash2 size={13} /></button>}
          </div>

          <label className="settings-label">Model</label>
          {models ? (
            <select className="deck-select" style={{ width: '100%', marginBottom: 12 }} value={model} onChange={(e) => update(modelKey, e.target.value)}>
              {!models.includes(model) && model && <option value={model}>{model}</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <>
              <input className="modal-input mono" value={model} placeholder={provider === 'anthropic' ? 'claude-opus-5-5' : 'Press Test connection to list models'}
                onChange={(e) => update(modelKey, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <p className="settings-field-hint" style={{ marginTop: -6 }}>Test connection fills in a list of the models your key can use.</p>
            </>
          )}

          <label className="settings-label">Card types it may write</label>
          <div className="ai-checks">
            {[['basic', 'Basic >>', 'var(--green)'], ['reversible', 'Reversible <>', 'var(--reversible)'], ['cloze', 'Cloze', 'var(--pink)']].map(([k, label, color]) => (
              <label key={k}>
                <input type="checkbox" checked={types[k] !== false} onChange={(e) => update('ai_card_types', { ...types, [k]: e.target.checked })} />
                <span style={{ color }}>{label}</span>
              </label>
            ))}
          </div>

          <label className="settings-label">Card rules</label>
          <p className="settings-field-hint">Sent with every draft. Write them the way you’d brief a colleague.</p>
          <textarea className="modal-input" rows={5} value={local.ai_card_rules ?? (status?.default_rules || '')}
            onChange={(e) => update('ai_card_rules', e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="ai-row" style={{ marginTop: -6 }}>
            <button type="button" className="modal-btn" onClick={() => update('ai_card_rules', status?.default_rules || '')}>Reset to the default rules</button>
          </div>

          <label className="settings-label">Language of cards and answers</label>
          <select className="deck-select" style={{ width: '100%', marginBottom: 12 }} value={local.ai_language || 'Same as the source'}
            onChange={(e) => update('ai_language', e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          {status?.usage && (status.usage.drafts || status.usage.chats) ? (
            <div className="ai-usage">
              This month: {status.usage.drafts || 0} drafts, {status.usage.chats || 0} questions ·{' '}
              {Math.round(((status.usage.input_tokens || 0) + (status.usage.output_tokens || 0)) / 1000).toLocaleString()}k tokens
              ({Math.round((status.usage.input_tokens || 0) / 1000).toLocaleString()}k in, {Math.round((status.usage.output_tokens || 0) / 1000).toLocaleString()}k out).
              Your provider’s dashboard shows the cost.
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
