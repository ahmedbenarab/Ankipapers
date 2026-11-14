import React, { useEffect, useState } from 'react'
import { Sparkles, KeyRound, Plug, CheckCircle2, Trash2, Loader2 } from 'lucide-react'
import { aiStatus, aiSaveKey, aiDeleteKey, aiTest } from '../aiBridge'

/**
 * Settings → AI. The key is saved on its own (straight into the macOS
 * Keychain via "Save key"), never into the add-on's config; everything else
 * here is ordinary settings, saved with the rest by "Save Settings".
 */

const PROVIDERS = [
  { id: 'anthropic', name: 'Claude', sub: 'Anthropic API key', keyLabel: 'Anthropic API key', get: 'console.anthropic.com → API keys', placeholder: 'sk-ant-…', defaultModel: 'claude-opus-5-5' },
  { id: 'gemini', name: 'Gemini', sub: 'Google AI Studio key', keyLabel: 'Google AI Studio key', get: 'aistudio.google.com → Get API key', placeholder: 'AIza…', defaultModel: 'gemini-3.8-flash' },
  { id: 'deepseek', name: 'DeepSeek', sub: 'DeepSeek API key', keyLabel: 'DeepSeek API key', get: 'platform.deepseek.com → API keys', placeholder: 'sk-…', defaultModel: 'deepseek-chat' },
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
  const model = local[modelKey] ?? (meta.defaultModel || '')
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

  // Feynman: Gemini or an OpenAI-compatible server, apart from the provider
  // above. One model transcribes and grades. Each uses that provider's key
  // slot (shared with the Provider card of the same name above).
  const transcribe = local.feynman_provider || 'gemini'
  const tName = transcribe === 'openai' ? 'OpenAI-compatible' : 'Google AI Studio'
  const T_PROVIDERS = [
    { id: 'gemini', name: 'Gemini', sub: 'Google AI Studio key', defaultModel: 'gemini-3.8-flash', placeholder: 'AIza…' },
    { id: 'openai', name: 'OpenAI-compatible', sub: 'An audio chat model, e.g. gpt-audio-1.5', defaultModel: 'gpt-audio-1.5', placeholder: 'sk-…' },
  ]
  const tMeta = T_PROVIDERS.find((p) => p.id === transcribe)
  const tModelKey = `feynman_model_${transcribe}`
  const tSaved = status?.keys?.[transcribe]
  const [tKey, setTKey] = useState('')
  const [tMsg, setTMsg] = useState(null)
  const [tSaving, setTSaving] = useState(false)
  const [tTesting, setTTesting] = useState(false)
  const [tTest, setTTest] = useState(null) // { ok } | { error }
  const saveTKey = async () => {
    if (!tKey.trim()) { setTMsg({ error: 'Paste a key first.' }); return }
    setTSaving(true)
    const r = await aiSaveKey(transcribe, tKey.trim())
    setTSaving(false)
    if (r?.error) { setTMsg({ error: r.error }); return }
    setTKey(''); setTTest(null)
    setTMsg({ ok: r.where === 'keychain' ? 'Saved in the macOS Keychain' : 'Saved on this computer' })
    setStatus(await aiStatus())
  }
  // The same key slot as the provider of that name above: removing it here
  // removes it there too.
  const removeTKey = async () => {
    const shared = provider === transcribe ? ` It’s also the key ${meta.name} uses for drafting and Ask.` : ''
    if (!window.confirm(`Remove the saved ${tName} key from this computer?${shared}`)) return
    await aiDeleteKey(transcribe)
    setTMsg(null); setTTest(null)
    setStatus(await aiStatus())
  }
  // Checks the typed key, or the saved one, against the provider itself
  // (for OpenAI-compatible, at the Feynman address below, not the chat
  // address above).
  const runTTest = async () => {
    setTTesting(true); setTTest(null)
    const r = await aiTest(transcribe, { key: tKey.trim(), baseUrl: transcribe === 'openai' ? (local.feynman_base_url || '') : '' })
    setTTesting(false)
    setTTest(r?.error ? { error: r.error } : { ok: true })
  }

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

          {provider === 'deepseek' && (
            <p className="settings-field-hint"><span className="mono">deepseek-chat</span> is fast and cheap for drafting cards; <span className="mono">deepseek-reasoner</span> thinks before it answers, which is slower and costs more.</p>
          )}

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
            : 'It’s stored in your Anki profile folder on this computer, apart from the add-on’s settings.'}</p>
          <div className="ai-row">
            <input className="modal-input mono grow" style={{ margin: 0 }} type="password" autoComplete="off"
              placeholder={saved?.saved ? `Saved: ${saved.hint}  (paste a new key to replace it)` : meta.placeholder}
              value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setKeyMsg(null) }} onKeyDown={(e) => e.stopPropagation()} />
            <button type="button" className="modal-btn" disabled={saving || !keyInput.trim()} onClick={saveKey}>
              {saving ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />} Save key
            </button>
          </div>
          {keyInput.trim() && !keyMsg && (
            <p className="settings-field-hint ai-unsaved">Not saved yet: press Save key. Save Settings doesn’t save keys.</p>
          )}
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
              <input className="modal-input mono" value={model} placeholder={meta.defaultModel || 'Press Test connection to list models'}
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

          <hr className="settings-ai-rule" />
          <div className="settings-shortcuts-title"><Sparkles size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />AI: Feynman</div>
          <p className="settings-field-hint">
            Pick a heading, explain it out loud, and see how many of its answers you described: the backs of basic
            cards, each reversible pair, each cloze deletion and each list item. It’s graded only against what your
            paper says.
          </p>
          <p className="settings-field-hint ai-unsaved">The microphone hasn’t been tested on Windows yet.</p>

          <label className="settings-label">Set it up with Gemini</label>
          <ol className="feynman-steps">
            <li>Go to <span className="mono">aistudio.google.com</span> and sign in.</li>
            <li>Click <b>Get API key</b>, then <b>Create API key</b>, and copy it.</li>
            <li>Under <b>Provider</b> below, click <b>Gemini</b>.</li>
            <li>Paste the key into <b>Google AI Studio key</b> below and press <b>Save key</b>.</li>
            <li>Press <b>Test connection</b>.</li>
            <li>Leave <b>Model</b> below empty to use <span className="mono">gemini-3.8-flash</span>.</li>
            <li>Turn on <b>Feynman panel</b> below.</li>
            <li>Press <b>Save Settings</b>.</li>
            <li>Open a paper and click <b>F</b> in the toolbar.</li>
            <li>Record once. On a Mac, click <b>Allow</b> when it asks for the microphone.</li>
            <li>If every recording is silent: open System Settings → Privacy &amp; Security → Microphone, turn on <b>Anki</b>, then quit and reopen Anki.</li>
          </ol>

          <label className="settings-label">Feynman panel</label>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.feynman_enabled === true} onChange={(e) => update('feynman_enabled', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.feynman_enabled === true ? 'F in the toolbar' : 'Hidden'}</span>
          </label>
          <label className="settings-label">Last score next to headings</label>
          <p className="settings-field-hint">Hover the score to see when it was recorded. The date and score stay saved in the paper either way.</p>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.feynman_show_scores !== false} onChange={(e) => update('feynman_show_scores', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.feynman_show_scores !== false ? 'Shown' : 'Hidden'}</span>
          </label>

          <label className="settings-label">Provider</label>
          <p className="settings-field-hint">
            One model hears your recording and grades it, so it has to understand audio. Claude and DeepSeek can’t,
            so Feynman uses one of these, apart from the provider for drafting and Ask above.
          </p>
          <div className="ai-providers">
            {T_PROVIDERS.map((p) => (
              <button key={p.id} type="button" className={`ai-provider ${transcribe === p.id ? 'active' : ''}`}
                onClick={() => { update('feynman_provider', p.id); setTKey(''); setTMsg(null); setTTest(null) }}>
                <b>{p.name}</b>{p.sub}
              </button>
            ))}
          </div>

          {transcribe === 'openai' && (
            <>
              <label className="settings-label">Address</label>
              <p className="settings-field-hint">Leave empty for OpenAI. Another server works if its chat API accepts audio.</p>
              <input className="modal-input mono" placeholder="https://api.openai.com/v1" value={local.feynman_base_url || ''}
                onChange={(e) => update('feynman_base_url', e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </>
          )}

          <label className="settings-label">{transcribe === 'openai' ? 'API key' : 'Google AI Studio key'}</label>
          <p className="settings-field-hint">
            {transcribe === 'openai'
              ? 'The same key as OpenAI-compatible in Provider above. A local server may need none.'
              : 'The same key as Gemini in Provider above.'}
          </p>
          <div className="ai-row">
            <input className="modal-input mono grow" style={{ margin: 0 }} type="password" autoComplete="off"
              placeholder={tSaved?.saved ? `Saved: ${tSaved.hint}  (paste a new key to replace it)` : tMeta.placeholder}
              value={tKey} onChange={(e) => { setTKey(e.target.value); setTMsg(null) }} onKeyDown={(e) => e.stopPropagation()} />
            <button type="button" className="modal-btn" disabled={tSaving || !tKey.trim()} onClick={saveTKey}>
              {tSaving ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />} Save key
            </button>
          </div>
          {tKey.trim() && !tMsg && (
            <p className="settings-field-hint ai-unsaved">Not saved yet: press Save key. Save Settings doesn’t save keys.</p>
          )}
          {!tKey.trim() && !tSaved?.saved && !tMsg && (
            <p className="settings-field-hint ai-unsaved">No {tName} key saved yet. Paste one to use Feynman.</p>
          )}
          <div className="ai-row" style={{ marginTop: -4 }}>
            <button type="button" className="modal-btn" disabled={tTesting} onClick={runTTest}>
              {tTesting ? <Loader2 size={13} className="spin" /> : <Plug size={13} />} Test connection
            </button>
            {tTest?.ok && <span className="ai-ok"><CheckCircle2 size={13} /> Connected</span>}
            {tTest?.error && <span className="ai-bad">{tTest.error}</span>}
            <span className="grow" />
            {tMsg?.ok && <span className="ai-key-saved"><KeyRound size={12} /> {tMsg.ok}</span>}
            {tMsg?.error && <span className="ai-bad">{tMsg.error}</span>}
            {!tMsg && tSaved?.saved && <span className="ai-key-saved"><KeyRound size={12} /> {status.key_store === 'keychain' ? 'Saved in Keychain' : 'Saved'} {tSaved.hint}</span>}
            {tSaved?.saved && <button type="button" className="icon-btn" title={`Remove the saved ${tName} key`} onClick={removeTKey}><Trash2 size={13} /></button>}
          </div>

          <label className="settings-label">Model</label>
          <p className="settings-field-hint">
            Transcribes your recording, then grades the transcript against your paper. Empty uses <span className="mono">{tMeta.defaultModel}</span>.
          </p>
          <input className="modal-input mono" value={local[tModelKey] ?? ''} placeholder={tMeta.defaultModel}
            onChange={(e) => update(tModelKey, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />

          <label className="settings-label">Grading prompt</label>
          <p className="settings-field-hint">
            Sent with every Feynman grade, followed by the numbered answers and your transcript. The reply format the
            app needs is added after it, so editing this can’t break the scoring.
          </p>
          <textarea className="modal-input" rows={12} value={local.feynman_grading_rules ?? (status?.feynman_default_rules || '')}
            onChange={(e) => update('feynman_grading_rules', e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="ai-row" style={{ marginTop: -6 }}>
            <button type="button" className="modal-btn" onClick={() => update('feynman_grading_rules', status?.feynman_default_rules || '')}>Reset to the default prompt</button>
          </div>

          {status?.usage && (status.usage.drafts || status.usage.chats || status.usage.feynman) ? (
            <div className="ai-usage">
              This month: {status.usage.drafts || 0} drafts, {status.usage.chats || 0} questions{status.usage.feynman ? `, ${status.usage.feynman} Feynman grades` : ''} ·{' '}
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
