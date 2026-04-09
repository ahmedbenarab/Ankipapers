import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { FilePlus, FolderPlus, FileText, Folder, FolderOpen, ChevronRight, ChevronDown, Trash2, Pencil, ExternalLink, Home, X, Settings, CornerUpLeft, Search } from 'lucide-react'

const FOLDER_ICON_SIZE = 17
const FOLDER_CHEVRON_SIZE = 16
import { openUrl, searchPapers } from '../bridge'

const MAX_FOLDER_DEPTH = 3

const DND_MIME = 'application/x-ankipapers-drag'

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

export default function Sidebar({ papers, folders, activePaperId, onSelectPaper, onCreatePaper, onDeletePaper, onCreateFolder, onMovePaper, onMoveFolder, onSelectFolder, selectedFolder, onGoHome, onOpenSettings, onDeleteFolder, onRenameFolder }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set())
  const [creatingIn, setCreatingIn] = useState(null)
  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState(null)
  const [dragOverTarget, setDragOverTarget] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false)
  const [searchPopoverPos, setSearchPopoverPos] = useState({ top: 0, left: 0, width: 280 })
  const searchTimer = useRef(null)
  const dragPayloadRef = useRef(null)
  const searchTriggerRef = useRef(null)
  const searchPopoverRef = useRef(null)
  const searchInputRef = useRef(null)

  const handleSearchChange = useCallback((q) => {
    setSearchQuery(q)
    clearTimeout(searchTimer.current)
    if (!q.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(async () => {
      const results = await searchPapers(q)
      setSearchResults(results)
    }, 250)
  }, [])

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
    const q = searchQuery.trim()
    if (q) {
      clearTimeout(searchTimer.current)
      searchTimer.current = window.setTimeout(async () => {
        const results = await searchPapers(q)
        setSearchResults(results)
      }, 0)
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

  const selectSearchResult = useCallback((id) => {
    onSelectPaper(id)
    setSearchQuery('')
    setSearchResults(null)
    setSearchPopoverOpen(false)
  }, [onSelectPaper])

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
  const PaperItem = ({ paper, depth = 0 }) => (
    <div
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
        const hasChildren = (folder.children?.length || 0) > 0 || folderPapers.length > 0
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
                {folderPapers.map(p => <PaperItem key={p.id} paper={p} depth={depth + 1} />)}
              </div>
            </div>
          </div>
        )
      })
  }

  return (
    <div className="sidebar" onDragEnd={endSidebarDrag}>
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

      <div className="sidebar-search">
        <button
          type="button"
          ref={searchTriggerRef}
          className="sidebar-search-trigger"
          onClick={() => setSearchPopoverOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={searchPopoverOpen}
        >
          <Search size={16} className="sidebar-search-trigger-icon" strokeWidth={2} aria-hidden />
          <span className="sidebar-search-trigger-text">{searchQuery.trim() ? searchQuery : 'Search papers…'}</span>
        </button>
      </div>

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
            aria-label="Search papers"
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
                  placeholder="title:, folder:, tag:, &quot;phrase&quot;, -exclude, OR"
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  aria-label="Search query"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="sidebar-search-clear"
                    onClick={() => { setSearchQuery(''); setSearchResults(null) }}
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
                <div className="sidebar-search-popover-hint">Type to search titles, content, folders, decks, and tags.</div>
              )}
              {searchQuery.trim() && searchResults === null && (
                <div className="sidebar-search-popover-hint">Searching…</div>
              )}
              {searchQuery.trim() && searchResults !== null && (
                <>
                  <div className="sidebar-search-popover-results-header">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </div>
                  {searchResults.map(r => (
                    <div
                      key={r.id}
                      className={`tree-item search-result-row ${activePaperId === r.id ? 'active' : ''}`}
                      style={{ paddingLeft: 12 }}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectSearchResult(r.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectSearchResult(r.id)
                        }
                      }}
                    >
                      <span className="tree-chevron-spacer" style={{ width: FOLDER_CHEVRON_SIZE, flexShrink: 0 }} aria-hidden />
                      <FileText size={14} className="tree-icon" />
                      <div className="search-result-body">
                        <div className="tree-item-label">{r.title}</div>
                        <div className="search-result-meta">
                          {r.snippet && <div className="search-snippet">{r.snippet}</div>}
                          <div className="search-result-foot">
                            {(r.folder_path || r.deck_name) && (
                              <span className="search-result-loc">
                                {r.folder_path ? <span title="Folder">{r.folder_path}</span> : null}
                                {r.folder_path && r.deck_name ? ' · ' : null}
                                {r.deck_name ? <span title="Deck">{r.deck_name}</span> : null}
                              </span>
                            )}
                            <SearchMatchBadges result={r} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {searchResults.length === 0 && (
                    <div className="sidebar-search-popover-empty">No results for &quot;{searchQuery}&quot;</div>
                  )}
                </>
              )}
            </div>
            <details className="sidebar-search-syntax sidebar-search-syntax--popover">
              <summary>Search syntax</summary>
              <ul>
                <li><code>word1 word2</code> — all words must match (title, content, folder, deck, or tags).</li>
                <li><code>&quot;exact phrase&quot;</code> — substring in those fields.</li>
                <li><code>title:</code>, <code>content:</code>, <code>folder:</code>, <code>deck:</code>, <code>tag:</code> — limit to one field; quote values with spaces.</li>
                <li><code>-word</code> or <code>-folder:Name</code> — exclude matches.</li>
                <li><code>mito OR ATP</code> — either side can match (each side is its own AND group).</li>
              </ul>
            </details>
          </div>
        </>
      )}

      <div className="sidebar-tree">
        {renderFolderTree(folders)}

        <div
          className={`root-papers-area ${dragOverTarget === '__root__' ? 'drag-over' : ''}`}
          onDragOver={e => handleItemDragOver(e, '__root__')}
          onDragLeave={handleItemDragLeave}
          onDrop={e => handleItemDrop(e, '__root__')}
        >
          <CreateInline parentPath="" />
          {(papersByFolder[''] || []).map(p => <PaperItem key={p.id} paper={p} />)}
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
}
