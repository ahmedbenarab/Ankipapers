import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageCircle, X, SquarePen, ArrowUp, FileText, BookOpen, Network, Globe, ShieldCheck, Quote,
  CornerDownRight, Sparkles, Copy, Loader2, Square, Library,
} from 'lucide-react'
import { aiChat } from '../aiBridge'
import { stripApBlockId, collectLinks, outgoingFrom } from '../docLinks'
import { sourceKey } from '../sourceKeys'

/**
 * Ask: a conversation about the open paper and its sources.
 *
 * Scope chips decide what the model may read. Answers cite [line N] for the
 * paper and [S1 p. N] for a source; both become chips that jump there. An
 * answer can be inserted as an && supplement or sent through Draft cards --
 * nothing goes into Anki directly.
 */

const CITE_RE = /\[(line\s+\d+|S\d+(?:\s+p\.?\s*\d+)?)\]/gi
const GK_RE = /\(general knowledge\)/gi

function numberLines(content, max = 60000) {
  const out = []
  let total = 0
  ;(content || '').split('\n').forEach((line, i) => {
    const t = stripApBlockId(line)
    if (!t.trim()) return
    const row = `${i + 1}: ${t}`
    total += row.length + 1
    if (total <= max) out.push(row)
  })
  return out.join('\n')
}

function plainAnswer(text) {
  return (text || '').replace(CITE_RE, '').replace(GK_RE, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim()
}

// Inline: citations become chips, **bold** becomes <b>. Text nodes only.
function Inline({ text, onCite }) {
  const parts = []
  let last = 0
  const re = new RegExp(`${CITE_RE.source}|\\*\\*(.+?)\\*\\*|${GK_RE.source}`, 'gi')
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1]) {
      const label = m[1].replace(/\s+/g, ' ')
      parts.push(
        <button key={m.index} className="ask-cite" onClick={() => onCite(label)} title="Show where this comes from">
          {/^line/i.test(label) ? <CornerDownRight size={10} /> : <BookOpen size={10} />}{label}
        </button>,
      )
    } else if (m[2]) parts.push(<b key={m.index}>{m[2]}</b>)
    else parts.push(<span key={m.index} className="gk">{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function Answer({ text, onCite }) {
  const blocks = (text || '').split(/\n\s*\n/)
  return blocks.map((b, i) => {
    const lines = b.split('\n')
    if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      const ordered = /^\s*\d/.test(lines[0])
      const items = lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')} onCite={onCite} /></li>)
      return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>
    }
    return <p key={i}><Inline text={b} onCite={onCite} /></p>
  })
}

export default function AskPanel({
  paper, papers, sourcesPanelRef, sources = [], activeKey = null, seed, onClose,
  onInsertSupplement, onDraftFromAnswer, onGoToLine, onOpenSourceAt, onNotify,
}) {
  const [threads, setThreads] = useState({}) // paperId -> messages
  const [input, setInput] = useState('')
  // A passage sent from the Sources panel (seed) until it's sent or cleared.
  const [usedSeed, setUsedSeed] = useState(null)
  const quote = seed && seed.nonce !== usedSeed ? { text: seed.quote, label: seed.label } : null
  const setQuote = () => setUsedSeed(seed?.nonce ?? null)
  const [scope, setScope] = useState({ paper: true, source: true, chapter: false, linked: false })
  const [stick, setStick] = useState(true)
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const msgsRef = useRef(null)
  const inputRef = useRef(null)
  const sourceMapRef = useRef({}) // "S1" -> { entry, offset }
  const messages = useMemo(() => (paper ? threads[paper.id] || [] : []), [threads, paper])

  // A passage sent here from the Sources panel.
  const seedNonce = seed?.nonce
  useEffect(() => {
    if (seedNonce) setTimeout(() => inputRef.current?.focus(), 50)
  }, [seedNonce])

  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight }) }, [messages, streaming])

  const activeSource = sources.find((s) => sourceKey(s) === activeKey) || sources[0] || null
  const chapterEntry = sources.find((s) => s.chapter) || null
  const linkedIds = useMemo(() => {
    if (!paper) return []
    try { return [...new Set(outgoingFrom(collectLinks(papers), paper.id).filter((l) => !l.dangling).map((l) => l.targetPaperId).filter((id) => id && id !== paper.id))] }
    catch { return [] }
  }, [papers, paper])

  const buildContext = async () => {
    const blocks = []
    const map = {}
    if (scope.paper && paper) blocks.push({ label: `Open paper “${paper.title}” (numbered lines)`, text: numberLines(paper.content) })
    let n = 0
    if (scope.source && sourcesPanelRef?.current) {
      const ctx = await sourcesPanelRef.current.currentContext(false)
      if (ctx?.text) {
        n += 1
        map[`S${n}`] = { entry: ctx.source }
        blocks.push({ label: `S${n}: ${ctx.label}`, text: ctx.text.slice(0, 40000) })
      }
    }
    if (scope.chapter && sourcesPanelRef?.current) {
      const ctx = await sourcesPanelRef.current.currentContext(true)
      if (ctx?.text) {
        n += 1
        map[`S${n}`] = { entry: ctx.source }
        blocks.push({ label: `S${n}: ${ctx.source?.chapter?.title || ctx.label} (whole chapter)`, text: ctx.text.slice(0, 60000) })
      }
    }
    if (scope.linked) {
      let budget = 60000
      for (const id of linkedIds) {
        const p = papers.find((x) => x.id === id)
        if (!p || budget <= 0) continue
        const t = numberLines(p.content, Math.min(20000, budget))
        budget -= t.length
        blocks.push({ label: `Linked paper “${p.title}” (its own line numbers; cite it by name)`, text: t })
      }
    }
    sourceMapRef.current = map
    return blocks
  }

  const send = async () => {
    const q = input.trim()
    if (!q || busy || !paper) return
    const content = quote ? `About this passage from ${quote.label}:\n"${quote.text}"\n\n${q}` : q
    const pid = paper.id
    const next = [...messages, { role: 'user', content, shown: q, quote }]
    setThreads((t) => ({ ...t, [pid]: next }))
    setInput(''); setQuote(null); setError(null); setBusy(true); setStreaming('')
    const ctl = new AbortController()
    abortRef.current = ctl
    const context = await buildContext()
    const res = await aiChat({ messages: next.map((m) => ({ role: m.role, content: m.content })), context, stick },
      { signal: ctl.signal, onText: setStreaming })
    setBusy(false); setStreaming('')
    if (res.canceled) return
    if (res.error) { setError(res.error); return }
    setThreads((t) => ({ ...t, [pid]: [...(t[pid] || []), { role: 'assistant', content: res.text, sources: sourceMapRef.current }] }))
  }

  const cite = (label, srcMap) => {
    const m = label.match(/^line\s+(\d+)/i)
    if (m) { onGoToLine(Number(m[1]) - 1); return }
    const s = label.match(/^(S\d+)(?:\s+p\.?\s*(\d+))?/i)
    const hit = s && (srcMap || sourceMapRef.current)[s[1].toUpperCase()]
    if (!hit?.entry) { onNotify?.('That source isn’t open any more.'); return }
    const printed = s[2] ? Number(s[2]) : null
    const page = printed != null && hit.entry.source.kind === 'pdf' ? printed + (hit.entry.page_offset || 0) : printed
    onOpenSourceAt(hit.entry, page)
  }

  const copy = (text) => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); onNotify?.('Copied') } catch { /* ignore */ }
    ta.remove()
  }

  const firstLine = (text) => { const m = (text || '').match(/\[line\s+(\d+)\]/i); return m ? Number(m[1]) - 1 : null }

  const chip = (key, icon, label, title) => (
    <button className={`ask-chip ${scope[key] ? 'active' : ''}`} title={title}
      onClick={() => setScope((s) => ({ ...s, [key]: !s[key] }))}>{icon}{label}</button>
  )
  const srcLabel = activeSource
    ? (activeSource.chapter ? activeSource.chapter.title : activeSource.source.title)
    : null

  return (
    <div className="ask-panel">
      <div className="ask-head">
        <MessageCircle size={15} /><span className="grow">Ask</span>
        <button className="icon-btn" title="New conversation" onClick={() => { if (paper) setThreads((t) => ({ ...t, [paper.id]: [] })); setError(null) }}><SquarePen size={15} /></button>
        <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="ask-scope">
        {chip('paper', <FileText size={12} />, 'This paper', 'Send the open paper, with line numbers')}
        {activeSource && chip('source', <BookOpen size={12} />, srcLabel.length > 28 ? srcLabel.slice(0, 27) + '…' : srcLabel, 'Send the page open in the Sources panel')}
        {(chapterEntry || activeSource) && chip('chapter', <Library size={12} />, chapterEntry ? 'Whole chapter' : 'Whole source', 'Send all of the chapter or source open in the Sources panel (slower, more tokens)')}
        {linkedIds.length > 0 && chip('linked', <Network size={12} />, `Linked papers (${linkedIds.length})`, 'Send the papers this one links to')}
        <button className={`ask-chip ${!stick ? 'active' : ''}`} title="Allow answers from general knowledge"
          onClick={() => setStick((v) => !v)}><Globe size={12} />General</button>
      </div>
      <div className="ask-msgs" ref={msgsRef}>
        {!messages.length && !busy && (
          <div className="ask-empty">
            Ask about “{paper?.title}”{activeSource ? ` and ${srcLabel}` : ''}. Answers point to the line or page they come from,
            and any answer can become an && note or card drafts.
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user' ? (
          <div key={i} className="ask-me">
            {m.quote && <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 4 }}><Quote size={10} /> {m.quote.text.slice(0, 120)}{m.quote.text.length > 120 ? '…' : ''}</div>}
            {m.shown || m.content}
          </div>
        ) : (
          <div key={i} className="ask-bot">
            <Answer text={m.content} onCite={(l) => cite(l, m.sources)} />
            <div className="ask-acts">
              <button onClick={() => onInsertSupplement(plainAnswer(m.content), firstLine(m.content))} title="Insert under the line it cites, or the line you're on">
                <CornerDownRight size={13} /> Insert as &amp;&amp; supplement
              </button>
              <button className="ai" onClick={() => onDraftFromAnswer(plainAnswer(m.content), firstLine(m.content))}><Sparkles size={13} /> Draft cards from this</button>
              <button onClick={() => copy(plainAnswer(m.content))} title="Copy"><Copy size={13} /></button>
            </div>
          </div>
        )))}
        {busy && (
          <div className="ask-bot">
            {streaming ? <Answer text={streaming} onCite={() => {}} /> : <span style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="spin" /> Reading…</span>}
          </div>
        )}
        {error && <div className="ask-error">{error}</div>}
      </div>
      <div className="ask-compose">
        <div className="ask-box">
          <textarea ref={inputRef} rows={2} placeholder={activeSource ? `Ask about this paper or ${srcLabel}…` : 'Ask about this paper…'}
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <div className="row">
            {quote ? (
              <span className="grow" title={quote.text}><Quote size={11} /> {quote.label}: “{quote.text.slice(0, 60)}{quote.text.length > 60 ? '…' : ''}”
                <button className="icon-btn" style={{ display: 'inline-flex', padding: 0, marginLeft: 4 }} onClick={() => setQuote(null)}><X size={11} /></button></span>
            ) : <span className="grow" />}
            <button className={`ask-chip ${stick ? 'active' : ''}`} style={{ fontSize: 11 }} onClick={() => setStick((v) => !v)}
              title="Answer only from what's sent; say so when it isn't covered"><ShieldCheck size={11} />Stick to my sources</button>
            {busy
              ? <button className="ask-send" title="Stop" onClick={() => abortRef.current?.abort()}><Square size={14} /></button>
              : <button className="ask-send" title="Send (Enter)" disabled={!input.trim()} onClick={send}><ArrowUp size={14} /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}
