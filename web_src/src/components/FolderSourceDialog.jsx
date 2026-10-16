import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Globe, X, Loader2, CheckCircle2, FileText, Trash2, Plus, Paperclip } from 'lucide-react'
import { getPdfViewerUrl } from '../bridge'
import {
  srcPickFile, srcWebInspect, srcMatch, srcFolderAttachBook, srcFolderAttachWeb, srcFolderList, srcFolderDetach,
  srcSubfolders, srcGroupFolders, srcSetGroupFolder,
} from '../aiBridge'

/**
 * Attach a book (PDF) or a web source (course, learning path, docs site) to a
 * folder, and say which paper covers each chapter. Also lists and removes a
 * folder's sources ("manage").
 *
 * Nothing is written until "Attach": then chapters marked "Create it now" get
 * a paper, and the rest wait -- "Link when I create it" connects a paper you
 * make later in this folder whose title matches.
 */

const SKIP_RE = /^(front\s*matter|cover|title\s*page|half\s*title|copyright|(table\s+of\s+)?contents|preface|foreword|acknowledg|dedication|index|about\s+the\s+authors?|bibliography|list\s+of\s+(figures|tables)|abbreviations|back\s*matter)\b/i
const lastSegment = (p) => (p || '').split('/').filter(Boolean).pop() || p

// One choice per chapter row: an existing paper's id, or one of these.
const LINK = '__link', CREATE = '__create', SKIP = '__skip'

function rowChoice(c) { return c.skip ? SKIP : c.create ? CREATE : (c.paper_id || LINK) }

function MapTable({ chapters, papers, setChapters, showPages, offset, editablePages }) {
  const setRow = (i, patch) => setChapters(chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const choose = (i, v) => setRow(i, v === SKIP ? { skip: true, create: false, paper_id: null }
    : v === CREATE ? { skip: false, create: true, paper_id: null }
    : v === LINK ? { skip: false, create: false, paper_id: null }
    : { skip: false, create: false, paper_id: v })
  const used = new Set(chapters.map((c) => c.paper_id).filter(Boolean))
  let lastGroup = null
  const rows = []
  chapters.forEach((c, i) => {
    if (c.group && c.group !== lastGroup) {
      rows.push(<tr key={`g-${i}`} className="grp"><td colSpan={showPages ? 4 : 3}>{c.group}</td></tr>)
      lastGroup = c.group
    }
    const v = rowChoice(c)
    rows.push(
      <tr key={c.key} className={c.skip ? 'skip' : ''}>
        <td>{c.number ? `${c.number} · ` : ''}{c.title}</td>
        {showPages && (
          <td className="pp">
            {editablePages ? (
              <>
                <input className="modal-input pp" type="number" min={1} value={c.start - offset}
                  onChange={(e) => setRow(i, { start: (parseInt(e.target.value, 10) || 1) + offset })} />
                {' – '}
                <input className="modal-input pp" type="number" min={1} value={(c.end ?? c.start) - offset}
                  onChange={(e) => setRow(i, { end: (parseInt(e.target.value, 10) || 1) + offset })} />
              </>
            ) : `${c.start - offset}–${(c.end ?? c.start) - offset}`}
          </td>
        )}
        <td>
          <select value={v} onChange={(e) => choose(i, e.target.value)}>
            {c.paper_id && <option value={c.paper_id}>{papers.find((p) => p.id === c.paper_id)?.title || 'Paper'}</option>}
            <option value={LINK}>Link when I create it</option>
            <option value={CREATE}>Create it now</option>
            <option value={SKIP}>Skip</option>
            {papers.filter((p) => p.id !== c.paper_id && !used.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </td>
        <td>
          {c.skip ? <span className="fs-st s">skip</span> : c.paper_id ? <span className="fs-st m">matched</span>
            : c.create ? <span className="fs-st n">new</span> : <span className="fs-st l">when created</span>}
        </td>
      </tr>,
    )
  })
  return (
    <table className="fs-map">
      <thead><tr><th style={{ width: showPages ? '42%' : '56%' }}>{showPages ? 'Chapter in the book' : 'Chapter'}</th>{showPages && <th>Pages</th>}<th>Paper</th><th style={{ width: 100 }} /></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  )
}

// Where one learning path's papers live: a sub-folder, a new one, or the folder itself.
function GroupFolderSelect({ folder, group, value, subfolders, onChange, allowNew = true, auto = null }) {
  return (
    <select className="deck-select" style={{ width: '100%' }} value={value} onChange={(e) => onChange(e.target.value)}>
      {auto !== null && <option value="auto">Automatic{auto ? ` (${lastSegment(auto)})` : ` (${lastSegment(folder)} itself)`}</option>}
      {subfolders.map((f) => <option key={f} value={f}>{lastSegment(f)}</option>)}
      {allowNew && <option value={`new:${group}`}>New sub-folder “{group.length > 40 ? group.slice(0, 39) + '…' : group}”</option>}
      <option value="">{lastSegment(folder)} itself (just a heading)</option>
    </select>
  )
}

function summary(chapters) {
  const m = chapters.filter((c) => c.paper_id && !c.skip).length
  const n = chapters.filter((c) => c.create && !c.skip).length
  const l = chapters.filter((c) => !c.paper_id && !c.create && !c.skip).length
  const s = chapters.filter((c) => c.skip).length
  return [m && `${m} matched`, n && `${n} new ${n === 1 ? 'paper' : 'papers'}`, l && `${l} linked when you create them`, s && `${s} skipped`].filter(Boolean).join(' · ')
}

async function applyMatches(folder, chapters) {
  const r = await srcMatch(folder, chapters.map((c) => ({ key: c.key, title: c.title })))
  const matches = r?.matches || {}
  return { papers: r?.papers || [], chapters: chapters.map((c) => (matches[c.key] ? { ...c, paper_id: matches[c.key] } : c)) }
}

// ─── Book ─────────────────────────────────────────────────────────────

const NONE = '__none'
const NUMBERED_RE = /^\s*(?:chapter|ch\.?)?\s*\d+[a-z]?\b(?![.)]?\s*$)/i

// The PDF's bookmarks as rows in reading order, each knowing its pages (up to
// the next bookmark at the same or a higher level) and the part it sits in.
function outlineRows(ol) {
  const pages = ol.pages || 1
  const items = (ol.items || []).map((it, i) => ({ ...it, i })).sort((a, b) => a.page - b.page || a.i - b.i)
  return items.map((it, idx) => {
    let end = pages
    for (let j = idx + 1; j < items.length; j++) {
      if (items[j].level <= it.level) { end = Math.max(it.page, items[j].page - 1); break }
    }
    let group = null
    for (let j = idx - 1; j >= 0; j--) {
      if (items[j].level < it.level) { group = items[j].level === 0 ? items[j].title : null; break }
    }
    return { key: `o${idx}-p${it.page}`, title: it.title, level: it.level, start: it.page, end, group: it.level > 0 ? group : null, choice: NONE }
  })
}

// Which level holds the chapters: where your papers matched, else the level
// whose titles are numbered ("1 Getting Started", "Chapter 3 …"), else the
// level with the most entries.
function chapterLevel(rows) {
  const count = (pred) => {
    const c = {}
    rows.forEach((r) => { if (pred(r)) c[r.level] = (c[r.level] || 0) + 1 })
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0]
    return best ? Number(best[0]) : null
  }
  return count((r) => r.matched) ?? count((r) => NUMBERED_RE.test(r.title) && !/^\s*part\b/i.test(r.title)) ?? count(() => true) ?? 0
}

// A page as the book prints it: the PDF's own label (i, ii, 1, 2…) when it has
// them, else counted from printed page 1.
function pageName(p, offset, labels) {
  const l = Array.isArray(labels) ? labels[p - 1] : null
  if (l != null && String(l).trim()) return String(l).trim()
  return p - offset >= 1 ? String(p - offset) : `PDF ${p}`
}

function OutlineTable({ rows, setRows, papers, offset, depth, labels }) {
  const used = new Set(rows.map((r) => r.choice).filter((c) => c && !c.startsWith('__')))
  const choose = (key, v) => setRows(rows.map((r) => (r.key === key ? { ...r, choice: v } : r)))
  const label = (c) => (c === NONE ? null : c === LINK ? <span className="fs-st l">when created</span>
    : c === CREATE ? <span className="fs-st n">new</span> : <span className="fs-st m">paper</span>)
  return (
    <table className="fs-map">
      <thead><tr><th style={{ width: '50%' }}>The book’s outline</th><th>Pages</th><th>Paper</th><th style={{ width: 96 }} /></tr></thead>
      <tbody>
        {rows.filter((r) => r.level < depth || r.choice !== NONE).map((r) => (
          <tr key={r.key} className={r.choice === NONE ? 'skip' : ''}>
            <td style={{ paddingLeft: 8 + r.level * 18, fontWeight: r.level === 0 ? 600 : 400 }}>{r.title}</td>
            <td className="pp">{r.start === r.end ? pageName(r.start, offset, labels) : `${pageName(r.start, offset, labels)}–${pageName(r.end, offset, labels)}`}</td>
            <td>
              <select value={r.choice} onChange={(e) => choose(r.key, e.target.value)}>
                {!r.choice.startsWith('__') && <option value={r.choice}>{papers.find((p) => p.id === r.choice)?.title || 'Paper'}</option>}
                <option value={NONE}>Not a chapter</option>
                <option value={LINK}>Link when I create it</option>
                <option value={CREATE}>Create it now</option>
                {papers.filter((p) => p.id !== r.choice && !used.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </td>
            <td>{label(r.choice)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BookDialog({ folder, onClose, onDone }) {
  const [file, setFile] = useState(null)           // { path, name, url }
  const [outline, setOutline] = useState(null)     // { items, labels, pages }
  const [rows, setRows] = useState([])             // outline rows with a paper choice each
  const [depth, setDepth] = useState(2)            // outline levels shown
  const [manual, setManual] = useState(false)      // no bookmarks: type the ranges
  const [chapters, setChapters] = useState([])     // manual mode only
  const [offset, setOffset] = useState(0)
  const [papers, setPapers] = useState([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const iframeRef = useRef(null)
  const [viewer, setViewer] = useState(null)

  useEffect(() => { getPdfViewerUrl().then((r) => setViewer(r?.url || null)) }, [])

  const pick = useCallback(async () => {
    const r = await srcPickFile('Choose the book (a PDF)')
    setError(null)
    if (!r || r.canceled) return
    if (r.error) { setError(r.error); return }
    if (!/\.pdf$/i.test(r.path)) { setError('A book has to be a PDF.'); return }
    setFile(r)
    setTitle(r.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '))
    setOutline(null)
    setRows([])
  }, [])
  // Opening the dialog opens the file picker straight away; its state is
  // only set after the (native, asynchronous) picker returns.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { pick() }, [pick])

  // Turn the outline into rows, match them to your papers, and preselect.
  const buildRows = useCallback(async (ol) => {
    const labels = Array.isArray(ol.labels) ? ol.labels : null
    const li = labels ? labels.findIndex((l) => String(l).trim() === '1') : -1
    setOffset(li >= 0 ? li : 0)
    if (!ol.items?.length) {
      setManual(true)
      setChapters([{ key: 'c1', title: 'Chapter 1', start: 1 + (li >= 0 ? li : 0), end: ol.pages || 1, number: 1 }])
      const r = await srcMatch(folder, [])
      setPapers(r?.papers || [])
      return
    }
    const base = outlineRows(ol)
    const r = await srcMatch(folder, base.map((x) => ({ key: x.key, title: x.title })))
    const matches = r?.matches || {}
    setPapers(r?.papers || [])
    const withMatch = base.map((x) => (matches[x.key] ? { ...x, matched: true, choice: matches[x.key] } : x))
    const lv = chapterLevel(withMatch)
    setDepth(Math.min(3, lv + 2))
    setRows(withMatch.map((x) => (x.choice === NONE && x.level === lv && !SKIP_RE.test(x.title) ? { ...x, choice: LINK } : x)))
  }, [folder])

  // Read the PDF's bookmarks and page labels through a hidden viewer.
  useEffect(() => {
    if (!file?.url || !viewer) return
    const onMsg = (e) => {
      const d = e.data
      if (!d || d.source !== 'pdf-viewer' || e.source !== iframeRef.current?.contentWindow) return
      if (d.type === 'loaded') iframeRef.current.contentWindow.postMessage({ source: 'ankipapers', cmd: 'getOutline', id: 'o' }, '*')
      if (d.type === 'outline') {
        const ol = d.outline || { items: [], labels: null, pages: 0 }
        setOutline(ol)
        buildRows(ol)
      }
      if (d.type === 'error') setError(`Couldn’t open the PDF: ${d.message}`)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [file, viewer, buildRows])
  const onViewerLoad = () => iframeRef.current?.contentWindow?.postMessage({ source: 'ankipapers', cmd: 'load', url: file.url, start: 1, end: 1 }, '*')

  const detectedOffset = useMemo(() => {
    const labels = outline?.labels
    if (!Array.isArray(labels)) return null
    const i = labels.findIndex((l) => String(l).trim() === '1')
    return i >= 0 ? i : null
  }, [outline])
  const maxLevel = useMemo(() => rows.reduce((m, r) => Math.max(m, r.level), 0), [rows])
  const levelCounts = useMemo(() => [0, 1, 2].map((l) => rows.filter((r) => r.level === l).length), [rows])

  // Everything with a paper choice becomes a chapter of this book.
  const picked = manual
    ? chapters.map((c) => ({ ...c, choice: c.skip ? NONE : c.create ? CREATE : (c.paper_id || LINK) }))
    : rows
  const chosen = picked.filter((r) => r.choice !== NONE)
  const counts = {
    paper: chosen.filter((r) => !r.choice.startsWith('__')).length,
    create: chosen.filter((r) => r.choice === CREATE).length,
    link: chosen.filter((r) => r.choice === LINK).length,
  }
  const setAllUnmatched = (v) => setRows((rs) => rs.map((r) => ((r.choice === LINK || r.choice === CREATE) ? { ...r, choice: v } : r)))

  const attach = async () => {
    setBusy(true); setError(null)
    const r = await srcFolderAttachBook({
      folder, path: file.path, title, page_offset: offset, unmatched: 'link',
      chapters: chosen.map((c) => ({
        key: c.key, title: c.title, start: c.start, end: c.end, group: c.group || null,
        paper_id: c.choice.startsWith('__') ? null : c.choice, create: c.choice === CREATE,
      })),
    })
    setBusy(false)
    if (r?.error) { setError(r.error); return }
    onDone(r)
  }

  return (
    <div className="modal fs-modal" onClick={(e) => e.stopPropagation()}>
      <div className="fs-title"><BookOpen size={17} /> <span className="grow">Attach a book to “{lastSegment(folder)}”</span><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
      <div className="fs-body">
        <div className="fs-side">
          <div className="fs-field">
            <label>Book file</label>
            {file ? (
              <div className="fs-file"><FileText size={15} /><div style={{ minWidth: 0 }}>{file.name}<small>{outline ? `${outline.pages} PDF pages · ${rows.length} bookmarks` : 'Reading…'}</small></div></div>
            ) : <button className="sources-btn" onClick={pick}>Choose a PDF…</button>}
            {file && <button className="sources-btn" style={{ marginTop: 6 }} onClick={pick}>Choose another…</button>}
          </div>
          <div className="fs-field"><label>Title</label><input className="modal-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          {!manual && rows.length > 0 && (
            <div className="fs-field">
              <label>Show the outline</label>
              <select className="deck-select" style={{ width: '100%' }} value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                {[1, 2, 3].filter((d) => d <= maxLevel + 1).map((d) => (
                  <option key={d} value={d}>{d === 1 ? 'Top level only' : `${d} levels deep`} ({levelCounts.slice(0, d).reduce((a, b) => a + b, 0)} entries)</option>
                ))}
              </select>
              <div className="fs-hint">Pick a paper for each part, chapter or section you study. Anything set to “Not a chapter” is left out. Entries you’ve given a paper stay listed at any depth.</div>
            </div>
          )}
          <div className="fs-field">
            <label>Page numbers</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Printed page 1 is PDF page
              <input className="modal-input" style={{ width: 70, margin: 0 }} type="number" min={1} value={offset + 1}
                onChange={(e) => setOffset(Math.max(0, (parseInt(e.target.value, 10) || 1) - 1))} />
            </div>
            {detectedOffset != null && <div className="fs-hint ok"><CheckCircle2 size={12} /> Found in the PDF’s page labels</div>}
            <div className="fs-hint">Page numbers in the panel and in chat use the book’s printed numbers.</div>
          </div>
          {!manual && rows.length > 0 && (
            <div className="fs-field">
              <label>Chapters picked but without a paper</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="sources-btn" onClick={() => setAllUnmatched(LINK)}>Link when created</button>
                <button className="sources-btn" onClick={() => setAllUnmatched(CREATE)}>Create them all now</button>
              </div>
            </div>
          )}
          {error && <div className="fs-hint bad">{error}</div>}
        </div>
        <div className="fs-main">
          {!file ? <div className="fs-loading">Choose the book’s PDF to continue.</div>
            : !outline ? <div className="fs-loading"><Loader2 size={16} className="spin" /> Reading the book’s outline…</div>
            : manual ? (
              <>
                <div className="fs-hint" style={{ margin: 10 }}>This PDF has no bookmarks, so type each chapter’s printed pages.</div>
                <MapTable chapters={chapters} papers={papers} setChapters={setChapters} showPages offset={offset} editablePages />
                <button className="sources-btn" style={{ margin: 10 }} onClick={() => {
                  const last = chapters[chapters.length - 1]
                  const start = (last?.end || offset) + 1
                  setChapters([...chapters, { key: `c${chapters.length + 1}`, title: `Chapter ${chapters.length + 1}`, start, end: start, number: chapters.length + 1 }])
                }}><Plus size={13} /> Add a chapter</button>
              </>
            ) : <OutlineTable rows={rows} setRows={setRows} papers={papers} offset={offset} depth={depth} labels={outline?.labels} />}
        </div>
      </div>
      <div className="fs-foot">
        <span className="grow">
          {chosen.length
            ? `${chosen.length} chapters · ${[counts.paper && `${counts.paper} with a paper`, counts.create && `${counts.create} new papers`, counts.link && `${counts.link} linked when you create them`].filter(Boolean).join(' · ')} · the text of your papers isn’t changed`
            : outline ? 'Pick a paper for at least one entry.' : ''}
        </span>
        <button className="modal-btn" onClick={onClose}>Cancel</button>
        <button className="modal-btn primary" disabled={!file || !outline || busy || !chosen.length} onClick={attach}>
          {busy ? <Loader2 size={14} className="spin" /> : <BookOpen size={14} />} Attach book
        </button>
      </div>
      {file?.url && viewer && (
        <iframe ref={iframeRef} src={viewer} title="Book reader" onLoad={onViewerLoad}
          style={{ position: 'absolute', width: 10, height: 10, left: -9999, top: 0, opacity: 0 }} />
      )}
    </div>
  )
}

// ─── Web ──────────────────────────────────────────────────────────────

function WebDialog({ folder, onClose, onDone }) {
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState(null)
  const [inspecting, setInspecting] = useState(false)
  const [chapters, setChapters] = useState([])
  const [papers, setPapers] = useState([])
  const [groupFolders, setGroupFolders] = useState({}) // learning path -> path | '' | 'new:<name>'
  const [subfolders, setSubfolders] = useState([])
  const [keep, setKeep] = useState('snapshot')
  const [unmatched, setUnmatched] = useState('link')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const inspect = async () => {
    if (!url.trim()) { setError('Paste the address of the course, learning path or page.'); return }
    setInspecting(true); setError(null); setInfo(null)
    const r = await srcWebInspect(url.trim())
    setInspecting(false)
    if (r?.error) { setError(r.error); return }
    setInfo(r)
    const list = []
    for (const g of r.groups || []) for (const c of g.chapters || []) list.push({ ...c, group: g.title || c.group || undefined, number: list.length + 1 })
    const m = await applyMatches(folder, list)
    setPapers(m.papers)
    setChapters(m.chapters)
    // Learning paths that already have a sub-folder (by name, or because their
    // papers are in it) go there; the rest are headings in this folder.
    const sf = await srcSubfolders(folder, m.chapters.map((c) => ({ key: c.key, title: c.title, group: c.group, paper_id: c.paper_id })))
    setSubfolders(sf?.subfolders || [])
    const gm = {}
    for (const g of r.groups || []) if (g.title) gm[g.title] = sf?.map?.[g.title] || ''
    setGroupFolders(gm)
  }
  const groupTitles = (info?.groups || []).map((g) => g.title).filter(Boolean)
  const hasGroups = groupTitles.length > 0
  const setUnmatchedAll = (v) => {
    setUnmatched(v)
    setChapters((cs) => cs.map((c) => (c.paper_id || c.skip ? c : { ...c, create: v === 'create' })))
  }
  const kindLabel = { 'learn-course': 'Microsoft Learn course', 'learn-path': 'Microsoft Learn learning path', 'learn-module': 'Microsoft Learn module', page: 'Web page' }

  const attach = async () => {
    setBusy(true); setError(null)
    const r = await srcFolderAttachWeb({
      folder, url: info.url, title: info.title, kind: info.kind, keep, unmatched, group_folders: hasGroups ? groupFolders : {},
      chapters: chapters.map((c) => ({ key: c.key, title: c.title, url: c.url, group: c.group || null, paper_id: c.paper_id || null, skip: !!c.skip, create: !!c.create })),
    })
    setBusy(false)
    if (r?.error) { setError(r.error); return }
    onDone(r)
  }

  return (
    <div className="modal fs-modal" onClick={(e) => e.stopPropagation()}>
      <div className="fs-title"><Globe size={17} /> <span className="grow">Attach a web source to “{lastSegment(folder)}”</span><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
      <div className="fs-body">
        <div className="fs-side">
          <div className="fs-field">
            <label>Address</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="modal-input" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5 }} autoFocus
                placeholder="learn.microsoft.com/en-us/training/courses/…" value={url}
                onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') inspect() }} />
              <button className="sources-btn primary" disabled={inspecting} onClick={inspect}>{inspecting ? <Loader2 size={13} className="spin" /> : 'Read'}</button>
            </div>
            {info && <div className="fs-hint ok"><CheckCircle2 size={12} /> {kindLabel[info.kind] || 'Web page'}{hasGroups ? ` · ${info.groups.length} learning paths` : ''} · {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}</div>}
            {!info && !inspecting && <div className="fs-hint">A course, a learning path, a docs site’s contents page, or any page that links to its chapters.</div>}
          </div>
          {info && hasGroups && (
            <div className="fs-field">
              <label>Where each learning path lives</label>
              {groupTitles.map((g) => (
                <div key={g} style={{ marginBottom: 8 }}>
                  <div className="fs-hint" style={{ marginTop: 0, marginBottom: 3, color: 'var(--text-secondary)' }}>{g}</div>
                  <GroupFolderSelect folder={folder} group={g} value={groupFolders[g] ?? ''} subfolders={subfolders}
                    onChange={(v) => setGroupFolders((m) => ({ ...m, [g]: v }))} />
                </div>
              ))}
              <div className="fs-hint">Its chapters waiting for a paper show in that folder, and new papers for them are made there. A new sub-folder also takes the matched papers sitting directly in {lastSegment(folder)}.</div>
            </div>
          )}
          {info && (
            <>
              <div className="fs-field">
                <label>Keep</label>
                <div className={`fs-opt ${keep === 'snapshot' ? 'active' : ''}`} onClick={() => setKeep('snapshot')}><span className="r" /><div>A saved copy<small>Readable offline; Refresh when the course changes</small></div></div>
                <div className={`fs-opt ${keep === 'live' ? 'active' : ''}`} onClick={() => setKeep('live')}><span className="r" /><div>Always load live<small>Needs internet; the text can change</small></div></div>
              </div>
              <div className="fs-field">
                <label>Chapters without a paper</label>
                <select className="deck-select" style={{ width: '100%' }} value={unmatched} onChange={(e) => setUnmatchedAll(e.target.value)}>
                  <option value="link">Link when I create a paper for it</option>
                  <option value="create">Create the papers now</option>
                </select>
              </div>
            </>
          )}
          {error && <div className="fs-hint bad">{error}</div>}
        </div>
        <div className="fs-main">
          {inspecting ? <div className="fs-loading"><Loader2 size={16} className="spin" /> Reading the course outline…</div>
            : !info ? <div className="fs-loading">Paste an address and press Read.</div>
            : <MapTable chapters={chapters} papers={papers} setChapters={setChapters} showPages={false} offset={0} />}
        </div>
      </div>
      <div className="fs-foot">
        <span className="grow">{chapters.length ? `${summary(chapters)} · the text of your papers isn’t changed` : ''}</span>
        <button className="modal-btn" onClick={onClose}>Cancel</button>
        <button className="modal-btn primary" disabled={!info || busy} onClick={attach}>
          {busy ? <Loader2 size={14} className="spin" /> : <Globe size={14} />} Attach web source
        </button>
      </div>
    </div>
  )
}

// ─── Manage ───────────────────────────────────────────────────────────

function ManageDialog({ folder, onClose, onDone }) {
  const [list, setList] = useState(null)
  const [groups, setGroups] = useState({}) // source id -> { groups, map, pinned, subfolders }
  const load = useCallback(async () => {
    const r = await srcFolderList(folder)
    const srcs = r?.sources || []
    const g = {}
    for (const s of srcs) {
      if ((s.chapters || []).some((c) => c.group)) g[s.source_id] = await srcGroupFolders(folder, s.source_id)
    }
    setGroups(g)
    setList(srcs)
  }, [folder])
  // load() sets state only after its bridge calls return.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])
  const remove = async (s) => {
    if (!window.confirm(`Remove “${s.source.title}” from ${lastSegment(folder)}? Your papers aren’t changed.`)) return
    await srcFolderDetach(folder, s.source_id)
    await load()
    onDone({ removed: true })
  }
  const setGroup = async (sid, group, value) => {
    await srcSetGroupFolder(folder, sid, group, value)
    await load()
    onDone({ regrouped: true })
  }
  const Icon = (k) => (k === 'pdf' ? BookOpen : k === 'web' ? Globe : Paperclip)
  return (
    <div className="modal" style={{ width: 600, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
      <div className="modal-title"><Paperclip size={17} /> Sources in “{lastSegment(folder)}”</div>
      {!list ? <div className="fs-loading" style={{ height: 80 }}><Loader2 size={16} className="spin" /></div>
        : !list.length ? <p className="settings-field-hint">Nothing is attached to this folder yet.</p>
        : list.map((s) => {
          const I = Icon(s.source.kind)
          const chs = (s.chapters || []).filter((c) => !c.skip)
          const linked = chs.filter((c) => c.paper_id).length
          return (
            <div key={s.source_id} className="fs-file" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
              <I size={15} />
              <div style={{ flex: 1, minWidth: 0 }}>{s.source.title}<small>{chs.length ? `${linked} of ${chs.length} chapters have a paper` : 'Whole file for every paper in the folder'}</small></div>
              <button className="icon-btn" title="Remove from this folder" onClick={() => remove(s)}><Trash2 size={14} /></button>
              {groups[s.source_id]?.groups?.length > 0 && (
                <div style={{ flexBasis: '100%', marginTop: 8 }}>
                  <div className="fs-hint" style={{ marginTop: 0 }}>Where each learning path lives</div>
                  {groups[s.source_id].groups.map((g) => {
                    const info = groups[s.source_id]
                    const pinned = Object.prototype.hasOwnProperty.call(info.pinned || {}, g)
                    return (
                      <div key={g} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 8, alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{g}</span>
                        <GroupFolderSelect folder={folder} group={g} allowNew={false} subfolders={info.subfolders || []}
                          auto={pinned ? null : (info.map?.[g] || '')} value={pinned ? info.pinned[g] : 'auto'}
                          onChange={(v) => setGroup(s.source_id, g, v)} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      <div className="modal-actions"><button className="modal-btn" onClick={onClose}>Close</button></div>
    </div>
  )
}

export default function FolderSourceDialog({ folder, mode, onClose, onDone }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      {mode === 'book' && <BookDialog folder={folder} onClose={onClose} onDone={onDone} />}
      {mode === 'web' && <WebDialog folder={folder} onClose={onClose} onDone={onDone} />}
      {mode === 'manage' && <ManageDialog folder={folder} onClose={onClose} onDone={onDone} />}
    </div>
  )
}
