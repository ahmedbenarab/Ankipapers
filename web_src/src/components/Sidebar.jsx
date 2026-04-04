import React, { useState, useCallback, useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, FileText, Folder, FolderOpen, ChevronRight, ChevronDown, Trash2, Heart, ExternalLink, Search, Home, X, Settings } from 'lucide-react'
import { openUrl, searchPapers } from '../bridge'

const MAX_FOLDER_DEPTH = 3

export default function Sidebar({ papers, folders, activePaperId, onSelectPaper, onCreatePaper, onDeletePaper, onCreateFolder, onMovePaper, onSelectFolder, selectedFolder, onGoHome, onOpenSettings }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set())
  const [creatingIn, setCreatingIn] = useState(null)
  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState(null)
  const [dragOverTarget, setDragOverTarget] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const searchTimer = useRef(null)

  const handleSearchChange = useCallback((q) => {
    setSearchQuery(q)
    clearTimeout(searchTimer.current)
    if (!q.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(async () => {
      const results = await searchPapers(q)
      setSearchResults(results)
    }, 250)
  }, [])

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

  // ─── Drag & Drop ──────────────────────────────────
  const handleDragStart = (e, paper) => {
    e.dataTransfer.setData('text/plain', paper.id)
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const handleDragOver = (e, targetId) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(targetId)
  }

  const handleDragLeave = (e) => {
    e.stopPropagation()
    setDragOverTarget(null)
  }

  const handleDrop = (e, folderPath) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverTarget(null)
    const paperId = e.dataTransfer.getData('text/plain')
    if (paperId && onMovePaper) {
      onMovePaper(paperId, folderPath)
    }
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
      onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, paper }) }}
      draggable="true"
      onDragStart={e => handleDragStart(e, paper)}
    >
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
              onClick={() => { toggleExpand(folder.path); onSelectFolder?.(folder.path) }}
              onDragOver={e => handleDragOver(e, folder.path)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, folder.path)}
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown size={14} className="tree-chevron" /> : <ChevronRight size={14} className="tree-chevron" />
              ) : <span style={{ width: 14 }} />}
              {isExpanded ? <FolderOpen size={14} className="tree-icon folder-icon" /> : <Folder size={14} className="tree-icon folder-icon" />}
              <span className="tree-item-label">{folder.name}</span>
              <span className="tree-item-count">{folderPapers.length}</span>
              <div className="tree-item-actions" onClick={e => e.stopPropagation()}>
                <button className="tree-action-btn" title="New paper" onClick={() => startCreating('paper', folder.path)}>
                  <FilePlus size={12} />
                </button>
                {depth + 1 < MAX_FOLDER_DEPTH && (
                  <button className="tree-action-btn" title="New sub-folder" onClick={() => startCreating('folder', folder.path)}>
                    <FolderPlus size={12} />
                  </button>
                )}
              </div>
            </div>
            {isExpanded && (
              <div className="tree-children">
                {renderFolderTree(folder, depth + 1)}
                <CreateInline parentPath={folder.path} />
                {folderPapers.map(p => <PaperItem key={p.id} paper={p} depth={depth + 1} />)}
              </div>
            )}
          </div>
        )
      })
  }

  return (
    <div className="sidebar">
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
          <button className="sidebar-btn" onClick={() => startCreating('paper', '')}>
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
        <div style={{ position: 'relative' }}>
          <input
            className="sidebar-search-input"
            placeholder="Search papers..."
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults(null) }}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-tree">
        {searchResults != null ? (
          <>
            <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
              {searchResults.length} RESULT{searchResults.length !== 1 ? 'S' : ''}
            </div>
            {searchResults.map(r => (
              <div key={r.id} className={`tree-item ${activePaperId === r.id ? 'active' : ''}`}
                style={{ paddingLeft: 12 }} onClick={() => { onSelectPaper(r.id); setSearchQuery(''); setSearchResults(null) }}>
                <FileText size={14} className="tree-icon" />
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <div className="tree-item-label">{r.title}</div>
                  {r.snippet && <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.snippet}</div>}
                </div>
              </div>
            ))}
            {searchResults.length === 0 && (
              <div className="tree-empty">No results for "{searchQuery}"</div>
            )}
          </>
        ) : (
          <>
        {/* Folders always render first */}
        {renderFolderTree(folders)}

        {/* Root papers area — accepts drops back to root */}
        <div
          className={`root-papers-area ${dragOverTarget === '__root__' ? 'drag-over' : ''}`}
          onDragOver={e => handleDragOver(e, '__root__')}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, '')}
        >
          <CreateInline parentPath="" />
          {(papersByFolder[''] || []).map(p => <PaperItem key={p.id} paper={p} />)}
          {papers.length === 0 && (
            <div className="tree-empty">No papers yet. Click "+ Paper" to start.</div>
          )}
        </div>
        </>
        )}
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
          <span className="kofi-sub">on Ko-fi</span>
        </div>
        <ExternalLink size={12} />
      </a>

      {contextMenu && (
        <>
          <div className="context-backdrop" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="context-item danger" onClick={() => {
              if (confirm(`Delete "${contextMenu.paper.title}"?`)) onDeletePaper(contextMenu.paper.id)
              setContextMenu(null)
            }}>
              <Trash2 size={13} />
              <span>Delete Paper</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
