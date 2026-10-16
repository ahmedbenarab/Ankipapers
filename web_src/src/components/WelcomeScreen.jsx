import React, { useState, useMemo, useCallback, useEffect } from 'react'
import ankipapersLogo from '../assets/ankipapers-logo.svg'
import CardHeatmap from './CardHeatmap'
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

const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
const PASTE_KEY = IS_MAC ? '⌘V' : 'Ctrl+V'
const PLAIN_PASTE_KEY = IS_MAC ? '⇧⌘V' : 'Ctrl+Shift+V'

/** One row of the guide: the thing you type, and what it does for you. */
function Ref({ code, tone, children }) {
  return (
    <div className="welcome-ref-row">
      <code className={`welcome-ref-code${tone ? ` is-${tone}` : ''}`}>{code}</code>
      <span className="welcome-ref-text">{children}</span>
    </div>
  )
}

function RefGroup({ icon: Icon, title, blurb, children }) {
  return (
    <div className="welcome-ref-group">
      <h3 className="welcome-ref-group-title"><Icon size={13} /> {title}</h3>
      {blurb ? <p className="welcome-ref-blurb">{blurb}</p> : null}
      {children}
    </div>
  )
}

// Topics of the guide at the bottom of the page. Each chip opens its section
// in place, so the page stays short and nothing in the guide is lost.
const GUIDE_TOPICS = [
  { id: 'start', icon: Sparkles, label: 'Start here' },
  { id: 'flashcards', icon: FileText, label: 'Making flashcards' },
  { id: 'organizing', icon: Hash, label: 'Organizing notes' },
  { id: 'code', icon: Braces, label: 'Code blocks' },
  { id: 'linking', icon: Link2, label: 'Linking papers' },
  { id: 'graph', icon: Share2, label: 'The graph' },
  { id: 'tabs', icon: Layers, label: 'Tabs and search' },
  { id: 'ai', icon: MessageCircle, label: 'Draft cards and Ask' },
  { id: 'sources', icon: Paperclip, label: 'Sources, books and courses' },
  { id: 'browser', icon: Globe, label: 'Web browser' },
  { id: 'keys', icon: Keyboard, label: 'Keys' },
  { id: 'sharing', icon: Share, label: 'Sharing and pictures' },
  { id: 'disk', icon: HardDrive, label: 'Papers on disk' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Count each paper's marked lines by kind (one Anki note per line).
function cardCounts(papers) {
  const c = { basic: 0, reversible: 0, cloze: 0 }
  for (const p of papers) {
    for (const r of p.card_refs || []) {
      if (r.card_type in c) c[r.card_type]++
      else c.basic++
    }
  }
  return { ...c, total: c.basic + c.reversible + c.cloze }
}

export default function WelcomeScreen({
  papers = [],
  selectedFolder = null,
  onSelectPaper,
  onCreatePaper,
  onImportMarkdown,
  onOpenSettings,
}) {
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  // A brand-new library opens on "Start here"; otherwise the guide starts
  // closed. Until a chip is pressed this follows the papers list, which
  // arrives a moment after the page first draws.
  const [picked, setGuide] = useState(undefined)
  const guide = picked === undefined ? (papers.length === 0 ? 'start' : null) : picked
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
            </div>
            <div className="home-tile-sub">
              {counts.basic.toLocaleString()} basic · {counts.reversible.toLocaleString()} reversible · {counts.cloze.toLocaleString()} cloze
            </div>
          </div>
          <button
            type="button"
            className="home-tile home-tile-button"
            disabled={!lastPaper}
            onClick={() => lastPaper && onSelectPaper?.(lastPaper.id)}
          >
            <div className="home-tile-label">Last generated</div>
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

        {/* ── Guide: one chip per topic, opening in place ── */}
        <h2 className="home-section-title"><BookOpen size={14} /> Guide</h2>
        <div className="home-guide-chips" role="tablist">
          {GUIDE_TOPICS.map(({ id, icon, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={guide === id}
              className={`home-chip ${guide === id ? 'active' : ''}`}
              onClick={() => setGuide(guide === id ? null : id)}
            >
              {React.createElement(icon, { size: 13 })} {label}
            </button>
          ))}
        </div>

        {guide && (
          <section className="home-panel welcome-ref home-guide">
          {guide === 'start' && (
              <RefGroup
                icon={Sparkles}
                title="Start here"
                blurb="There are four ways to mark a line. Write the rest of your notes normally — anything you don't mark stays plain text. When you're ready, press Ctrl+G and your cards appear in Anki."
              >
                <Ref code="Question >> Answer" tone="basic">
                  Asks you the question, shows the answer.
                </Ref>
                <Ref code="Term <> Definition" tone="reversible">
                  Asks you both ways round.
                </Ref>
                <Ref code="Blood loss causes {{anemia}}" tone="cloze">
                  Hides the words in braces and asks you to fill in the gap.
                </Ref>
                <Ref code="# Heading" tone="heading">
                  A title. It organizes your notes and never becomes a card.
                </Ref>
              </RefGroup>
          )}
          {guide === 'flashcards' && (
              <RefGroup
                icon={FileText}
                title="Making flashcards"
                blurb="Each of these turns one line into one card. You can mix them freely in the same document."
              >
                <Ref code="Question >> Answer" tone="basic">
                  The most common one. Everything before the two arrows becomes the
                  front of the card, everything after becomes the back.
                </Ref>
                <Ref code="Term <> Definition" tone="reversible">
                  Makes two cards from one line, so you get asked the term from the
                  definition as well as the other way round. Good for vocabulary and
                  for names of things.
                </Ref>
                <Ref code="{{words to hide}}" tone="cloze">
                  Keeps the sentence intact but blanks out the part in braces, so you
                  recall it with the rest of the sentence as a clue. Useful when the
                  surrounding wording is what makes the fact make sense.
                </Ref>
                <Ref code="{{c1::this}} {{c2::that}}" tone="cloze">
                  The same idea, but you choose how it's split up. Everything marked
                  c1 is hidden on one card, everything marked c2 on another. Give two
                  phrases the same number and they're hidden together.
                </Ref>
                <Ref code="&& Extra explanation" tone="muted">
                  Background reading rather than a question. Indent it underneath a
                  card and it appears alongside the answer when you're reviewing. It
                  never becomes a card of its own, so it's a good home for the
                  paragraph that explains why the answer is what it is.
                </Ref>
                <Ref code="![](scan.png) under a card" tone="muted">
                  A picture indented under a card rides along with it, in the same
                  place the <code>&&</code> notes appear. It needs no <code>&&</code>{' '}
                  of its own — a line holding nothing but a picture can only mean
                  “show this with the card above”. Put as many as you like, and mix
                  them with <code>&&</code> lines in whatever order reads best; they
                  arrive on the card in the order you wrote them.
                </Ref>
                <Ref code="[[tag]]" tone="muted">
                  Puts an Anki tag on that card, written as <code>AnkiPapers::tag</code>.
                  Anything you'd normally use tags for — searching, building a filtered
                  deck before an exam — works the same way here.
                </Ref>
                <Ref code="[[NH]]" tone="muted">
                  Short for “no heading”. Every card normally shows the headings it came
                  from at the top, which is helpful context. Add this when that context
                  would give the answer away.
                </Ref>
                <Ref code="Card style" tone="muted">
                  How your cards look in Anki. Settings → Card Style switches between
                  the built-in Basic look and Solarized Styling: a calm, color-coded
                  style that is light in Anki's light mode and dark in dark mode.
                  Saving restyles every card at once, phone included after a sync.
                </Ref>
              </RefGroup>
          )}
          {guide === 'organizing' && (
              <RefGroup
                icon={Hash}
                title="Organizing your notes"
                blurb="Headings and indenting do two jobs at once: they keep the document readable, and they tell each card where it came from."
              >
                <Ref code="# Topic" tone="heading">
                  The biggest heading — one subject or condition per topic.
                </Ref>
                <Ref code="## Section" tone="heading">
                  A part of that topic, like Diagnosis or Treatment.
                </Ref>
                <Ref code="### and smaller" tone="heading">
                  Finer divisions when you need them, down to six levels of heading.
                </Ref>
                <Ref code="Tab / Shift+Tab" tone="key">
                  Moves a line in or out one level, so it sits underneath the line above.
                  Anything tucked under that line comes with it. A blank line is the
                  exception — it moves on its own, so nudging one never drags along
                  whatever happens to sit below it. When a line has anything tucked
                  under it, it starts folded up — click the little arrow beside it to
                  open it.
                </Ref>
                <Ref code="| Column | Column |" tone="muted">
                  A table. Write the rows with pipes between the cells and put a row
                  of <code>| --- | --- |</code> under the first one to make it the
                  header. Tables are only as wide as they need to be and sit centered;
                  hover one for <b>S / M / L / Full</b> buttons that decide how wide
                  it may grow before the cells start wrapping. Pressing Enter inside a
                  table adds a row, and pressing it at the very end steps back out.
                </Ref>
                <Ref code="![caption](picture.jpg)" tone="muted">
                  A picture from your Anki media folder. The picture button on the
                  toolbar adds one wherever your cursor is, and pasting an image
                  copies it into the media folder for you, so you rarely type this
                  out. Where you put the line decides what it does: on its own at
                  any level it is just part of the document, and indented under a
                  card it travels onto that card.
                </Ref>
                <Ref code="Outline" tone="key">
                  The Papers | Outline switch at the top of the sidebar lists this paper's
                  headings with their card counts. Click one to jump there.
                </Ref>
                <Ref code="Weak spots" tone="key">
                  Lines whose cards you keep missing in Anki are marked amber (red for a
                  leech). Rest the pointer on one for its review history, or use the
                  "weak spots" button in the bottom bar to see only those lines.
                </Ref>
                <Ref code="Line numbers" tone="key">
                  The numbers down the left are each line's place in the paper. Folding a
                  section leaves a gap rather than renumbering, so a number always means
                  the same line. Settings can turn them off.
                </Ref>
                <Ref code="Search" tone="key">
                  The search box in the sidebar lists every line that matches, as the
                  paper, then the headings above it, then the line number. Click one and
                  the paper opens fully unfolded, with that line in the middle of the
                  screen and briefly highlighted.
                </Ref>
                <Ref code="Drag and drop" tone="key">
                  Drag a paper onto a folder to move it there, or a folder onto another
                  folder (or the empty space below the list) to move it with everything
                  inside. Folders can sit up to ten deep, so a course can be a folder,
                  each learning path a folder inside it, and each module a paper. These
                  are real folders on your disk, and moving one in the sidebar moves it
                  there too.
                </Ref>
                <Ref code="Right-click a folder" tone="key">
                  Choose “Generate all cards in folder” to make the cards for every paper in
                  that folder and its subfolders in one go. You confirm once, answer one
                  question if any cards were edited in Anki, then a progress bar shows each
                  paper as it is done. Keep Anki Papers open until it finishes.
                </Ref>
              </RefGroup>
          )}
          {guide === 'code' && (
              <RefGroup
                icon={Braces}
                title="Code blocks"
                blurb="Write code in a paper and quiz yourself on it. A block is drawn as one panel, colored for Python, Rust, HTML, CSS and JavaScript, and nothing inside it ever becomes a card."
              >
                <Ref code="```python" tone="muted">
                  Starts a block. Put the language straight after the three backticks:
                  python, rust, html, css or javascript (py, rs, js and ts work too).
                  Press Enter and the closing <code>```</code> is added for you, with your
                  cursor on the first line of code. Any other language name still
                  works, just without the colors.
                </Ref>
                <Ref code="```" tone="muted">
                  Ends the block. A <code>```</code> with nothing closing it stays an
                  ordinary line, so a forgotten one can never turn the rest of the
                  paper into code.
                </Ref>
                <Ref code="Tab / Shift+Tab" tone="key">
                  Indents a line of code. Press Tab at the start of the line after a
                  colon or an opening brace, twice for two steps, and Shift+Tab to take
                  it back out. Each step is that language's own size: 4 spaces in Python
                  and Rust, 2 in HTML, CSS and JavaScript. Enter starts the next line at
                  the same indent, and Backspace at the start of a line moves it out a
                  step. Tab on a <code>```</code> line moves the whole block, and the
                  cards under it, one level.
                </Ref>
                <Ref code="➵" tone="muted">
                  What Tab writes behind the scenes, one per step. Spaces at the start
                  of a line already mean “tucked under the line above”, so code stores
                  its indentation as ➵ instead and your outline and your code never get
                  mixed up. You never see it in the editor; the plain text view,
                  Ctrl+Shift+E, is the one place it shows. If you edit code there, type ➵
                  rather than a real tab. A text replacement for ➵
                  {IS_MAC ? ' (System Settings → Keyboard → Text Replacements)' : ''} works
                  too, if you'd rather, and does the same as Tab.
                </Ref>
                <Ref code="Question >> Answer under ```" tone="basic">
                  Indent a card under the closing <code>```</code> and the whole block,
                  colored, sits at the top of the card in its breadcrumb. That's how to
                  ask “What is the output?” or “Does this compile?”. Works for all three
                  kinds of card, and for cards tucked in deeper still.
                </Ref>
                <Ref code="Copy" tone="key">
                  The Copy button in a block's header copies the code with real spaces,
                  ready to run. Exporting to Markdown or PDF does the same. Going the
                  other way, importing Markdown or pasting code into a block turns its
                  spaces into ➵ for you.
                </Ref>
              </RefGroup>
          )}
          {guide === 'linking' && (
              <RefGroup
                icon={Link2}
                title="Linking papers together"
                blurb="Any phrase in one paper can point at any heading in another, so related ideas are one click apart instead of one search apart."
              >
                <Ref code="Making a link" tone="key">
                  Select the words you want to turn into a link, right-click them, and
                  choose <b>Create link…</b> Then search for the paper or heading it
                  should point at. The words stay readable — they just become
                  underlined.
                </Ref>
                <Ref code="Following a link" tone="key">
                  Double-click it. You land on the exact line it points at, not just
                  the top of the other document.
                </Ref>
                <Ref code="Seeing your links" tone="key">
                  The link button in the toolbar opens a side panel with two lists:
                  everywhere that points <b>at</b> this document, and everywhere this
                  document points <b>to</b>. Click any entry to jump there.
                </Ref>
                <Ref code="Why they hold" tone="muted">
                  A link is attached to the line itself rather than to its position, so
                  you can reword it, move it, or rename the paper and the link still
                  finds it.
                </Ref>
                <Ref code="Renaming a heading" tone="muted">
                  Links quote the heading they point at. If you rename a heading that
                  other papers link to, saving (or leaving the paper) offers to update
                  every link that still reads the old name. Links whose words you chose
                  yourself are left as you wrote them.
                </Ref>
                <Ref code="<!--ap:…-->" tone="muted">
                  If you open a paper in a text editor you'll see these on some lines.
                  They are the name that makes a line findable — links point at them,
                  and card generation uses them to recognize a card you have reworded
                  instead of replacing it. The editor hides them and keeps them out of
                  your cards and PDFs. Leave them alone and they look after
                  themselves; delete one and whatever pointed at that line loses it.
                </Ref>
              </RefGroup>
          )}
          {guide === 'graph' && (
              <RefGroup
                icon={Share2}
                title="Seeing the whole picture"
                blurb="The Graph button inside the link panel draws every connection in your library at once — useful for spotting a subject you've written about in three places without noticing."
              >
                <Ref code="Documents / Headings" tone="key">
                  Switch between one dot per paper and one dot per linked section, with
                  the headings above it shown as its parents.
                </Ref>
                <Ref code="Getting around" tone="key">
                  Drag a dot to move it out of the way, double-click it to open that
                  paper. Drag the background to move the whole picture, scroll to zoom
                  in and out.
                </Ref>
                <Ref code="Broken links" tone="muted">
                  The line along the bottom counts any links whose destination no longer
                  exists, so you can find and mend them.
                </Ref>
              </RefGroup>
          )}
          {guide === 'tabs' && (
              <RefGroup
                icon={Layers}
                title="Several papers at once"
                blurb="Every paper you open gets a tab above the editor, so the ones you are working across stay one click apart."
              >
                <Ref code="Tabs" tone="key">
                  Open a paper from the sidebar, a link, or the search and it joins the
                  strip. Following a link puts the new paper right next to the one you
                  came from, and the one you left stays open. Close a tab with its × or
                  a middle-click. Five tabs fit across the window; beyond that the strip
                  scrolls sideways. Your open tabs are remembered next time.
                </Ref>
                <Ref code="Right-click a tab" tone="key">
                  Choose Rename to give the paper a new name right there in the tab.
                  Enter saves it and Esc cancels. Links to the paper keep working.
                </Ref>
                <Ref code="Back / forward" tone="key">
                  The two arrows at the left of the toolbar retrace your steps through
                  every paper you have visited, landing on the same line each time — so
                  you can chase a chain of links and find your way back. A mouse's back
                  and forward buttons do the same.
                </Ref>
                <Ref code="Toolbar" tone="key">
                  On a narrow window the toolbar wraps onto a second line. If you'd rather
                  it stayed on one line, choose <b>Settings → Toolbar → Scroll sideways</b>;
                  then a trackpad, a mouse wheel or the thin bar under it scrolls it.
                </Ref>
                <Ref code="●" tone="key">
                  A dot on the active tab means that paper has edits not yet saved to
                  disk. It clears when you press Ctrl+S, when autosave runs, and whenever
                  you switch papers, since switching always saves first.
                </Ref>
              </RefGroup>
          )}
          {guide === 'ai' && (
              <RefGroup
                icon={MessageCircle}
                title="Draft cards and Ask"
                blurb="An AI model can suggest cards from your notes and answer questions about them. Nothing it writes goes into your paper or into Anki until you say so. Set it up once in Settings → AI."
              >
                <Ref code="Settings → AI" tone="key">
                  Choose Claude, Gemini or an OpenAI-compatible service (OpenAI, OpenRouter,
                  or a model running on your own Mac in Ollama or LM Studio). Paste your key,
                  press <b>Save key</b>, then <b>Test connection</b> and pick a model. On a
                  Mac the key goes into your Keychain, not into the add-on's settings. You
                  can also set the card rules sent with every draft, which card types it may
                  write, and the language. Turning AI off hides every AI button.
                </Ref>
                <Ref code="Draft cards" tone="key">
                  Click into a line, or select several (or a heading for its whole
                  section), then press <b>Draft cards</b> on the toolbar, right-click and
                  choose it, or press Ctrl+Shift+D. Suggested cards appear under the
                  passage as dashed lines. They aren't saved and Generate skips them.
                </Ref>
                <Ref code="✓  ✗  ↻" tone="muted">
                  ✓ accepts a draft, so it becomes an ordinary card line. ✗ throws it away.
                  ↻ asks for that one card again. Click a draft to edit it first: Enter
                  saves and accepts, Esc stops editing. <b>Accept all</b>, <b>Discard
                  all</b> and <b>Redraft</b> work on the whole group, and the bottom bar
                  counts the drafts still waiting.
                </Ref>
                <Ref code="Ask" tone="key">
                  The speech-bubble button (or Ctrl+Shift+A) opens a chat about the open
                  paper. The chips at the top choose what it reads: this paper, the source
                  open in the Sources panel, the whole chapter, the papers this one links
                  to. Answers point to <code>line N</code> or a source page; click one to go
                  there. With <b>Stick to my sources</b> on, it tells you when your material
                  doesn't cover something.
                </Ref>
                <Ref code="Use an answer" tone="muted">
                  Under each answer, <b>Insert as &amp;&amp; supplement</b> adds it to the paper
                  as background for the card above, and <b>Draft cards from this</b> turns
                  it into drafts. Nothing goes into Anki directly.
                </Ref>
              </RefGroup>
          )}
          {guide === 'sources' && (
              <RefGroup
                icon={Paperclip}
                title="Sources, books and courses"
                blurb="Keep the slides, chapter or web page you're studying open beside the paper you're writing. Sources work without AI."
              >
                <Ref code="Sources panel" tone="key">
                  The paperclip on the toolbar opens the Sources panel. Use + to attach a
                  PDF, Word, PowerPoint, HTML or text file, or a web page, to the open paper.
                  Files are copied into your Anki Papers folder and stay with the paper.
                  PowerPoint and Word open as easy-to-read pages, slides with their speaker
                  notes; web pages are saved so you can read them offline.
                </Ref>
                <Ref code="Select text in a source" tone="key">
                  A small bar offers <b>Add to notes</b> (copies it into the paper),
                  <b> Draft cards</b> and <b>Ask</b>. Lines added this way remember where
                  they came from: right-click one and choose <b>Go to source</b> to reopen
                  that page with the passage highlighted.
                </Ref>
                <Ref code="Right-click a folder" tone="key">
                  <b>Attach a book…</b> (a PDF), <b>Attach a web source…</b> (a Microsoft
                  Learn course or learning path, a docs site, or any page that links to its
                  chapters) or <b>Attach a file…</b>. Every paper in that folder, at any
                  depth, sees it in its Sources panel, marked “from” the folder.
                </Ref>
                <Ref code="A book" tone="muted">
                  Attaching a book shows the PDF's whole outline: parts, chapters and the
                  sections inside them. Next to each, choose the paper that covers it.
                  Papers whose names match are filled in for you; anything set to “Not a
                  chapter” is left out. Page numbers follow the book's printed numbers.
                </Ref>
                <Ref code="A course" tone="muted">
                  Paste the course's address and its modules are listed, grouped by
                  learning path. If a learning path has its own sub-folder, choose it (one
                  whose name matches is picked for you). Modules are matched to your papers
                  by name.
                </Ref>
                <Ref code="Chapters" tone="key">
                  A paper that is a chapter opens the source at its own pages or module.
                  Naming
                  a new paper after a chapter links it. To see the chapters that don't have
                  a paper yet, faded in the sidebar inside the folder they belong in, turn
                  on <b>Settings → Chapters waiting for a paper</b>; click one to create its
                  paper, already linked.
                </Ref>
                <Ref code="Chapter bar" tone="key">
                  A line above a chapter paper showing its book and chapter, with steps to
                  the previous and next chapter. It's hidden by default to keep one
                  toolbar. Press the book button in the toolbar to show it on that paper
                  (it remembers), or turn on <b>Settings → Chapter Bar</b> to show it on
                  every chapter paper; while that's on, the toolbar button is grayed out.
                </Ref>
                <Ref code="Remove a source" tone="muted">
                  Right-click the folder and choose <b>Remove “…”</b>, or use the bin icon in
                  the Sources panel. <b>Learning paths and sources…</b> in the same menu
                  changes which sub-folder a learning path uses. Your papers and their cards
                  are never changed.
                </Ref>
              </RefGroup>
          )}
          {guide === 'browser' && (
              <RefGroup
                icon={Globe}
                title="Web browser"
                blurb="A small browser that opens beside your paper, for looking something up without leaving Anki Papers."
              >
                <Ref code="Globe button" tone="key">
                  At the right end of the toolbar. It opens the browser to the right
                  of your paper; click it again, or ✕ in the browser's own bar, to
                  close it. Drag the line between the two to make it wider or
                  narrower, and that width is remembered. It reopens on the last page
                  you were on.
                </Ref>
                <Ref code="Address bar" tone="key">
                  Type a web address, or anything else to search Google for it. ←, →
                  and ↻ work as in any browser, and ↗ opens the page in your usual
                  browser. Links that would open a new window open here instead.{' '}
                  {IS_MAC ? '⌘L' : 'Ctrl+L'} jumps to the address bar.
                </Ref>
                <Ref code="Staying signed in" tone="muted">
                  Sites you sign in to remember you, as in any browser. This browser is
                  separate from Chrome and Safari and keeps its logins as cookies in a
                  folder on this computer{IS_MAC ? <> (<code>~/Library/Application Support/Anki/QtWebEngine</code>)</> : ''},
                  not in {IS_MAC ? 'your Keychain' : 'a password manager'}. It never saves passwords; you
                  type one once and the site keeps you signed in after that.
                </Ref>
                <Ref code="🗑" tone="key">
                  Clear browsing data. After asking, it signs you out of every site and
                  forgets this browser's cookies, history, cache and saved site data.
                  It starts fresh straight away, and the old files are deleted the next
                  time Anki starts.
                </Ref>
              </RefGroup>
          )}
          {guide === 'keys' && (
              <RefGroup
                icon={Keyboard}
                title="Keys worth knowing"
                blurb={IS_MAC
                  ? 'On a Mac these use Ctrl, not Command — except the two pasting keys, which follow the usual ⌘ you already use everywhere else.'
                  : 'The same keys work on Windows and Linux.'}
              >
                <Ref code="Ctrl+S" tone="key">Save the paper you're in.</Ref>
                <Ref code="Ctrl+G" tone="key">
                  Make the cards. It saves first, so nothing you've just typed is missed.
                </Ref>
                <Ref code="Ctrl+Shift+E" tone="key">
                  Switch between the normal editor and the plain text behind it. Handy
                  when you want to see exactly what you've written.
                </Ref>
                <Ref code="Ctrl+B / Ctrl+I" tone="key">
                  <b>Bold</b> and <i>italic</i>, saved as &lt;b&gt; and &lt;i&gt; tags. Press again to
                  take it off.
                </Ref>
                <Ref code="Ctrl+U" tone="key">
                  <u>Underline</u>. Highlight the text first; press again to take it
                  off. The underline button in the toolbar does the same.
                </Ref>
                <Ref code="Ctrl+5 / Ctrl+6" tone="key">
                  Subscript and superscript, for things like H<sub>2</sub>O or
                  x<sup>2</sup>. Highlight the text first. Press the same keys again
                  to take it off, or the other pair to swap. The two buttons next to
                  strikethrough in the toolbar do the same.
                </Ref>
                <Ref code="Ctrl+Z / Ctrl+Shift+Z" tone="key">Undo and redo.</Ref>
                {IS_MAC && (
                  <Ref code="Shortcut + Space" tone="key">
                    Your macOS Text Replacements work here too. Type a shortcut from
                    System Settings → Keyboard → Text Replacements, then Space or
                    Return, and it becomes its phrase. Ctrl+Z brings the shortcut
                    back. Turn it off in Settings.
                  </Ref>
                )}
                <Ref code="Ctrl+Shift+D" tone="key">
                  Draft cards from the lines you've selected, or the line you're on.
                </Ref>
                <Ref code="Ctrl+Shift+A" tone="key">Open or close Ask, the chat about this paper.</Ref>
                <Ref code="Ctrl+," tone="key">Open Settings.</Ref>
                <Ref code="Ctrl+Tab / Ctrl+Shift+Tab" tone="key">
                  Step to the next or previous tab.
                </Ref>
                <Ref code="Ctrl+Alt+← / Ctrl+Alt+→" tone="key">
                  Back and forward through the papers you have visited, the same as the
                  arrows at the left of the toolbar.
                </Ref>
                <Ref code={'Ctrl+\\'} tone="key">
                  Fold the folder list away and give the whole window to what you're
                  writing. It shrinks to a narrow strip of icons rather than
                  vanishing, so New Paper and Search stay one click away — and
                  resting your pointer on the strip slides the list back out over
                  the page without moving your text. You can also drag the edge of
                  the list to any width you like; drag it far enough left and it
                  folds away on its own.
                </Ref>
                <Ref code={IS_MAC ? 'Ctrl+Shift+↓ or ⇧⌘↓' : 'Ctrl+Shift+↓'} tone="key">
                  Unfold the whole document at once. Papers open with every nested
                  section folded up so a long one reads as an outline, and this opens
                  all of it in one press when you want the full text back.
                </Ref>
                <Ref code={IS_MAC ? 'Ctrl+Shift+↑ or ⇧⌘↑' : 'Ctrl+Shift+↑'} tone="key">
                  The mirror image: fold every section back up to the same outline
                  the document opens with. Handy after unfolding everything to skim,
                  when you want to collapse it again without reopening the paper.
                </Ref>
                <Ref code={PASTE_KEY} tone="key">
                  Paste as it was copied. Text that came with line breaks in it
                  arrives as separate lines, one block each, below whichever block
                  you have selected.
                </Ref>
                <Ref code={PLAIN_PASTE_KEY} tone="key">
                  Paste as plain text, all on one line. Every line break in what you
                  copied becomes a space. This is the one to use for a paragraph
                  lifted out of a textbook or a PDF, where the breaks are just
                  where the column happened to end — it also rejoins words split
                  across a line, so <code>propa-</code> and <code>gation</code> come
                  back as one word. It's in the right-click menu too.
                </Ref>
              </RefGroup>
          )}
          {guide === 'sharing' && (
              <RefGroup
                icon={Share}
                title="Sharing and pictures"
                blurb="A paper only stores each picture's name; the picture itself lives in your Anki media folder. Sharing packs the pictures in with the papers, so whoever opens it sees exactly what you see."
              >
                <Ref code="Share button" tone="key">
                  On the toolbar, next to Export PDF. Saves this paper and every picture
                  it shows as one .zip you can email or drop in a shared folder. If a
                  picture is missing from your media folder it's left out, and you're
                  told which.
                </Ref>
                <Ref code="Right-click a folder" tone="key">
                  <b>Share folder with pictures…</b> does the same for a whole folder:
                  every paper in it and its subfolders, keeping their structure.
                </Ref>
                <Ref code="Import" tone="key">
                  The Import button opens a share as well as Markdown. Its pictures go
                  into your Anki media folder, and a shared folder arrives as a folder of
                  its own (named “Name (2)” if you already have one). Links between the
                  shared papers keep working. Cards aren't included; press Ctrl+G to make
                  your own.
                </Ref>
                <Ref code="_ap_3f9a….png" tone="muted">
                  Pictures you paste or add are named from their contents. The same
                  picture always gets the same name, so sharing never duplicates one and
                  two different pictures can't collide. The leading underscore is Anki's
                  own sign for “in use”, so its Check Media never lists them as unused,
                  on your phone either.
                </Ref>
                <Ref code="Check Media" tone="muted">
                  Anki's Tools → Check Media counts a picture as unused when no card
                  shows it, which used to include pictures that only appear in a paper.
                  With Anki Papers installed it leaves every picture your papers show off
                  that list, so <b>Delete Unused</b> can't remove them, and its report
                  says how many it kept. Pictures from before the underscore names are
                  only guarded this way on your computer, so don't press Delete Unused in
                  AnkiMobile or AnkiDroid's Check Media.
                </Ref>
              </RefGroup>
          )}
          {guide === 'disk' && (
              <RefGroup
                icon={HardDrive}
                title="Your papers are files on your computer"
                blurb="Every paper is an ordinary markdown file kept in your Anki profile folder, arranged in the same folders you see in the sidebar. You can open them in any editor, put them in Dropbox, or track them with git. The editor reads those files directly, so what is on your disk is what you see here. Moving or renaming a paper or a folder in the app moves or renames it on disk, folder contents and all; anything you put in a folder yourself goes with it. A copy still goes into your Anki collection and travels to AnkiWeb with the rest of your sync, as a backup."
              >
                <p className="welcome-ref-blurb">
                  <b>Already been using Anki Papers?</b> Papers you wrote before this
                  version live only in the collection until you copy them out, and it is
                  a one-time job. Open <b>Settings → Papers on disk</b> and press{' '}
                  <b>Preview</b>: it tells you how many papers would be written, how many
                  card links they carry, and the exact folder they would go to, without
                  touching anything. When that looks right, press <b>Write</b>. It only
                  adds files — nothing in your collection is changed or removed, so there
                  is nothing to undo. From then on every save writes itself to disk.
                </p>
                <div className="welcome-actions-row">
                  <button type="button" className="welcome-btn welcome-btn-primary" onClick={() => onOpenSettings?.()}>
                    <Settings size={15} /> Open Settings
                  </button>
                </div>
              </RefGroup>
          )}
          </section>
        )}
      </div>
    </div>
  )
}
