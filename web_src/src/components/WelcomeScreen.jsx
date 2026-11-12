import React, { useState, useMemo, useCallback, useEffect } from 'react'
import ankipapersLogo from '../assets/ankipapers-logo.svg'
import CardHeatmap from './CardHeatmap'
import { Ref } from './GuideRefs'
import { getHomeStats } from '../bridge'
import {
  FileText,
  Plus,
  FileInput,
  Settings,
  FolderOpen,
  Sparkles,
  BookOpen,
  Link2,
  Share2,
  Hash,
  Keyboard,
  HardDrive,
  Layers,
  CalendarDays,
  History,
  MessageCircle,
  Paperclip,
  Braces,
  Globe,
  Share,
  Image as ImageIcon,
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

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Count each paper's marked lines by kind (one Anki note per line).
function cardCounts(papers) {
  const c = { basic: 0, reversible: 0, cloze: 0, list: 0 }
  for (const p of papers) {
    for (const r of p.card_refs || []) {
      if (r.card_type in c) c[r.card_type]++
      else c.basic++
    }
  }
  return { ...c, total: c.basic + c.reversible + c.cloze + c.list }
}

export default function WelcomeScreen({
  papers = [],
  selectedFolder = null,
  onSelectPaper,
  onCreatePaper,
  onImportMarkdown,
  onOpenGuide,
}) {
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [stats, setStats] = useState(null)

  // Card history comes from Anki itself (see get_home_stats in gui/bridge.py).
  // Re-read whenever the papers list refreshes, e.g. after a Generate.
  useEffect(() => {
    let alive = true
    getHomeStats().then((s) => { if (alive) setStats(s) }).catch(() => {})
    return () => { alive = false }
  }, [papers])

  const recentPapers = useMemo(() => {
    return [...papers].sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)).slice(0, 3)
  }, [papers])

  const counts = useMemo(() => cardCounts(papers), [papers])
  const folderCount = useMemo(
    () => new Set(papers.map((p) => p.folder_path).filter(Boolean)).size,
    [papers],
  )

  const last = stats?.last_generated
  const lastPaper = last?.paper_id ? papers.find((p) => p.id === last.paper_id) : null

  const handleCreate = useCallback(() => {
    const title = newTitle.trim() || 'Untitled Paper'
    onCreatePaper?.(title, selectedFolder || '')
    setNewTitle('')
    setCreating(false)
  }, [newTitle, onCreatePaper, selectedFolder])

  const pct = (n) => (counts.total ? `${(n / counts.total) * 100}%` : '0%')

  return (
    <div className="welcome">
      <div className="home">
        {/* ── Top row: greeting and the two things you start with ── */}
        <section className="home-hero">
          <img src={ankipapersLogo} alt="" className="home-hero-logo" width={52} height={52} decoding="async" />
          <div className="home-hero-text">
            <h1 className="home-hero-title">{greeting()}</h1>
            {creating ? (
              <div className="home-create">
                <input
                  className="welcome-input"
                  autoFocus
                  placeholder={selectedFolder ? `Title for a new paper in “${selectedFolder}”…` : 'Title for a new paper…'}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    else if (e.key === 'Escape') { e.stopPropagation(); setCreating(false); setNewTitle('') }
                  }}
                />
                <button type="button" className="welcome-btn welcome-btn-primary" onClick={handleCreate}>Create</button>
              </div>
            ) : (
              <p className="home-hero-sub">Write your notes. Mark the lines worth remembering. Press Ctrl+G.</p>
            )}
          </div>
          {!creating && (
            <div className="home-hero-actions">
              <button type="button" className="welcome-btn welcome-btn-ghost" onClick={() => onImportMarkdown?.()}>
                <FileInput size={15} /> Import
              </button>
              <button type="button" className="welcome-btn welcome-btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> New paper
              </button>
            </div>
          )}
        </section>

        {/* ── Start here: the five ways to mark a line. The full guide has a
            window of its own (the Guide button in the sidebar). ── */}
        <section className="home-panel welcome-ref home-start">
          <div className="home-start-head">
            <h2 className="welcome-ref-group-title"><Sparkles size={13} /> Start here</h2>
            <button type="button" className="home-start-guide" onClick={() => onOpenGuide?.()}>
              <BookOpen size={13} /> Open the guide
            </button>
          </div>
          <p className="welcome-ref-blurb">
            There are five ways to mark a line. Write the rest of your notes normally — anything
            you don't mark stays plain text. When you're ready, press Ctrl+G and your cards appear in Anki.
          </p>
          <Ref code="Question >> Answer" tone="basic">Asks you the question, shows the answer.</Ref>
          <Ref code="Term <> Definition" tone="reversible">Asks you both ways round.</Ref>
          <Ref code="Blood loss causes {{anemia}}" tone="cloze">Hides the words in braces and asks you to fill in the gap.</Ref>
          <Ref code={<>Steps in order{'\n'}{'    '}+ First{'\n'}{'    '}+ Second</>} tone="list">A list, recalled item by item in order. Each + item is its own card with its own schedule.</Ref>
          <Ref code="# Heading" tone="heading">A title. It organizes your notes and never becomes a card.</Ref>
        </section>

        {/* ── Second row: the library at a glance ── */}
        <section className="home-tiles">
          <div className="home-tile">
            <div className="home-tile-label">Papers</div>
            <div className="home-tile-value">{papers.length.toLocaleString()}</div>
            <div className="home-tile-sub">in {folderCount} {folderCount === 1 ? 'folder' : 'folders'}</div>
          </div>
          <div className="home-tile">
            <div className="home-tile-label">Cards</div>
            <div className="home-tile-value">{counts.total.toLocaleString()}</div>
            <div className="home-cardbar" aria-hidden="true">
              <span className="is-basic" style={{ width: pct(counts.basic) }} />
              <span className="is-reversible" style={{ width: pct(counts.reversible) }} />
              <span className="is-cloze" style={{ width: pct(counts.cloze) }} />
              <span className="is-list" style={{ width: pct(counts.list) }} />
            </div>
            <div className="home-tile-sub">
              {counts.basic.toLocaleString()} basic · {counts.reversible.toLocaleString()} reversible · {counts.cloze.toLocaleString()} cloze
              {counts.list ? ` · ${counts.list.toLocaleString()} list` : ''}
            </div>
          </div>
          <button
            type="button"
            className="home-tile home-tile-button"
            disabled={!lastPaper}
            onClick={() => lastPaper && onSelectPaper?.(lastPaper.id)}
          >
            <div className="home-tile-label">Last added to Anki</div>
            {last ? (
              <>
                <div className="home-tile-paper">{lastPaper?.title || last.title || 'A deleted paper'}</div>
                <div className="home-tile-sub">
                  {formatRelativeTime(last.at)}
                  {lastPaper ? ` · ${(lastPaper.card_refs?.length ?? 0).toLocaleString()} cards` : ''}
                </div>
              </>
            ) : (
              <div className="home-tile-sub home-tile-empty">Nothing yet. Press Ctrl+G in a paper.</div>
            )}
          </button>
        </section>

        {/* ── Third row: pick up where you left off ── */}
        <h2 className="home-section-title"><History size={14} /> Continue where you left off</h2>
        {recentPapers.length === 0 ? (
          <p className="home-empty">No papers yet. Press <b>New paper</b> above to start one.</p>
        ) : (
          <section className="home-recent">
            {recentPapers.map((p) => {
              const n = p.card_refs?.length ?? 0
              return (
                <button key={p.id} type="button" className="home-paper" onClick={() => onSelectPaper?.(p.id)}>
                  <span className="home-paper-folder">
                    <FolderOpen size={12} /> {p.folder_path ? p.folder_path.split('/').join(' › ') : 'Library'}
                  </span>
                  <span className="home-paper-title">{p.title || 'Untitled'}</span>
                  <span className="home-paper-meta">
                    {n.toLocaleString()} {n === 1 ? 'card' : 'cards'} · edited {formatRelativeTime(p.modified_at)}
                  </span>
                </button>
              )
            })}
          </section>
        )}

        {/* ── Card-creation heatmap ── */}
        <h2 className="home-section-title"><CalendarDays size={14} /> Cards you've made</h2>
        <section className="home-panel">
          <CardHeatmap days={stats?.days || {}} firstDay={stats?.first_day || null} />
        </section>

      </div>
    </div>
  )
}
