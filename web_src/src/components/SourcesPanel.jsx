import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Paperclip, X, Plus, BookOpen, Globe, FileText, Presentation, FileType, ChevronLeft, ChevronRight,
  ExternalLink, RefreshCw, Sparkles, MessageCircle, Loader2, Trash2, FilePlus,
} from 'lucide-react'
import { getPdfViewerUrl, getPdfUrl, openUrl } from '../bridge'
import { srcFileUrl, srcPages, srcWebUnits, srcWebPage } from '../aiBridge'
import { sourceKey } from '../sourceKeys'

/**
 * The Sources panel: everything attached to the open paper, plus what the
 * folders above it carry. A folder book or course opens at this paper's own
 * chapter; a paper that isn't one of its chapters gets a contents page.
 *
 * Selecting text in a source offers Add to notes, Draft cards and Ask.
 */


const KIND_ICON = { pdf: BookOpen, web: Globe, docx: FileType, pptx: Presentation, html: Globe, text: FileText }

function lastSegment(path) { return (path || '').split('/').filter(Boolean).pop() || path }

function tabLabel(s) {
  if (s.chapter) {
    const n = (s.neighbors?.index ?? s.chapter_index ?? 0) + 1
    return `${s.source.kind === 'pdf' ? 'Ch.' : 'Module'} ${n} · ${s.chapter.title}`
  }
  return s.source.title || s.source.original_name || 'Source'
}

// ─── PDF ──────────────────────────────────────────────────────────────

let viewerUrlPromise = null
function viewerUrl() {
  if (!viewerUrlPromise) viewerUrlPromise = getPdfViewerUrl().then((r) => r?.url || null)
  return viewerUrlPromise
}

function PdfView({ entry, jump, onSelection, apiRef }) {
  const iframeRef = useRef(null)
  const [vurl, setVurl] = useState(null)
  const [fileUrl, setFileUrl] = useState(null)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const pending = useRef({})
  const ch = entry.chapter
  const offset = entry.page_offset || 0
  const start = ch?.start || null
  const end = ch?.end || null

  useEffect(() => {
    let cancel = false
    viewerUrl().then((u) => { if (!cancel) setVurl(u) })
    const get = entry.legacyPath ? getPdfUrl(entry.legacyPath) : srcFileUrl(entry.source.id)
    get.then((r) => { if (cancel) return; if (r?.url) setFileUrl(r.url); else setError(r?.error || 'Couldn’t open this PDF.') })
    return () => { cancel = true }
  }, [entry.source.id, entry.legacyPath])

  const post = useCallback((msg) => {
    iframeRef.current?.contentWindow?.postMessage({ source: 'ankipapers', ...msg }, '*')
  }, [])

  const load = useCallback((extra = {}) => {
    if (!fileUrl) return
    setLoaded(false)
    post({ cmd: 'load', url: fileUrl, start, end, ...extra })
  }, [fileUrl, start, end, post])

  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data
      if (!d || d.source !== 'pdf-viewer' || e.source !== iframeRef.current?.contentWindow) return
      if (d.type === 'loaded') { setLoaded(true); setPage(d.start || 1) }
      if (d.type === 'page') setPage(d.page)
      if (d.type === 'selection') {
        if (!d.text) { onSelection(null); return }
        const box = iframeRef.current.getBoundingClientRect()
        onSelection({ text: d.text, page: d.page, kind: 'pdf',
          rect: d.rect ? { top: d.rect.top + box.top, left: d.rect.left + box.left, bottom: d.rect.bottom + box.top } : null })
      }
      if (d.type === 'text' && pending.current[d.id]) { pending.current[d.id](d.text); delete pending.current[d.id] }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onSelection])

  // Initial load, and jumps to a page / quote ("Go to source", a citation).
  const jumpKey = jump ? `${jump.nonce}` : ''
  useEffect(() => {
    if (!vurl || !fileUrl) return
    const t = setTimeout(() => load(jump ? { page: jump.page, quote: jump.quote } : {}), 250)
    return () => clearTimeout(t)
  }, [vurl, fileUrl, jumpKey, load, jump])

  useImperativeHandle(apiRef, () => ({
    label: () => (page ? `${entry.source.title}, p. ${page - offset}` : entry.source.title),
    // The page in view and the one after it, as plain text.
    text: () => new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      pending.current[id] = resolve
      const p = page || start || 1
      post({ cmd: 'getText', id, from: p, to: Math.min(p + 1, end || p + 1) })
      setTimeout(() => { if (pending.current[id]) { delete pending.current[id]; resolve('') } }, 6000)
    }),
    chapterText: () => new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      pending.current[id] = resolve
      post({ cmd: 'getText', id, from: start || page || 1, to: end || (page || 1) + 1 })
      setTimeout(() => { if (pending.current[id]) { delete pending.current[id]; resolve('') } }, 15000)
    }),
    page: () => page,
  }), [page, offset, start, end, entry.source.title, post])

  if (error) return <div className="sources-empty">{error}</div>
  const printed = page != null ? page - offset : null
  return (
    <>
      <div className="sources-bar">
        <FileText size={13} />
        <span className="grow">
          {printed != null ? `Page ${printed}` : 'Loading…'}
          {ch && start ? <span style={{ color: 'var(--text-muted)' }}> · chapter pages {start - offset}–{(end || start) - offset}</span> : null}
        </span>
        <button className="icon-btn" title="Previous page" disabled={!page || page <= (start || 1)}
          onClick={() => post({ cmd: 'goToPage', page: page - 1 })}><ChevronLeft size={15} /></button>
        <button className="icon-btn" title="Next page" disabled={!page || (end && page >= end)}
          onClick={() => post({ cmd: 'goToPage', page: page + 1 })}><ChevronRight size={15} /></button>
      </div>
      <div className="sources-body">
        {vurl && <iframe ref={iframeRef} src={vurl} title="PDF" onLoad={() => load()} />}
        {!loaded && <div className="fs-loading" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><Loader2 size={16} className="spin" /> Opening…</div>}
      </div>
    </>
  )
}

// ─── Selection inside a reader page ───────────────────────────────────

// onMouseUp handler for a reader's scroll box: report the selected text.
function useReaderSelection(scrollRef, onSelection, meta) {
  return useCallback(() => setTimeout(() => {
    const el = scrollRef.current
    const sel = window.getSelection()
    const text = (sel ? sel.toString() : '').trim()
    if (!el || !text || !sel.rangeCount || !el.contains(sel.anchorNode)) { onSelection(null); return }
    const r = sel.getRangeAt(0).getBoundingClientRect()
    onSelection({ text, ...meta(), rect: { top: r.top, left: r.left, bottom: r.bottom } })
  }, 10), [scrollRef, onSelection, meta])
}

function onReaderClick(e) {
  const a = e.target.closest?.('.rd-link')
  if (a?.dataset.href) { e.preventDefault(); openUrl(a.dataset.href) }
}

function highlightQuote(root, quote) {
  if (!root || !quote) return
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const q = norm(quote).slice(0, 80)
  if (q.length < 6) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const t = norm(node.textContent)
    const at = t.indexOf(q.slice(0, 30))
    if (at >= 0) {
      const el = node.parentElement
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.style.transition = 'background .3s'
      el.style.background = 'rgba(75,156,211,.35)'
      setTimeout(() => { el.style.background = '' }, 2400)
      return
    }
  }
}

// ─── Word / PowerPoint / HTML / text ──────────────────────────────────

function ReaderView({ entry, jump, onSelection, apiRef }) {
  const [pages, setPages] = useState(null)
  const [error, setError] = useState(null)
  const [current, setCurrent] = useState(0)
  const scrollRef = useRef(null)
  const isSlides = entry.source.kind === 'pptx'

  useEffect(() => {
    let cancel = false
    srcPages(entry.source.id).then((r) => {
      if (cancel) return
      if (r?.pages) setPages(r.pages); else setError(r?.error || 'Couldn’t read this file.')
    })
    return () => { cancel = true }
  }, [entry.source.id])

  useEffect(() => {
    if (!pages || !jump) return
    const target = jump.page ? scrollRef.current?.querySelector(`[data-page="${jump.page}"]`) : null
    if (target) target.scrollIntoView({ block: 'start' })
    if (jump.quote) setTimeout(() => highlightQuote(scrollRef.current, jump.quote), 120)
  }, [pages, jump])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !isSlides) return
    const kids = [...el.querySelectorAll('[data-page]')]
    const top = el.scrollTop + 30
    const i = kids.findIndex((k) => k.offsetTop + k.offsetHeight > top)
    if (i >= 0 && i !== current) setCurrent(i)
  }

  const meta = useCallback(() => {
    const sel = window.getSelection()
    const node = sel?.anchorNode?.parentElement?.closest?.('[data-page]')
    const p = node ? Number(node.dataset.page) : (isSlides ? current + 1 : null)
    return { kind: entry.source.kind, page: isSlides ? p : null }
  }, [entry.source.kind, isSlides, current])
  const onMouseUp = useReaderSelection(scrollRef, onSelection, meta)

  useImperativeHandle(apiRef, () => ({
    label: () => (isSlides ? `${entry.source.title}, slide ${current + 1}` : entry.source.title),
    text: async () => {
      if (!pages) return ''
      if (isSlides) return pages.slice(current, current + 2).map((p, i) => `[Slide ${current + i + 1}] ${p.text}`).join('\n\n')
      return pages.map((p) => p.text).join('\n\n').slice(0, 30000)
    },
    chapterText: async () => (pages || []).map((p, i) => (isSlides ? `[Slide ${i + 1}] ` : '') + p.text).join('\n\n').slice(0, 60000),
    page: () => (isSlides ? current + 1 : null),
  }), [pages, current, isSlides, entry.source.title])

  if (error) return <div className="sources-empty">{error}</div>
  if (!pages) return <div className="fs-loading"><Loader2 size={16} className="spin" /> Reading…</div>
  return (
    <>
      {isSlides && (
        <div className="sources-bar">
          <Presentation size={13} />
          <span className="grow">Slide {current + 1} of {pages.length}</span>
          <button className="icon-btn" title="Previous slide" disabled={current <= 0}
            onClick={() => scrollRef.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: 'start' })}><ChevronLeft size={15} /></button>
          <button className="icon-btn" title="Next slide" disabled={current >= pages.length - 1}
            onClick={() => scrollRef.current?.querySelector(`[data-page="${current + 2}"]`)?.scrollIntoView({ block: 'start' })}><ChevronRight size={15} /></button>
        </div>
      )}
      <div className="sources-body">
        <div className="reader-scroll" ref={scrollRef} onScroll={onScroll} onClick={onReaderClick} onMouseUp={onMouseUp}>
          {pages.map((p, i) => (
            <div key={i} data-page={i + 1} className={`reader-page ${isSlides ? 'slide' : ''}`}
              // Built by core/sources.py from a whitelist of tags with escaped text.
              dangerouslySetInnerHTML={{ __html: p.html || '<p><i>Empty</i></p>' }} />
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Web pages and courses ────────────────────────────────────────────

function WebView({ entry, jump, onSelection, apiRef }) {
  const chapter = entry.chapter
  const [fetchedUnits, setFetchedUnits] = useState(null)
  const [unitIdx, setUnitIdx] = useState(0)
  const [page, setPage] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  const baseUrl = chapter?.url || entry.source.url

  const chapterUrl = chapter?.url || null
  const jumpUrl = jump?.url || null
  const units = useMemo(() => (chapterUrl ? fetchedUnits : [{ title: entry.source.title, url: entry.source.url }]),
    [chapterUrl, fetchedUnits, entry.source.title, entry.source.url])
  useEffect(() => {
    let cancel = false
    if (!chapterUrl) return
    srcWebUnits(entry.source.id, chapterUrl).then((r) => {
      if (cancel) return
      if (r?.units?.length) {
        setFetchedUnits(r.units)
        const want = jumpUrl ? r.units.findIndex((u) => u.url === jumpUrl) : -1
        setUnitIdx(want >= 0 ? want : 0)
      } else setError(r?.error || 'Couldn’t load this chapter.')
    })
    return () => { cancel = true }
  }, [entry.source.id, chapterUrl, entry.source.url, entry.source.title, jumpUrl])

  const unit = units?.[unitIdx]
  const loadPage = useCallback((refresh = false) => {
    if (!unit) return
    setBusy(true); setError(null)
    srcWebPage(entry.source.id, unit.url, refresh).then((r) => {
      setBusy(false)
      if (r?.html !== undefined) setPage(r); else setError(r?.error || 'Couldn’t load this page.')
    })
  }, [entry.source.id, unit])
  const unitUrl = unit?.url || null
  useEffect(() => {
    if (!unitUrl) return
    let cancel = false
    srcWebPage(entry.source.id, unitUrl).then((r) => {
      if (cancel) return
      if (r?.html !== undefined) { setPage(r); setError(null) } else setError(r?.error || 'Couldn’t load this page.')
    })
    return () => { cancel = true }
  }, [entry.source.id, unitUrl])
  useEffect(() => {
    if (page && jump?.quote) setTimeout(() => highlightQuote(scrollRef.current, jump.quote), 120)
    else if (page) scrollRef.current?.scrollTo({ top: 0 })
  }, [page, jump])

  const meta = useCallback(() => ({ kind: 'web', url: unit?.url || baseUrl, unit: unit?.title }), [unit, baseUrl])
  const onMouseUp = useReaderSelection(scrollRef, onSelection, meta)

  useImperativeHandle(apiRef, () => ({
    label: () => (unit && chapter ? `${chapter.title} › ${unit.title}` : entry.source.title),
    text: async () => page?.text || '',
    chapterText: async () => {
      if (!units) return page?.text || ''
      const texts = []
      for (const u of units.slice(0, 14)) {
        const r = await srcWebPage(entry.source.id, u.url)
        if (r?.text) texts.push(`[${u.title}]\n${r.text}`)
      }
      return texts.join('\n\n').slice(0, 60000)
    },
    page: () => null,
    url: () => unit?.url || baseUrl,
  }), [page, unit, units, chapter, entry.source.title, entry.source.id, baseUrl])

  return (
    <>
      <div className="sources-bar">
        {units && units.length > 1 ? (
          <select value={unitIdx} onChange={(e) => setUnitIdx(Number(e.target.value))} title="Pages in this chapter">
            {units.map((u, i) => <option key={u.url} value={i}>{`Unit ${i + 1} of ${units.length} · ${u.title}`}</option>)}
          </select>
        ) : (
          <span className="grow">{page?.title || entry.source.title}</span>
        )}
        {units && units.length > 1 && <span className="grow" />}
        {units && units.length > 1 && (
          <>
            <button className="icon-btn" title="Previous" disabled={unitIdx <= 0} onClick={() => setUnitIdx(unitIdx - 1)}><ChevronLeft size={15} /></button>
            <button className="icon-btn" title="Next" disabled={unitIdx >= units.length - 1} onClick={() => setUnitIdx(unitIdx + 1)}><ChevronRight size={15} /></button>
          </>
        )}
        <button className="icon-btn" title={entry.source.keep === 'live' ? 'Reload' : 'Refresh the saved copy'} disabled={busy} onClick={() => loadPage(true)}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
        </button>
        <button className="icon-btn" title="Open in your browser" onClick={() => openUrl(unit?.url || baseUrl)}><ExternalLink size={14} /></button>
      </div>
      <div className="sources-body">
        {error ? <div className="sources-empty">{error}</div> : (!page || page.url !== unit?.url) ? (
          <div className="fs-loading"><Loader2 size={16} className="spin" /> Loading…</div>
        ) : (
          <div className="reader-scroll" ref={scrollRef} onClick={onReaderClick} onMouseUp={onMouseUp}>
            <div className="reader-page">
              <div className="reader-kicker">
                {(() => { try { return new URL(page.url).hostname } catch { return '' } })()}
                {page.fetched_at ? ` · saved ${new Date(page.fetched_at * 1000).toLocaleDateString()}` : ''}
              </div>
              <div dangerouslySetInnerHTML={{ __html: page.html || '<p><i>This page has no readable text.</i></p>' }} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Contents of a folder source, seen from a paper that isn't a chapter ──

function ContentsView({ entry, onOpenPaper, onCreateChapterPaper, onReadWhole }) {
  const chapters = entry.chapters || []
  const rows = chapters.map((c, i) => ({ c, n: i + 1, head: c.group && c.group !== chapters[i - 1]?.group ? c.group : null }))
  return (
    <div className="sources-body">
      <div className="reader-scroll">
        <div className="reader-page">
          <div className="reader-kicker">
            Attached to the folder {lastSegment(entry.folder)} · {chapters.length} {entry.source.kind === 'pdf' ? 'chapters' : 'modules'}
          </div>
          <h2 style={{ marginTop: 2 }}>{entry.source.title}</h2>
          {entry.source.kind === 'pdf' && (
            <p><button className="sources-btn" onClick={onReadWhole}><BookOpen size={13} /> Read the whole book</button></p>
          )}
          {rows.map(({ c, n, head }) => {
            return (
              <React.Fragment key={c.key}>
                {head && <div className="contents-group">{head}</div>}
                <div className="contents-row" onClick={() => (c.paper_id ? onOpenPaper(c.paper_id) : onCreateChapterPaper(entry, c))}>
                  <span className="n">{n}</span>
                  <div style={{ flex: 1 }}>
                    <div className="t">{c.title}</div>
                    <div className="p">
                      {c.paper_id ? <><FileText size={12} /> {c.paper_title || 'Paper'}</> : <><FilePlus size={12} /> No paper yet · <u>create it</u></>}
                      {c.start ? <span style={{ marginLeft: 6 }}>· pp. {c.start - (entry.page_offset || 0)}–{(c.end || c.start) - (entry.page_offset || 0)}</span> : null}
                    </div>
                  </div>
                  <ChevronRight size={15} color="#8a9ab5" />
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────

const SourcesPanel = forwardRef(function SourcesPanel({
  paper, sources, loading, activeKey, onSelectKey, jump, aiEnabled = true,
  onAttachFile, onAttachWeb, onDetach, onRemoveSource, onClose, onAction, onOpenPaper, onCreateChapterPaper,
}, ref) {
  const [menu, setMenu] = useState(false)
  const [webUrl, setWebUrl] = useState('')
  const [webBusy, setWebBusy] = useState(false)
  const [webError, setWebError] = useState(null)
  const [sel, setSel] = useState(null)
  const [wholeBook, setWholeBook] = useState({})
  const panelRef = useRef(null)
  const viewApi = useRef(null)

  const list = useMemo(() => sources || [], [sources])
  const active = list.find((s) => sourceKey(s) === activeKey) || list[0] || null
  const activeK = active ? sourceKey(active) : null

  useImperativeHandle(ref, () => ({
    // For Ask: the label and text of what's open in the panel.
    currentContext: async (whole = false) => {
      if (!active || !viewApi.current) return null
      const text = whole ? await viewApi.current.chapterText?.() : await viewApi.current.text?.()
      return text ? { label: viewApi.current.label?.() || active.source.title, text, source: active } : null
    },
    active: () => active,
  }), [active])

  const onSelection = useCallback((s) => {
    if (!s) { setSel(null); return }
    const box = panelRef.current?.getBoundingClientRect()
    const top = s.rect && box ? Math.max(70, s.rect.top - box.top - 44) : 90
    const left = s.rect && box ? Math.max(8, Math.min(s.rect.left - box.left, box.width - 300)) : 12
    setSel({ ...s, top, left })
  }, [])

  const act = (kind) => {
    if (!sel || !active) return
    onAction(kind, {
      text: sel.text, page: sel.page ?? viewApi.current?.page?.() ?? null,
      url: sel.url || viewApi.current?.url?.() || null,
      sourceEntry: active,
      label: viewApi.current?.label?.() || active.source.title,
      printedPage: sel.page != null ? sel.page - (active.page_offset || 0) : null,
    })
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }

  const attachWeb = async () => {
    if (!webUrl.trim()) { setWebError('Enter an address.'); return }
    setWebBusy(true); setWebError(null)
    const r = await onAttachWeb(webUrl.trim())
    setWebBusy(false)
    if (r?.error) setWebError(r.error)
    else { setWebUrl(''); setMenu(false) }
  }

  const own = list.filter((s) => s.scope === 'paper')
  const inherited = list.filter((s) => s.scope === 'folder')

  let body = null
  if (loading && !list.length) body = <div className="fs-loading"><Loader2 size={16} className="spin" /> Loading…</div>
  else if (!active) {
    body = (
      <div className="sources-empty">
        Attach the slides, chapter or web page you're studying, and read it beside “{paper?.title}”.
        <div className="actions">
          <button onClick={onAttachFile}><FilePlus size={14} /> Attach a file…</button>
          <button onClick={() => setMenu(true)}><Globe size={14} /> Attach a web page…</button>
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5 }}>PDF, Word, PowerPoint, HTML or text. Files are copied into your Anki Papers folder.</div>
      </div>
    )
  } else if (!active.source.available) {
    body = <div className="sources-empty">“{active.source.title}” isn't on this computer. Attach the file again here to read it.</div>
  } else {
    const k = active.source.kind
    const showContents = active.scope === 'folder' && !active.chapter && (active.chapters?.length > 0) && !wholeBook[activeK]
    const viewProps = { entry: active, jump: jump?.key === activeK ? jump : null, onSelection, apiRef: viewApi }
    if (showContents) body = <ContentsView entry={active} onOpenPaper={onOpenPaper} onCreateChapterPaper={onCreateChapterPaper} onReadWhole={() => setWholeBook((w) => ({ ...w, [activeK]: true }))} />
    else if (k === 'pdf' || k === 'legacy-pdf') body = <PdfView key={activeK} {...viewProps} />
    else if (k === 'web') body = <WebView key={activeK} {...viewProps} />
    else body = <ReaderView key={activeK} {...viewProps} />
  }

  return (
    <div className="sources-panel" ref={panelRef} style={{ position: 'relative' }}>
      <div className="sources-head">
        <Paperclip size={15} />
        <span className="grow">Sources</span>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" title="Attach to this paper" onClick={() => setMenu((m) => !m)}><Plus size={16} /></button>
          {menu && (
            <div className="attach-menu" onMouseLeave={() => !webBusy && !webUrl && setMenu(false)}>
              <div className="lbl">Attach to “{paper?.title}”</div>
              <div className="it" onClick={() => { setMenu(false); onAttachFile() }}>
                <FilePlus size={15} /><div>File…<small>PDF, Word, PowerPoint, HTML or text</small></div>
              </div>
              <div className="it" style={{ cursor: 'default', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10 }}><Globe size={15} /><div>Web page<small>Saved as a snapshot you can read offline</small></div></div>
                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                  <input className="modal-input" style={{ margin: 0, fontSize: 12, padding: '5px 8px' }} placeholder="learn.microsoft.com/…" value={webUrl}
                    onChange={(e) => { setWebUrl(e.target.value); setWebError(null) }}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') attachWeb() }} autoFocus />
                  <button className="sources-btn primary" disabled={webBusy} onClick={attachWeb}>{webBusy ? <Loader2 size={13} className="spin" /> : 'Attach'}</button>
                </div>
                {webError && <div className="fs-hint bad">{webError}</div>}
              </div>
              {own.length > 0 && <><hr /><div className="lbl">Attached to this paper</div></>}
              {own.map((s) => {
                const Icon = KIND_ICON[s.source.kind] || FileText
                return (
                  <div key={sourceKey(s)} className="it" onClick={() => { onSelectKey(sourceKey(s)); setMenu(false) }}>
                    <Icon size={15} /><div style={{ minWidth: 0 }}>{s.source.title}</div>
                    <button className="icon-btn x" title="Remove from this paper" onClick={(e) => { e.stopPropagation(); onDetach(s) }}><Trash2 size={13} /></button>
                  </div>
                )
              })}
              {inherited.length > 0 && <><hr /><div className="lbl">From folders (manage them from the folder's right-click menu)</div></>}
              {inherited.map((s) => {
                const Icon = KIND_ICON[s.source.kind] || FileText
                return (
                  <div key={sourceKey(s)} className="it" onClick={() => { onSelectKey(sourceKey(s)); setMenu(false) }}>
                    <Icon size={15} /><div style={{ minWidth: 0 }}>{s.source.title}<small>from {lastSegment(s.folder)}</small></div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {active && onRemoveSource && active.scope !== 'legacy' && (
          <button className="icon-btn" title={active.scope === 'folder' ? `Remove “${active.source.title}” from ${lastSegment(active.folder)}` : `Remove “${active.source.title}” from this paper`}
            onClick={() => onRemoveSource(active)}><Trash2 size={15} /></button>
        )}
        <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
      {list.length > 0 && (
        <div className="sources-tabs">
          {list.map((s) => {
            const Icon = KIND_ICON[s.source.kind] || FileText
            const k = sourceKey(s)
            return (
              <button key={k} className={`sources-tab ${k === activeK ? 'active' : ''}`} onClick={() => { setSel(null); onSelectKey(k) }} title={s.source.title}>
                <Icon size={12} /><span className="t">{tabLabel(s)}</span>
                {s.scope === 'folder' && <span className="sources-from">from {lastSegment(s.folder)}</span>}
              </button>
            )
          })}
        </div>
      )}
      {body}
      {sel && (
        <div className="source-bubble" style={{ top: sel.top, left: sel.left }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => act('notes')}><Plus size={13} /> Add to notes</button>
          {aiEnabled && <button className="ai" onClick={() => act('draft')}><Sparkles size={13} /> Draft cards</button>}
          {aiEnabled && <button onClick={() => act('ask')}><MessageCircle size={13} /> Ask</button>}
        </div>
      )}
    </div>
  )
})

export default SourcesPanel
