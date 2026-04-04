import React, { useState, useMemo, useCallback } from 'react'
import {
  FileText,
  Plus,
  Search,
  FileInput,
  Settings,
  Clock,
  FolderOpen,
  Sparkles,
  ChevronDown,
} from 'lucide-react'

function formatRelativeTime(modifiedAt) {
  const ts = typeof modifiedAt === 'number' ? modifiedAt : 0
  const sec = Math.floor(Date.now() / 1000 - ts)
  if (sec < 45) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

export default function WelcomeScreen({
  papers = [],
  selectedFolder = null,
  onSelectPaper,
  onCreatePaper,
  onImportMarkdown,
  onOpenSettings,
}) {
  const [newTitle, setNewTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const recentPapers = useMemo(() => {
    return [...papers].sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)).slice(0, 8)
  }, [papers])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return papers.filter((p) => {
      const title = (p.title || '').toLowerCase()
      const folder = (p.folder_path || '').toLowerCase()
      return title.includes(q) || folder.includes(q)
    }).slice(0, 12)
  }, [papers, searchQuery])

  const handleCreate = useCallback(() => {
    const title = newTitle.trim() || 'Untitled Paper'
    onCreatePaper?.(title, selectedFolder || '')
    setNewTitle('')
  }, [newTitle, onCreatePaper, selectedFolder])

  const folderHint =
    selectedFolder && selectedFolder.length > 0
      ? `New paper will be created in “${selectedFolder}” (sidebar folder filter).`
      : 'New paper goes to the library root unless a folder is selected in the sidebar.'

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-top">
          <div className="welcome-hero">
            <div className="welcome-icon">
              <FileText size={48} strokeWidth={1.5} />
            </div>
            <h1 className="welcome-title">Anki Papers</h1>
            <p className="welcome-subtitle">
              Write notes, create flashcards — all in one flow.
            </p>
            <div className="welcome-stats">
              <span className="welcome-stat">
                <Sparkles size={14} />
                {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
              </span>
            </div>
          </div>

          <div className="welcome-syntax-wrap">
            <section className="welcome-card welcome-syntax-card-centered">
              <h2 className="welcome-card-title welcome-card-title-center">
                <FileText size={16} /> Syntax cheat sheet
              </h2>
              <div className="welcome-syntax">
                <div>
                  <span className="syn-label">Basic card</span>{' '}
                  <span className="syn-basic">Question &gt;&gt; Answer</span>
                </div>
                <div>
                  <span className="syn-label">Reversible</span>{' '}
                  <span className="syn-reversible">Term &lt;&gt; Definition</span>
                </div>
                <div>
                  <span className="syn-label">Cloze</span>{' '}
                  <span className="syn-cloze">{'Text with {{cloze}} in it'}</span>
                </div>
                <div>
                  <span className="syn-label">Numbered cloze</span>{' '}
                  <span className="syn-cloze">{'{{c1::first}} and {{c2::second}}'}</span>
                </div>
                <div>
                  <span className="syn-label">Heading</span>{' '}
                  <span className="syn-heading"># Section Title</span>
                </div>
                <div>
                  <span className="syn-label">Image</span>{' '}
                  <span className="syn-key">![alt](filename)</span>
                </div>
                <div>
                  <span className="syn-label">Toggle view</span>{' '}
                  <span className="syn-key">Ctrl+Shift+V</span>
                </div>
                <div>
                  <span className="syn-label">Save / Generate</span>{' '}
                  <span className="syn-key">Ctrl+S</span> / <span className="syn-key">Ctrl+G</span>
                </div>
                <div>
                  <span className="syn-label">Settings</span>{' '}
                  <span className="syn-key">Ctrl+,</span>
                </div>
              </div>
            </section>
          </div>

          <p className="welcome-scroll-cue">
            <ChevronDown size={18} className="welcome-scroll-cue-icon" aria-hidden />
            Scroll down for quick start, search, and recent papers
          </p>
        </div>

        <div className="welcome-lower">
          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <Plus size={16} /> Quick start
            </h2>
            <p className="welcome-card-hint">{folderHint}</p>
            <div className="welcome-create-row">
              <input
                className="welcome-input"
                placeholder="Title for a new paper…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button type="button" className="welcome-btn welcome-btn-primary" onClick={handleCreate}>
                Create
              </button>
            </div>
            <div className="welcome-actions-row">
              <button type="button" className="welcome-btn welcome-btn-ghost" onClick={() => onImportMarkdown?.()}>
                <FileInput size={15} /> Import Markdown
              </button>
              <button type="button" className="welcome-btn welcome-btn-ghost" onClick={() => onOpenSettings?.()}>
                <Settings size={15} /> Settings
              </button>
            </div>
          </section>

          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <Search size={16} /> Find a paper
            </h2>
            <input
              className="welcome-input"
              placeholder="Search by title or folder…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.trim() && (
              <ul className="welcome-paper-list">
                {searchResults.length === 0 ? (
                  <li className="welcome-paper-empty">No matches</li>
                ) : (
                  searchResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="welcome-paper-btn"
                        onClick={() => onSelectPaper?.(p.id)}
                      >
                        <span className="welcome-paper-title">{p.title || 'Untitled'}</span>
                        {p.folder_path ? (
                          <span className="welcome-paper-meta">
                            <FolderOpen size={12} /> {p.folder_path}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </section>

          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <Clock size={16} /> Recently edited
            </h2>
            {recentPapers.length === 0 ? (
              <p className="welcome-card-hint">No papers yet. Use Quick start above or the sidebar.</p>
            ) : (
              <ul className="welcome-paper-list">
                {recentPapers.map((p) => {
                  const n = p.card_refs?.length ?? 0
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="welcome-paper-btn"
                        onClick={() => onSelectPaper?.(p.id)}
                      >
                        <span className="welcome-paper-title">{p.title || 'Untitled'}</span>
                        <span className="welcome-paper-meta">
                          {formatRelativeTime(p.modified_at)}
                          {n > 0 ? ` · ${n} card${n === 1 ? '' : 's'}` : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
