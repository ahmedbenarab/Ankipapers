import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Globe, ChevronRight, ChevronLeft, Plus, X, FileX2, ExternalLink } from 'lucide-react'
import { pickPdfFile, openUrl } from '../bridge'

/** Valid http(s) URL for preview / browser (adds https:// when missing). */
function normalizeWebUrl(raw) {
  const s = (raw || '').trim()
  if (!s) return ''
  let u = s
  if (!/^https?:\/\//i.test(u) && !/^\/{2}/.test(u)) u = `https://${u}`
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

export default function SourcePanel({ source, onSourceChange, onExtract, onClose }) {
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [webUrl, setWebUrl] = useState(source?.url || '')
  const [selPopup, setSelPopup] = useState(null)
  const iframeRef = useRef(null)
  const viewRef = useRef(null)
  const mode = source?.type || 'pdf'

  const normalizedWebSrc = useMemo(() => normalizeWebUrl(source?.url || ''), [source?.url])

  useEffect(() => {
    if (mode === 'web' && source?.url) setWebUrl(source.url)
  }, [mode, source?.url])

  // Build the file:// URL for the viewer HTML (same directory as index.html)
  const viewerUrl = useRef(
    (() => {
      const base = document.baseURI || window.location.href
      const dir = base.substring(0, base.lastIndexOf('/') + 1)
      return dir + 'pdf_viewer.html'
    })()
  )

  // Track when the iframe is ready
  const iframeReady = useRef(false)
  const pendingPath = useRef(null)

  const sendLoadCmd = useCallback((path) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow || !iframeReady.current) {
      pendingPath.current = path
      return
    }
    const url = 'file:///' + path.replace(/\\/g, '/')
    iframe.contentWindow.postMessage({ source: 'ankipapers', cmd: 'load', url }, '*')
    pendingPath.current = null
  }, [])

  const sendClearCmd = useCallback(() => {
    pendingPath.current = null
    const iframe = iframeRef.current
    if (iframe?.contentWindow && iframeReady.current) {
      iframe.contentWindow.postMessage({ source: 'ankipapers', cmd: 'clear' }, '*')
    }
  }, [])

  // Called when iframe finishes loading
  const onIframeLoad = useCallback(() => {
    iframeReady.current = true
    if (pendingPath.current) sendLoadCmd(pendingPath.current)
  }, [sendLoadCmd])

  // When source path changes, load PDF or clear viewer
  useEffect(() => {
    if (mode !== 'pdf') return
    if (!source?.path) {
      sendClearCmd()
      setTotalPages(0)
      setPage(1)
      setSelPopup(null)
      return
    }
    setTotalPages(0)
    setPage(1)
    sendLoadCmd(source.path)
  }, [source?.path, mode, sendLoadCmd])

  // After PDF reports page count, scroll to fuzzy-matched quote (Go to source)
  useEffect(() => {
    if (mode !== 'pdf' || !source?.path || !source?.jumpQuote || !totalPages) return
    if (!iframeReady.current || !iframeRef.current?.contentWindow) return
    const quote = source.jumpQuote
    const pg = Number(source.page || 1)
    const id = window.setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: 'ankipapers', cmd: 'scrollToQuote', quote, page: pg },
        '*',
      )
      onSourceChange?.({ jumpQuote: null })
    }, 450)
    return () => clearTimeout(id)
  }, [mode, source?.path, source?.jumpQuote, source?.page, totalPages, onSourceChange])

  // Listen for messages from the PDF viewer iframe
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data
      if (!d || d.source !== 'pdf-viewer') return
      if (d.type === 'loaded') {
        setTotalPages(d.pages || 0)
        setPage(1)
      }
      if (d.type === 'page') {
        setPage(d.page || 1)
        setTotalPages(d.total || totalPages)
      }
      if (d.type === 'selection' && d.text) {
        setSelPopup({ text: d.text, page: d.page || page })
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [page, totalPages])

  const addSelection = useCallback(() => {
    if (!selPopup?.text) return
    onExtract?.({ mode, page: selPopup.page || page, customText: selPopup.text })
    setSelPopup(null)
  }, [selPopup, mode, page, onExtract])

  const dismissPopup = useCallback(() => setSelPopup(null), [])

  const openPdf = async () => {
    const r = await pickPdfFile()
    if (r?.ok) {
      onSourceChange?.({ type: 'pdf', path: r.path, name: r.name })
      setPage(1)
      setTotalPages(0)
    }
  }

  const closePdf = () => {
    pendingPath.current = null
    setSelPopup(null)
    onSourceChange?.({ type: 'pdf', path: '', name: '' })
  }

  const goToPage = (n) => {
    const p = Math.max(1, Math.min(totalPages || 1, n))
    setPage(p)
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'ankipapers', cmd: 'goToPage', page: p }, '*'
    )
  }

  const loadWebPreview = useCallback(() => {
    const nu = normalizeWebUrl(webUrl)
    if (!nu) return
    setWebUrl(nu)
    onSourceChange?.({ type: 'web', url: nu })
  }, [webUrl, onSourceChange])

  const openWebInBrowser = useCallback(() => {
    const nu = normalizeWebUrl(webUrl) || normalizedWebSrc
    if (nu) openUrl(nu)
  }, [webUrl, normalizedWebSrc])

  return (
    <aside className="source-panel">
      <div className="source-panel-header">
        <div className="source-panel-tabs">
          <button className={`sp-tab ${mode === 'pdf' ? 'active' : ''}`} onClick={() => onSourceChange?.({ type: 'pdf' })}>
            <FileText size={13} /> PDF
          </button>
          <button className={`sp-tab ${mode === 'web' ? 'active' : ''}`} onClick={() => onSourceChange?.({ type: 'web' })}>
            <Globe size={13} /> Web
          </button>
        </div>
        <button className="sp-close" onClick={onClose} title="Close panel"><X size={14} /></button>
      </div>

      {mode === 'pdf' ? (
        <div className="sp-controls">
          <button className="sp-open-btn" onClick={openPdf}>
            <FileText size={14} />
            <span>{source?.name || 'Open PDF'}</span>
          </button>
          {source?.path ? (
            <button className="sp-pager-btn" type="button" onClick={closePdf} title="Close PDF">
              <FileX2 size={14} />
            </button>
          ) : null}
          {totalPages > 0 && (
            <div className="sp-pager">
              <button className="sp-pager-btn" onClick={() => goToPage(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /></button>
              <span className="sp-pager-label">{page} / {totalPages}</span>
              <button className="sp-pager-btn" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      ) : (
        <div className="sp-controls sp-web-controls">
          <div className="sp-url-row">
            <input className="sp-url-input" placeholder="https://example.com/article" value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadWebPreview() }} />
            <button type="button" className="sp-pager-btn" onClick={loadWebPreview} title="Load in panel (if allowed)">
              <Globe size={14} />
            </button>
            <button type="button" className="sp-pager-btn" onClick={openWebInBrowser} title="Open in system browser">
              <ExternalLink size={14} />
            </button>
          </div>
          <p className="sp-web-hint">
            Many sites (Google, Facebook, banks, …) send headers that forbid iframe embedding, so the preview may show an error even though you are online.
            Use the external-link button to open the page in your system browser. Article and documentation URLs usually work better in the panel than homepages.
          </p>
        </div>
      )}

      <div className="sp-view" ref={viewRef}>
        {mode === 'pdf' ? (
          <iframe
            ref={iframeRef}
            title="PDF Viewer"
            src={viewerUrl.current}
            className="sp-pdf-frame"
            onLoad={onIframeLoad}
          />
        ) : (
          normalizedWebSrc ? (
            <iframe title="Web preview" src={normalizedWebSrc} className="sp-web-frame" referrerPolicy="no-referrer-when-downgrade" />
          ) : (
            <div className="sp-empty"><Globe size={32} className="sp-empty-icon" /><p>Enter a URL to load</p></div>
          )
        )}

        {selPopup && (
          <>
            <div className="sp-sel-backdrop" onClick={dismissPopup} />
            <div className="sp-sel-bar">
              <span className="sp-sel-preview">"{selPopup.text.length > 80 ? selPopup.text.slice(0, 80) + '...' : selPopup.text}"</span>
              <button className="sp-sel-btn" onClick={addSelection}><Plus size={12} /> Add to notes</button>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
