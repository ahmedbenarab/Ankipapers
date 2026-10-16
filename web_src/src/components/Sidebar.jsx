import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { FilePlus, FolderPlus, FileText, Folder, FolderOpen, ChevronRight, ChevronDown, Trash2, Pencil, ExternalLink, Home, X, Settings, CornerUpLeft, Search, PanelLeftClose, PanelLeftOpen, Zap, ListTree, BookOpen, Globe, Paperclip, Share } from 'lucide-react'
import OutlinePanel from './OutlinePanel'

// Hovering the rail slides the tree out; both numbers are deliberate. 260ms in
// means crossing the rail on the way somewhere else does not open it, and
// 200ms out means a diagonal flick from rail to panel does not close it.
const PEEK_OPEN_MS = 260
const PEEK_CLOSE_MS = 200

const FOLDER_ICON_SIZE = 17
const FOLDER_CHEVRON_SIZE = 16
import { openUrl, searchPapers } from '../bridge'
import { searchPapersAdvanced } from '../searchQuery'

const MAX_FOLDER_DEPTH = 10

const DND_MIME = 'application/x-ankipapers-drag'

// The search lists one row per matching line (see core/search_query.py),
// capped so a very common word doesn't flood the popover.
const MAX_SEARCH_ROWS = 200

function searchRows(results) {
  const rows = []
  let total = 0
  for (const r of results) {
    if (r.lines && r.lines.length) {
      total += r.lines_total ?? r.lines.length
      // Papers often open with an H1 that repeats their title; don't say it twice.
      const title = (r.title || '').trim().toLowerCase()
      for (const h of r.lines) {
        const path = (h.path || []).filter((crumb, i) => !(i === 0 && crumb.trim().toLowerCase() === title))
        if (rows.length < MAX_SEARCH_ROWS) rows.push({ key: `${r.id}:${h.line}`, result: r, line: h.line, path })
      }
    } else {
      // Matched on its title, folder, deck or tags only: no line to point at.
      total += 1
      if (rows.length < MAX_SEARCH_ROWS) rows.push({ key: r.id, result: r, line: null, path: [] })
    }
  }
  return { rows, total }
}

function SearchMatchBadges({ result }) {
  const bits = [
    result.title_match && { k: 'title', t: 'Title' },
    result.content_match && { k: 'content', t: 'Content' },
    result.folder_match && { k: 'folder', t: 'Folder' },
    result.deck_match && { k: 'deck', t: 'Deck' },
    result.tag_match && { k: 'tag', t: 'Tag' },
  ].filter(Boolean)
  if (!bits.length) return null
  return (
    <div className="search-match-badges">
      {bits.map(({ k, t }) => (
        <span key={k} className={`search-match-badge search-match-badge--${k}`} title={t}>{t}</span>
      ))}
    </div>
  )
}

export default function Sidebar({ papers, folders, activePaperId, onSelectPaper, onGoToLine, onCreatePaper, onDeletePaper, onCreateFolder, onMovePaper, onMoveFolder, onSelectFolder, selectedFolder, onGoHome, onOpenSettings, onDeleteFolder, onRenameFolder, onGenerateFolder, onShareFolder, collapsed = false, width = 260, onToggleCollapse, outline = null, outlineTitle = '', outlineCurrentLine = 0, onJumpToHeading, currentPaper = null, folderSources = {}, onFolderSource, onCreateWaitingChapter, showWaiting = false }) {
  // Papers (the folder tree) or Outline (the open paper's headings).
  const [tab, setTab] = useState('papers')
  const [peeking, setPeeking] = useState(false)
  const peekTimer = useRef(null)
  const [expandedFolders, setExpandedFolders] = useState(new Set())
  const [creatingIn, setCreatingIn] = useState(null)
  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState(null)
  const [dragOverTarget, setDragOverTarget] = useState(null)
  // Two searches, one per tab: Papers searches every paper (via Anki);
  // Outline searches only the open paper, in its current (unsaved) text.
  // Each keeps its own query, so switching tabs doesn't lose either.
  const [allQuery, setAllQuery] = useState('')
  const [allResults, setAllResults] = useState(null)
  const [paperQuery, setPaperQuery] = useState('')
  const inPaper = tab === 'outline'
  const paperName = (currentPaper?.title || '').trim() || 'Untitled'
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false)
  const [searchPopoverPos, setSearchPopoverPos] = useState({ top: 0, left: 0, width: 280 })
  const searchTimer = useRef(null)
  const dragPayloadRef = useRef(null)
  const searchTriggerRef = useRef(null)
  const searchPopoverRef = useRef(null)
  const searchInputRef = useRef(null)

  const beginPeek = useCallback(() => {
    clearTimeout(peekTimer.current)
    peekTimer.current = setTimeout(() => setPeeking(true), PEEK_OPEN_MS)
  }, [])
  const endPeek = useCallback(() => {
    clearTimeout(peekTimer.current)
    peekTimer.current = setTimeout(() => setPeeking(false), PEEK_CLOSE_MS)
  }, [])
  // A sidebar that is expanded again must not keep a stale peek open behind it.
  useEffect(() => {
    if (!collapsed) { clearTimeout(peekTimer.current); setPeeking(false) }
  }, [collapsed])
  useEffect(() => () => clearTimeout(peekTimer.current), [])

  // Within one paper, field filters (title:, folder:, deck:, tag:) have
  // nothing to choose between, so they're dropped before searching.
  // One paper searches instantly in the browser, so its results are simply
  // derived from the query and the paper's current text (and follow edits).
  const paperResults = useMemo(() => {
    const words = paperQuery.replace(/(^|\s)-?(title|folder|deck|tag):("[^"]*"|\S+)/gi, ' ').trim()
    if (!paperQuery.trim() || !currentPaper) return null
    return words ? searchPapersAdvanced([currentPaper], words) : []
  }, [paperQuery, currentPaper])

  const searchQuery = inPaper ? paperQuery : allQuery
  const searchResults = inPaper ? paperResults : allResults

  const runAllSearch = useCallback(async (q) => {
    setAllResults(await searchPapers(q))
  }, [])

  const handleSearchChange = useCallback((q) => {
    if (inPaper) { setPaperQuery(q); return }
    setAllQuery(q)
    clearTimeout(searchTimer.current)
    if (!q.trim()) { setAllResults(null); return }
    searchTimer.current = setTimeout(() => runAllSearch(q), 250)
  }, [inPaper, runAllSearch])

  const clearSearch = useCallback(() => {
    if (inPaper) { setPaperQuery(''); return }
    setAllQuery('')
    setAllResults(null)
  }, [inPaper])

  const updateSearchPopoverPosition = useCallback(() => {
    const el = searchTriggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, 268)
    let left = r.left
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
    const maxH = 420
    let top = r.bottom + 8
    if (top + maxH > window.innerHeight - 8) top = Math.max(8, r.top - maxH - 8)
    setSearchPopoverPos({ top, left, width })
  }, [])

  useLayoutEffect(() => {
    if (!searchPopoverOpen) return
    updateSearchPopoverPosition()
    const onResize = () => updateSearchPopoverPosition()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [searchPopoverOpen, updateSearchPopoverPosition])

  useEffect(() => {
    if (!searchPopoverOpen) return
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    const q = allQuery.trim()
    if (q && !inPaper) {
      clearTimeout(searchTimer.current)
      searchTimer.current = window.setTimeout(() => runAllSearch(q), 0)
    }
    return () => clearTimeout(t)
  }, [searchPopoverOpen])

  useEffect(() => {
    if (!searchPopoverOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSearchPopoverOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchPopoverOpen])

  const closeSearchPopover = useCallback(() => setSearchPopoverOpen(false), [])

  const selectSearchResult = useCallback((id, line = null) => {
    if (line != null && onGoToLine) onGoToLine(id, line)
    else onSelectPaper(id)
    clearSearch()
    setSearchPopoverOpen(false)
  }, [onSelectPaper, onGoToLine, clearSearch])

  const toggleExpand = (path) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    if (creatingIn.type === 'paper') {
      onCreatePaper(newName.trim(), creatingIn.parentPath)
    } else {
      onCreateFolder(newName.trim(), creatingIn.parentPath)
    }
    setNewName('')
    setCreatingIn(null)
  }

  const startCreating = (type, parentPath = '') => {
    setCreatingIn({ type, parentPath })
    setNewName('')
    if (parentPath) setExpandedFolders(prev => new Set(prev).add(parentPath))
  }

  const totalCards = papers.reduce((sum, p) => sum + (p.card_refs?.length || 0), 0)
  const papersByFolder = {}
  papers.forEach(p => {
    const f = p.folder_path || ''
    if (!papersByFolder[f]) papersByFolder[f] = []
    papersByFolder[f].push(p)
  })

  // Sort papers alphabetically within each folder
  Object.values(papersByFolder).forEach(folderPapers => {
    folderPapers.sort((a, b) => 
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    )
  })

  // ─── Drag & Drop (papers + folders) ─────────────────

  // ─── Drag & Drop (papers + folders) ─────────────────
  const endSidebarDrag = useCallback(() => {
    dragPayloadRef.current = null
    setDragOverTarget(null)
  }, [])

  const handlePaperDragStart = (e, paper) => {
    dragPayloadRef.current = { kind: 'paper', id: paper.id }
    e.dataTransfer.setData(DND_MIME, JSON.stringify(dragPayloadRef.current))
    e.dataTransfer.setData('text/plain', paper.id)
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const handleFolderDragStart = (e, folder) => {
    dragPayloadRef.current = { kind: 'folder', path: folder.path }
    e.dataTransfer.setData(DND_MIME, JSON.stringify(dragPayloadRef.current))
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const folderDropInvalid = (srcPath, targetKey) => {
    const newParent = targetKey === '__root__' ? '' : targetKey
    const srcParent = srcPath.includes('/') ? srcPath.slice(0, srcPath.lastIndexOf('/')) : ''
    if (newParent === srcPath) return true
    if (newParent.startsWith(srcPath + '/')) return true
    if (newParent === srcParent) return true
    return false
  }

  const handleItemDragOver = (e, targetKey) => {
    e.preventDefault()
    e.stopPropagation()
    const p = dragPayloadRef.current
    if (p?.kind === 'folder' && p.path && folderDropInvalid(p.path, targetKey)) {
      e.dataTransfer.dropEffect = 'none'
      setDragOverTarget(null)
      return
    }
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(targetKey)
  }

  const handleItemDragLeave = (e) => {
    e.stopPropagation()
    setDragOverTarget(null)
  }

  const handleItemDrop = (e, targetKey) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverTarget(null)
    let payload = null
    try {
      const raw = e.dataTransfer.getData(DND_MIME)
      payload = raw ? JSON.parse(raw) : null
    } catch (_) { /* ignore */ }
    const paperIdFallback = e.dataTransfer.getData('text/plain')
    const newParent = targetKey === '__root__' ? '' : targetKey

    if (payload?.kind === 'folder' && payload.path && onMoveFolder) {
      if (!folderDropInvalid(payload.path, targetKey)) {
        onMoveFolder(payload.path, newParent)
      }
      endSidebarDrag()
      return
    }

    const paperId = payload?.kind === 'paper' ? payload.id : paperIdFallback
    if (paperId && onMovePaper) {
      onMovePaper(paperId, newParent)
    }
    endSidebarDrag()
  }

  // ─── Inline create form ───────────────────────────
  const CreateInline = ({ parentPath }) => (
    creatingIn && creatingIn.parentPath === parentPath ? (
      <div className="create-inline">
        <input
          className="create-inline-input"
          placeholder={creatingIn.type === 'paper' ? 'Paper title...' : 'Folder name...'}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleCreate()
            if (e.key === 'Escape') setCreatingIn(null)
          }}
          autoFocus
        />
      </div>
    ) : null
  )

  // ─── Paper Item ───────────────────────────────────
  // A render function, not a component: a component defined in here is a new
  // type on every render, so React would replace the row's DOM each time --
  // including the row being dragged, the moment a dragover re-renders the
  // sidebar, which makes Chromium cancel the drag.
  const renderPaperItem = (paper, depth = 0) => (
    <div
      key={paper.id}
      className={`tree-item ${activePaperId === paper.id ? 'active' : ''}`}
      style={{ paddingLeft: 12 + depth * 16 }}
      onClick={() => onSelectPaper(paper.id)}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'paper', paper }) }}
      draggable="true"
      onDragStart={e => handlePaperDragStart(e, paper)}
    >
      <span className="tree-chevron-spacer" style={{ width: FOLDER_CHEVRON_SIZE, flexShrink: 0 }} aria-hidden />
      <FileText size={14} className="tree-icon" />
      <span className="tree-item-label">{paper.title}</span>
      {(paper.card_refs?.length || 0) > 0 && (
        <span className="tree-item-badge">{paper.card_refs.length}</span>
      )}
    </div>
  )

  // ─── Folder Item ──────────────────────────────────
  const renderFolderTree = (node, depth = 0) => {
    if (!node?.children) return null
    return node.children
      .filter(c => c.type === 'folder')
      .map(folder => {
        const isExpanded = expandedFolders.has(folder.path)
        const isSelected = selectedFolder === folder.path
        const folderPapers = papersByFolder[folder.path] || []
        // Chapters of a folder book or course still waiting for a paper, shown
        // in the folder their paper belongs in (a learning path's sub-folder).
        // Settings → Sources → "Show chapters waiting for a paper" (off by default).
        const waiting = showWaiting ? (folderSources.waiting?.[folder.path] || []) : []
        const hasChildren = (folder.children?.length || 0) > 0 || folderPapers.length > 0 || waiting.length > 0
        const isDragOver = dragOverTarget === folder.path

        return (
          <div key={folder.path}>
            <div
              className={`tree-item tree-folder ${isSelected ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
              style={{ paddingLeft: 12 + depth * 16 }}
              draggable
              onDragStart={e => handleFolderDragStart(e, folder)}
              onClick={() => { toggleExpand(folder.path); onSelectFolder?.(folder.path) }}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folder })
              }}
              onDragOver={e => handleItemDragOver(e, folder.path)}
              onDragLeave={handleItemDragLeave}
              onDrop={e => handleItemDrop(e, folder.path)}
            >
              {hasChildren ? (
                <ChevronRight 
                  size={FOLDER_CHEVRON_SIZE} 
                  className={`tree-chevron ${isExpanded ? 'expanded' : ''}`} 
                />
              ) : <span style={{ width: FOLDER_CHEVRON_SIZE, flexShrink: 0 }} />}
              {isExpanded ? <FolderOpen size={FOLDER_ICON_SIZE} className="tree-icon folder-icon active" /> : <Folder size={FOLDER_ICON_SIZE} className="tree-icon folder-icon" />}
              <span className="tree-item-label">{folder.name}</span>
              {folderSources.folders?.[folder.path] && (() => {
                const k = folderSources.folders[folder.path].kinds || []
                const SrcIcon = k.includes('web') ? Globe : k.includes('pdf') ? BookOpen : Paperclip
                return <SrcIcon size={12} className="folder-src-icon" title="This folder has sources" />
              })()}
              <span className="tree-item-count">{folderPapers.length}</span>
              <div className="tree-item-actions" draggable={false} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                <button className="tree-action-btn" title="New paper" onClick={() => onCreatePaper('Untitled', folder.path)}>
                  <FilePlus size={12} />
                </button>
                {depth + 1 < MAX_FOLDER_DEPTH && (
                  <button className="tree-action-btn" title="New sub-folder" onClick={() => startCreating('folder', folder.path)}>
                    <FolderPlus size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className={`tree-children ${isExpanded ? 'expanded' : ''}`}>
              <div className="tree-children-inner">
                {renderFolderTree(folder, depth + 1)}
                <CreateInline parentPath={folder.path} />
                {folderPapers.map(p => renderPaperItem(p, depth + 1))}
                {onCreateWaitingChapter && waiting.map((w) => (
                  <div key={w.source_id + w.key} className="tree-item sidebar-ghost" style={{ paddingLeft: 12 + (depth + 1) * 16 }}
                    title={`Waiting for a paper. Click to create “${w.title}”, already linked to its chapter.`}
                    onClick={() => onCreateWaitingChapter(w.folder, w)}>
                    <span className="tree-chevron-spacer" style={{ width: FOLDER_CHEVRON_SIZE, flexShrink: 0 }} aria-hidden />
                    <FilePlus size={14} className="tree-icon" />
                    <span className="tree-item-label">{w.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })
  }

  // The folder filter is what makes collapsing risky: with the tree hidden,
  // "new paper goes into the selected folder" becomes invisible state. The
  // rail carries a dot and says so in its tooltip rather than clearing the
  // filter behind your back.
  const filterTitle = selectedFolder
    ? `Folder filter: ${selectedFolder} — new papers from the Home screen go here. Click to show the tree.`
    : 'No folder filter. Click to show the tree.'

  const rail = (
    <div
      className="sidebar-rail"
      onMouseEnter={beginPeek}
      onMouseLeave={endPeek}
      aria-label="Sidebar, collapsed"
    >
      <button type="button" className="sidebar-rail-btn" onClick={onToggleCollapse}
              title="Show sidebar (Ctrl+\)">
        <PanelLeftOpen size={18} />
      </button>
      <div className="sidebar-rail-sep" />
      <button type="button" className="sidebar-rail-btn" onClick={onGoHome} title="Home">
        <Home size={18} />
      </button>
      <button
        type="button"
        className="sidebar-rail-btn"
        onClick={() => { onToggleCollapse?.(); setSearchPopoverOpen(true) }}
        title="Search papers"
      >
        <Search size={18} />
      </button>
      <button
        type="button"
        className="sidebar-rail-btn"
        onClick={() => { setTab('outline'); onToggleCollapse?.() }}
        title="Outline of this paper"
      >
        <ListTree size={18} />
      </button>
      <button
        type="button"
        className={`sidebar-rail-btn${selectedFolder ? ' has-dot' : ''}`}
        onClick={onToggleCollapse}
        title={filterTitle}
      >
        {selectedFolder ? <FolderOpen size={18} /> : <Folder size={18} />}
      </button>
      <div className="sidebar-rail-sep" />
      <button type="button" className="sidebar-rail-btn"
              onClick={() => onCreatePaper('Untitled', '')} title="New paper">
        <FilePlus size={18} />
      </button>
      <button type="button" className="sidebar-rail-btn"
              onClick={() => { onToggleCollapse?.(); startCreating('folder', '') }}
              title="New folder">
        <FolderPlus size={18} />
      </button>
      <div className="sidebar-rail-spacer" />
      <button type="button" className="sidebar-rail-btn" onClick={onOpenSettings}
              title="Settings (Ctrl+,)">
        <Settings size={18} />
      </button>
    </div>
  )

  const panel = (
    <div
      className={`sidebar${collapsed ? ' sidebar--peek' : ''}`}
      style={{ width }}
      onDragEnd={endSidebarDrag}
      onMouseEnter={collapsed ? beginPeek : undefined}
      onMouseLeave={collapsed ? endPeek : undefined}
    >
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-text">Anki Papers</span>
          <div className="sidebar-brand-icons">
            <button type="button" className="sidebar-home-btn" onClick={onGoHome} title="Home">
              <Home size={22} strokeWidth={1.75} />
            </button>
            <button type="button" className="sidebar-home-btn" onClick={onOpenSettings} title="Settings (Ctrl+,)">
              <Settings size={22} strokeWidth={1.75} />
            </button>
            <button type="button" className="sidebar-home-btn" onClick={onToggleCollapse}
                    title="Hide sidebar (Ctrl+\)">
              <PanelLeftClose size={22} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="sidebar-actions">
          <button className="sidebar-btn" onClick={() => onCreatePaper('Untitled', '')}>
            <FilePlus size={13} />
            <span>Paper</span>
          </button>
          <button className="sidebar-btn" onClick={() => startCreating('folder', '')}>
            <FolderPlus size={13} />
            <span>Folder</span>
          </button>
        </div>
      </div>

      <div className="sidebar-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'papers'}
          className={tab === 'papers' ? 'active' : ''} onClick={() => setTab('papers')}>
          <Folder size={13} /> Papers
        </button>
        <button type="button" role="tab" aria-selected={tab === 'outline'}
          className={tab === 'outline' ? 'active' : ''} onClick={() => setTab('outline')}>
          <ListTree size={13} /> Outline
        </button>
      </div>

      <div className="sidebar-search">
        <button
          type="button"
          ref={searchTriggerRef}
          className="sidebar-search-trigger"
          onClick={() => setSearchPopoverOpen(true)}
          disabled={inPaper && !currentPaper}
          aria-haspopup="dialog"
          aria-expanded={searchPopoverOpen}
        >
          <Search size={16} className="sidebar-search-trigger-icon" strokeWidth={2} aria-hidden />
          <span className="sidebar-search-trigger-text">
            {searchQuery.trim()
              ? searchQuery
              : inPaper
                ? (currentPaper ? `Search ${paperName}…` : 'Open a paper to search it')
                : 'Search papers…'}
          </span>
        </button>
      </div>

      {tab === 'outline' && (
        <OutlinePanel
          items={outline}
          title={outlineTitle}
          totalCards={papers.find((p) => p.id === activePaperId)?.card_refs?.length || 0}
          currentLine={outlineCurrentLine}
          onJump={onJumpToHeading}
        />
      )}


      {searchPopoverOpen && (
        <>
          <div
            className="sidebar-search-backdrop"
            aria-hidden
            onClick={closeSearchPopover}
          />
          <div
            ref={searchPopoverRef}
            className="sidebar-search-popover"
            role="dialog"
            aria-label={inPaper ? `Search ${paperName}` : 'Search papers'}
            style={{
              top: searchPopoverPos.top,
              left: searchPopoverPos.left,
              width: searchPopoverPos.width,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="sidebar-search-popover-head">
              <Search size={16} className="sidebar-search-popover-head-icon" aria-hidden />
              <div className="sidebar-search-input-wrap sidebar-search-input-wrap--popover">
                <input
                  ref={searchInputRef}
                  className="sidebar-search-input sidebar-search-input--popover"
                  placeholder={inPaper ? `Search ${paperName}: words, "phrase", -exclude, OR` : 'title:, folder:, tag:, "phrase", -exclude, OR'}
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  aria-label="Search query"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="sidebar-search-clear"
                    onClick={clearSearch}
                    title="Clear"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="sidebar-search-popover-close"
                onClick={closeSearchPopover}
                title="Close (Esc)"
              >
                <X size={16} />
              </button>
            </div>
            <div className="sidebar-search-popover-results">
              {!searchQuery.trim() && (
                <div className="sidebar-search-popover-hint">
                  {inPaper ? `Type to search ${paperName}. Only this paper is searched.` : 'Type to search titles, content, folders, decks, and tags.'}
                </div>
              )}
              {searchQuery.trim() && searchResults === null && (
                <div className="sidebar-search-popover-hint">Searching…</div>
              )}
              {searchQuery.trim() && searchResults !== null && (() => {
                // In one paper, only line hits mean anything (the title-only
                // row would just point back at the paper you're in).
                const { rows: allRows, total: allTotal } = searchRows(searchResults)
                const rows = inPaper ? allRows.filter((r) => r.line != null) : allRows
                const total = inPaper ? searchResults.reduce((n, r) => n + (r.lines_total || 0), 0) : allTotal
                return (
                <>
                  <div className="sidebar-search-popover-results-header">
                    {total} result{total !== 1 ? 's' : ''}
                    {inPaper ? ` in ${paperName}` : searchResults.length > 0 && ` in ${searchResults.length} paper${searchResults.length !== 1 ? 's' : ''}`}
                    {total > rows.length && ` · showing the first ${rows.length}`}
                  </div>
                  {rows.map(({ key, result: r, line, path }) => (
                    <div
                      key={key}
                      className={`tree-item search-result-row ${line == null && activePaperId === r.id ? 'active' : ''}`}
                      style={{ paddingLeft: 12 }}
                      role="button"
                      tabIndex={0}
                      title={[r.folder_path, r.deck_name].filter(Boolean).join(' · ') || undefined}
                      onClick={() => selectSearchResult(r.id, line)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectSearchResult(r.id, line)
                        }
                      }}
                    >
                      <span className="tree-chevron-spacer" style={{ width: FOLDER_CHEVRON_SIZE, flexShrink: 0 }} aria-hidden />
                      <FileText size={14} className="tree-icon" />
                      <div className="search-result-body">
                        {/* Document › H1 › H2 › H3 · line N */}
                        {/* (H1 › H2 › H3 · line N when searching just this paper) */}
                        <div className="search-result-path">
                          {!inPaper && <span className="search-result-doc">{r.title || 'Untitled'}</span>}
                          {path.map((h, i) => (
                            <React.Fragment key={i}>
                              {(i > 0 || !inPaper) && <span className="search-result-sep" aria-hidden> › </span>}
                              <span className={inPaper && i === 0 ? 'search-result-doc' : 'search-result-heading'}>{h}</span>
                            </React.Fragment>
                          ))}
                          {line != null && (
                            <span className="search-result-line">{inPaper && path.length === 0 ? `Line ${line + 1}` : ` · line ${line + 1}`}</span>
                          )}
                        </div>
                        {line == null && <SearchMatchBadges result={r} />}
                      </div>
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <div className="sidebar-search-popover-empty">No results for &quot;{searchQuery}&quot;{inPaper ? ` in ${paperName}` : ''}</div>
                  )}
                </>
                )
              })()}
            </div>
            <details className="sidebar-search-syntax sidebar-search-syntax--popover">
              <summary>Search syntax</summary>
              {inPaper ? (
                <ul>
                  <li><code>word1 word2</code> — lines in this paper containing those words.</li>
                  <li><code>&quot;exact phrase&quot;</code> — an exact phrase.</li>
                  <li><code>-word</code> — leave out a word.</li>
                  <li><code>mito OR ATP</code> — either side can match.</li>
                </ul>
              ) : (
                <ul>
                  <li><code>word1 word2</code> — all words must match (title, content, folder, deck, or tags).</li>
                  <li><code>&quot;exact phrase&quot;</code> — substring in those fields.</li>
                  <li><code>title:</code>, <code>content:</code>, <code>folder:</code>, <code>deck:</code>, <code>tag:</code> — limit to one field; quote values with spaces.</li>
                  <li><code>-word</code> or <code>-folder:Name</code> — exclude matches.</li>
                  <li><code>mito OR ATP</code> — either side can match (each side is its own AND group).</li>
                </ul>
              )}
            </details>
          </div>
        </>
      )}

      <div className="sidebar-tree" style={tab === 'outline' ? { display: 'none' } : undefined}>
        {renderFolderTree(folders)}

        <div
          className={`root-papers-area ${dragOverTarget === '__root__' ? 'drag-over' : ''}`}
          onDragOver={e => handleItemDragOver(e, '__root__')}
          onDragLeave={handleItemDragLeave}
          onDrop={e => handleItemDrop(e, '__root__')}
        >
          <CreateInline parentPath="" />
          {(papersByFolder[''] || []).map(p => renderPaperItem(p))}
          {papers.length === 0 && (
            <div className="tree-empty">No papers yet. Click "+ Paper" to start.</div>
          )}
        </div>
      </div>

      <div className="sidebar-stats">{papers.length} papers · {totalCards} cards</div>

      <a
        className="kofi-banner"
        href="#"
        onClick={e => {
          e.preventDefault()
          openUrl('https://ko-fi.com/ankizium')
        }}
      >
        <div className="kofi-icon">☕</div>
        <div className="kofi-text">
          <span className="kofi-label">Support Ankizium</span>
          <span className="kofi-sub"> to further develop this project on Ko-fi</span>
        </div>
        <ExternalLink size={12} />
      </a>

      {contextMenu && (
        <>
          <div className="context-backdrop" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextMenu.type === 'paper' && (
              <div className="context-item danger" onClick={() => {
                if (confirm(`Delete "${contextMenu.paper.title}"?`)) onDeletePaper(contextMenu.paper.id)
                setContextMenu(null)
              }}>
                <Trash2 size={13} />
                <span>Delete Paper</span>
              </div>
            )}
            {contextMenu.type === 'folder' && onRenameFolder && onDeleteFolder && (
              <>
                {onGenerateFolder && (
                  <>
                    <div className="context-item" onClick={() => {
                      const f = contextMenu.folder
                      setContextMenu(null)
                      onGenerateFolder(f.path)
                    }}>
                      <Zap size={13} />
                      <span>Generate all cards in folder</span>
                    </div>
                    {onShareFolder && (
                      <div className="context-item" title="Every paper in it and its subfolders, with their pictures, as one .zip"
                        onClick={() => { const f = contextMenu.folder; setContextMenu(null); onShareFolder(f.path) }}>
                        <Share size={13} />
                        <span>Share folder with pictures…</span>
                      </div>
                    )}
                    <div className="context-menu-sep" />
                  </>
                )}
                {onFolderSource && (
                  <>
                    <div className="context-menu-hint">Attach to everything in “{contextMenu.folder.name}”</div>
                    <div className="context-item" onClick={() => { const f = contextMenu.folder; setContextMenu(null); onFolderSource('book', f.path) }}>
                      <BookOpen size={13} />
                      <span>Attach a book…</span>
                    </div>
                    <div className="context-item" onClick={() => { const f = contextMenu.folder; setContextMenu(null); onFolderSource('web', f.path) }}>
                      <Globe size={13} />
                      <span>Attach a web source…</span>
                    </div>
                    <div className="context-item" onClick={() => { const f = contextMenu.folder; setContextMenu(null); onFolderSource('file', f.path) }}>
                      <Paperclip size={13} />
                      <span>Attach a file…</span>
                    </div>
                    {(folderSources.folders?.[contextMenu.folder.path]?.sources || []).length > 0 && (
                      <>
                        <div className="context-menu-sep" />
                        <div className="context-item" onClick={() => { const f = contextMenu.folder; setContextMenu(null); onFolderSource('manage', f.path) }}>
                          <Paperclip size={13} />
                          <span>Learning paths and sources…</span>
                        </div>
                        {folderSources.folders[contextMenu.folder.path].sources.map((src) => (
                          <div key={src.id} className="context-item danger" title="Your papers aren't changed"
                            onClick={() => { const f = contextMenu.folder; setContextMenu(null); onFolderSource('remove', f.path, src) }}>
                            <Trash2 size={13} />
                            <span className="context-item-ellipsis">Remove “{src.title}”</span>
                          </div>
                        ))}
                      </>
                    )}
                    <div className="context-menu-sep" />
                  </>
                )}
                <div className="context-item" onClick={() => {
                  const f = contextMenu.folder
                  const name = window.prompt('New folder name', f.name)
                  setContextMenu(null)
                  if (name == null) return
                  const trimmed = name.trim()
                  if (!trimmed || trimmed === f.name) return
                  onRenameFolder(f.path, trimmed)
                }}>
                  <Pencil size={13} />
                  <span>Rename</span>
                </div>
                {contextMenu.folder.path.includes('/') && onMoveFolder && (
                  <div className="context-item" onClick={() => {
                    const f = contextMenu.folder
                    setContextMenu(null)
                    onMoveFolder(f.path, '')
                  }}>
                    <CornerUpLeft size={13} />
                    <span>Move to root</span>
                  </div>
                )}
                <div className="context-menu-sep" />
                <div className="context-item danger" onClick={() => {
                  const f = contextMenu.folder
                  const isSelected = selectedFolder === f.path
                  const msg =
                    `Remove folder "${f.name}"?\n\n` +
                    `All subfolders inside it will be removed. Papers in this folder or any subfolder will move to the parent folder.` +
                    (isSelected ? `\n\nNote: This is the folder currently selected in the sidebar.` : '')
                  if (confirm(msg)) {
                    onDeleteFolder(f.path)
                  }
                  setContextMenu(null)
                }}>
                  <Trash2 size={13} />
                  <span>Remove folder</span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )

  if (!collapsed) return panel

  // Collapsed: the rail holds the layout space, and the tree floats over the
  // editor rather than pushing it, so peeking never reflows what you're
  // reading.
  return (
    <>
      {rail}
      {peeking && panel}
    </>
  )
}
