import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  initBridge, listPapers, loadPaper, savePaper, createPaper, deletePaper,
  generateCards, checkAnkiEditConflicts, getDecks, createFolder, getFolders, movePaperToFolder,
  deleteFolder, renameFolder, moveFolder,
  pickImage, pasteImage, exportPdf, exportMarkdown, importMarkdown, getSettings, saveSettings as saveSettingsBridge,
  getMediaDir, getTextReplacements, convertEmphasisToTags, openInBrowser, moveCardsToDeck, saveSourceLink, loadSourceLink, openUrl,
  getNoteStats, unsuspendNote, setWebBrowser, getWebBrowser, sharePaper, shareFolder,
} from './bridge'
import { buildOutline } from './outline'
import { buildCardRefIndex, resolveNoteIdFromIndex } from './crossLink'
import Sidebar from './components/Sidebar'
import EditorHeader from './components/EditorHeader'
import TabBar from './components/TabBar'
import SourceEditor from './components/SourceEditor'
import BlockEditor from './components/BlockEditor'
import BottomToolbar from './components/BottomToolbar'
import WelcomeScreen from './components/WelcomeScreen'
import { resolveApTarget, parseApTarget, ensureApBlockId, findHeaderRenames, retitleLinks } from './docLinks'
import { renderPrintHtml } from './printDocument'
import { buildReplacementMap } from './blockFormat'
import LinkPicker from './components/LinkPicker'
import LinksPanel from './components/LinksPanel'
import GraphView from './components/GraphView'
import ErrorBoundary from './components/ErrorBoundary'
import Toast from './components/Toast'
import Settings from './components/Settings'
import GenerateConflictModal from './components/GenerateConflictModal'
import FolderGenerateDialog from './components/FolderGenerateDialog'
import TableDialog from './components/TableDialog'
import SourcesPanel from './components/SourcesPanel'
import { sourceKey } from './sourceKeys'
import ChapterStrip from './components/ChapterStrip'
import FolderSourceDialog from './components/FolderSourceDialog'
import AskPanel from './components/AskPanel'
import {
  srcForPaper, srcAttachPaperFile, srcAttachPaperWeb, srcDetachPaper, srcCreateChapterPaper,
  srcFoldersSummary, srcFolderAttachFile, srcFolderDetach,
} from './aiBridge'
import { getApBlockId } from './docLinks'
import useDrafts from './useDrafts'

// Sidebar sizing. SNAP is the width below which a drag stops resizing and
// collapses to the icon rail instead, so you can put the tree away with the
// same gesture you use to narrow it.
const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')

const SIDEBAR_DEFAULT_WIDTH = 260

// Let the folder-Generate progress dialog paint before the next paper: each
// Generate holds Anki's main thread until it returns. Never waits on animation
// frames alone -- browsers stop them entirely while the window is hidden
// (minimized), which froze the whole run until the window came back. Whichever
// comes first: two frames, or 120ms.
const letPaint = () => Promise.race([
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  new Promise((r) => setTimeout(r, 120)),
]).then(() => new Promise((r) => setTimeout(r, 30)))
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_SNAP_WIDTH = 120

const clampSidebarWidth = (w) =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(w)))

// The Sources panel can take up to half the window, so a PDF can be read at
// a useful size while the editor keeps the other half.
const SOURCE_PANEL_MIN_WIDTH = 280
const clampSourcePanelWidth = (w) => {
  const max = Math.max(SOURCE_PANEL_MIN_WIDTH, Math.floor(window.innerWidth / 2))
  return Math.max(SOURCE_PANEL_MIN_WIDTH, Math.min(max, Math.round(w)))
}


function folderPathAfterRename(oldPath, newName) {
  const p = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
  const n = newName.trim()
  return p ? `${p}/${n}` : n
}

function folderPathAfterMove(folderPath, newParentPath) {
  const name = folderPath.includes('/') ? folderPath.slice(folderPath.lastIndexOf('/') + 1) : folderPath
  const p = (newParentPath || '').trim()
  return p ? `${p}/${name}` : name
}

function mapSelectedFolderAfterRename(selected, oldPath, newPath) {
  if (!selected) return selected
  if (selected === oldPath) return newPath
  if (selected.startsWith(oldPath + '/')) return newPath + selected.slice(oldPath.length)
  return selected
}

function mapPaperFolderAfterRename(fp, oldPath, newPath) {
  if (!fp) return fp
  if (fp === oldPath) return newPath
  if (fp.startsWith(oldPath + '/')) return newPath + fp.slice(oldPath.length)
  return fp
}

function mapSelectedFolderAfterDelete(selected, deletedPath) {
  if (!selected) return selected
  const parent = deletedPath.includes('/') ? deletedPath.slice(0, deletedPath.lastIndexOf('/')) : ''
  if (selected === deletedPath || selected.startsWith(deletedPath + '/')) {
    return parent || null
  }
  return selected
}

function mapPaperFolderAfterDelete(fp, deletedPath) {
  if (!fp) return fp
  const parent = deletedPath.includes('/') ? deletedPath.slice(0, deletedPath.lastIndexOf('/')) : ''
  if (fp === deletedPath || fp.startsWith(deletedPath + '/')) {
    return parent
  }
  return fp
}

export default function App() {
  const [papers, setPapers] = useState([])
  const [folders, setFolders] = useState({ name: 'Root', children: [] })
  const [activePaperId, setActivePaperId] = useState(null)
  // Open tabs: an ordered list of paper ids. Only one paper is ever loaded;
  // a tab is just a shortcut back to a paper you had open.
  const [openTabs, setOpenTabs] = useState([])
  const openTabsRef = useRef(openTabs)
  openTabsRef.current = openTabs
  const tabsLoadedRef = useRef(false)
  // What the open paper looked like when it was last saved, for the unsaved
  // dot on its tab. The tick forces a re-render when a save happens without a
  // state change (autosave).
  const savedRef = useRef({ id: null, content: '', title: '' })
  const [, setSavedTick] = useState(0)
  // The open paper's text as of the last backlink check (reconcileBacklinks).
  const linkBaselineRef = useRef({ id: null, content: '' })
  // Back / forward: the papers (and lines) you have visited, in order.
  const navRef = useRef({ stack: [], index: -1 })
  const [navState, setNavState] = useState({ canBack: false, canForward: false })
  const [paper, setPaper] = useState(null)
  const [decks, setDecks] = useState([])
  const [viewMode, setViewMode] = useState('blocks') // 'blocks' or 'source'
  const [toast, setToast] = useState(null)
  const [cardCounts, setCardCounts] = useState({ basic: 0, reversible: 0, cloze: 0 })
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState({})
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [mediaDir, setMediaDir] = useState('')
  const [generateConflict, setGenerateConflict] = useState(null)
  const [tableDialog, setTableDialog] = useState(null)
  const [showSourcePanel, setShowSourcePanel] = useState(false)
  const [sourcePanelWidth, setSourcePanelWidth] = useState(360)
  // Sidebar width and collapsed state. Both are restored from settings once
  // they load, so the layout you left behind is the one you come back to.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  
  // ─── UI Operation Lock ───────────────────────────
  const [isBusy, setIsBusy] = useState(false)
  const isBusyRef = useRef(false)
  const keyboardLockUntilRef = useRef(0)
  
  // What the lock is currently held for, so the window can say what it is
  // waiting on if you close it mid-operation. 'saving' | 'generating' | null.
  const busyKindRef = useRef(null)

  const setBusy = useCallback((state, kind = 'saving') => {
    if (state) keyboardLockUntilRef.current = Date.now() + 600
    setIsBusy(state)
    isBusyRef.current = state
    busyKindRef.current = state ? kind : null
  }, [])

  const editorRef = useRef(null)
  const blockEditorRef = useRef(null)

  // Always the currently-open paper. Read this (never a captured `paper`)
  // anywhere that writes to storage.
  const paperRef = useRef(null)
  paperRef.current = paper

  // Draft cards (AI). showToast is defined further down; read it through a ref.
  const toastRef = useRef(null)
  const aiOnRef = useRef(true)
  const drafts = useDrafts({ paperRef, onError: (m) => toastRef.current?.(m, 'error') })
  const [settingsSection, setSettingsSection] = useState(null)
  const openAiSettings = useCallback(() => { setSettingsSection('ai'); setShowSettings(true) }, [])
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  // The papers list, readable from callbacks without depending on it.
  const papersRef = useRef(papers)
  papersRef.current = papers

  // Undo/Redo history
  const historyRef = useRef([])
  const historyIndexRef = useRef(-1)
  const historyTimerRef = useRef(null)
  const isUndoRedoRef = useRef(false)

  // ─── Initialize ──────────────────────────────────
  useEffect(() => {
    initBridge().then(async () => {
      await refreshPapers()
      await refreshDecks()
      await refreshFolders()
      const s = await getSettings()
      setSettings(s)
      // Restore open tabs, dropping ids for papers that no longer exist.
      const known = new Set(papersRef.current.map((p) => p.id))
      const stored = Array.isArray(s.open_tabs) ? s.open_tabs : []
      setOpenTabs(stored.filter((id) => known.has(id)))
      tabsLoadedRef.current = true
      if (Number.isFinite(s.sidebar_width)) setSidebarWidth(clampSidebarWidth(s.sidebar_width))
      setSidebarCollapsed(!!s.sidebar_collapsed)
      // Apply theme and color scheme
      document.documentElement.dataset.theme = s.editor_theme || 'dark'
      document.documentElement.dataset.scheme = s.color_scheme || 'carolina'
      const md = await getMediaDir()
      setMediaDir(md.base_url || '')
    })
  }, [])

  const refreshPapers = useCallback(async () => {
    const list = await listPapers()
    papersRef.current = list
    setPapers(list)
  }, [])
  const refreshDecks = useCallback(async () => { setDecks(await getDecks()) }, [])
  const refreshFolders = useCallback(async () => { setFolders(await getFolders()) }, [])

  // ─── Paper Operations ────────────────────────────
  const markSaved = useCallback((p) => {
    if (!p) return
    savedRef.current = { id: p.id, content: p.content, title: p.title }
    setSavedTick((t) => t + 1)
  }, [])

  // Saves a paper and, when it is the open one, records the snapshot the
  // unsaved indicator compares against. Same contract as savePaper.
  const persistPaper = useCallback(async (p) => {
    const res = await savePaper(p)
    if (!(res && res.error) && p.id === paperRef.current?.id) markSaved(p)
    return res
  }, [markSaved])

  // ─── Backlink-aware rename ───────────────────────
  // Runs on an explicit save and whenever you leave a paper (not on autosave,
  // which would interrupt mid-word). Compares the paper against its text at
  // the last check; for each anchored heading whose text changed, offers to
  // rewrite links elsewhere that still quote the old heading verbatim.
  // Returns the paper to save — with its own links updated if it had any.
  const reconcileBacklinks = useCallback(async (current) => {
    if (!current) return current
    const base = linkBaselineRef.current
    const baseline = base.id === current.id ? base.content : null
    linkBaselineRef.current = { id: current.id, content: current.content }
    if (baseline == null || baseline === current.content) return current
    const renames = findHeaderRenames(baseline, current.content)
      .filter((r) => !/[\][]/.test(r.newText))
    if (!renames.length) return current

    // Read links from the papers list, with the open paper's live text in
    // place of its (possibly stale) listing.
    const live = new Map([[current.id, current.content]])
    const corpus = () => papersRef.current.map((p) =>
      live.has(p.id) ? { ...p, content: live.get(p.id) } : p)
    const touched = new Set()
    for (const r of renames) {
      const hits = retitleLinks(corpus(), r.blockId, r.oldText, r.newText)
      if (!hits.length) continue
      const n = hits.reduce((sum, h) => sum + h.count, 0)
      const ok = window.confirm(
        `The heading "${r.oldText}" is now "${r.newText}".\n\n` +
        `Update ${n} link${n === 1 ? '' : 's'} in ${hits.length} paper${hits.length === 1 ? '' : 's'} ` +
        `that still read "${r.oldText}"?`
      )
      if (!ok) continue
      for (const h of hits) { live.set(h.paperId, h.content); touched.add(h.paperId) }
    }
    if (!touched.size) return current

    let result = current
    for (const pid of touched) {
      const content = live.get(pid)
      if (pid === current.id) {
        result = { ...current, content }
        setPaper((prev) => (prev && prev.id === pid ? { ...prev, content } : prev))
        linkBaselineRef.current = { id: pid, content }
        historyRef.current = [content]
        historyIndexRef.current = 0
      } else {
        const p = papersRef.current.find((x) => x.id === pid)
        if (p) await savePaper({ ...p, content })
      }
    }
    await refreshPapers()
    showToast('Links updated', 'success')
    return result
  }, [refreshPapers])

  // ─── Back / forward ──────────────────────────────
  const syncNav = useCallback(() => {
    const { stack, index } = navRef.current
    setNavState({ canBack: index > 0, canForward: index < stack.length - 1 })
  }, [])

  const pushNav = useCallback((paperId, lineIndex = -1) => {
    const nav = navRef.current
    const top = nav.stack[nav.index]
    if (top && top.paperId === paperId && top.lineIndex === lineIndex) return
    nav.stack = nav.stack.slice(0, nav.index + 1)
    nav.stack.push({ paperId, lineIndex })
    if (nav.stack.length > 100) nav.stack.shift()
    nav.index = nav.stack.length - 1
    syncNav()
  }, [syncNav])

  // Adds `id` to the tab strip if it isn't there, right after `afterId` (the
  // tab you came from) so papers reached by following links sit together.
  const addTab = useCallback((id, afterId) => {
    setOpenTabs((prev) => {
      if (prev.includes(id)) return prev
      const at = prev.indexOf(afterId)
      if (at === -1) return [...prev, id]
      return [...prev.slice(0, at + 1), id, ...prev.slice(at + 1)]
    })
  }, [])

  // Options: skipSave — leave the current paper unsaved (it was deleted);
  // fromHistory — a back/forward move, so don't record it; lineIndex — the
  // line this visit lands on, remembered for back/forward.
  const handleSelectPaper = useCallback(async (id, { skipSave = false, fromHistory = false, lineIndex = -1 } = {}) => {
    let current = paperRef.current
    if (current && current.id !== id && !skipSave) {
      current = await reconcileBacklinks(current)
      await persistPaper(current)
    }
    const loaded = await loadPaper(id)
    if (loaded) {
      addTab(id, current?.id)
      if (!fromHistory) pushNav(id, lineIndex)
      setPaper(loaded)
      setActivePaperId(id)
      markSaved(loaded)
      linkBaselineRef.current = { id, content: loaded.content }
      historyRef.current = [loaded.content]
      historyIndexRef.current = 0
    }
  }, [addTab, reconcileBacklinks, persistPaper, markSaved, pushNav])

  const goHistory = useCallback(async (step) => {
    const nav = navRef.current
    const to = nav.index + step
    if (to < 0 || to >= nav.stack.length) return
    nav.index = to
    syncNav()
    const entry = nav.stack[to]
    const alreadyOpen = paperRef.current?.id === entry.paperId
    if (!alreadyOpen) await handleSelectPaper(entry.paperId, { fromHistory: true })
    if (entry.lineIndex >= 0) {
      setTimeout(() => blockEditorRef.current?.revealBlock?.(entry.lineIndex), alreadyOpen ? 30 : 320)
    }
  }, [handleSelectPaper, syncNav])

  const cycleTab = useCallback((dir) => {
    const tabs = openTabsRef.current
    if (!tabs.length) return
    const at = tabs.indexOf(paperRef.current?.id)
    const next = at === -1 ? (dir > 0 ? 0 : tabs.length - 1) : (at + dir + tabs.length) % tabs.length
    if (tabs[next] !== paperRef.current?.id) handleSelectPaper(tabs[next])
  }, [handleSelectPaper])

  const handleCreatePaper = useCallback(async (title, folderPath = '') => {
    // Save what's open first, as switching papers does — otherwise unsaved
    // edits (and the title shown on its tab) would be lost.
    const current = paperRef.current
    if (current) await persistPaper(await reconcileBacklinks(current))
    const newPaper = await createPaper(title, folderPath)
    await refreshPapers()
    addTab(newPaper.id, current?.id)
    pushNav(newPaper.id)
    setPaper(newPaper)
    setActivePaperId(newPaper.id)
    markSaved(newPaper)
    linkBaselineRef.current = { id: newPaper.id, content: newPaper.content }
    showToast('Paper created', 'success')
  }, [refreshPapers, addTab, persistPaper, reconcileBacklinks, pushNav, markSaved])

  // Removes a tab from the strip and returns the tab that should take its
  // place when it was the active one (the right-hand neighbor, else the
  // left), or null when it was the last tab.
  const removeTab = useCallback((id) => {
    const tabs = openTabsRef.current
    const at = tabs.indexOf(id)
    if (at === -1) return null
    const next = tabs.filter((t) => t !== id)
    openTabsRef.current = next
    setOpenTabs(next)
    return next[at] ?? next[at - 1] ?? null
  }, [])

  const handleDeletePaper = useCallback(async (id) => {
    await deletePaper(id)
    const neighbor = removeTab(id)
    const nav = navRef.current
    nav.stack = nav.stack.filter((e) => e.paperId !== id)
    nav.index = Math.min(nav.index, nav.stack.length - 1)
    syncNav()
    if (activePaperId === id) {
      setPaper(null); setActivePaperId(null)
      // The deleted paper must not be saved on the way out — that would
      // quietly recreate it.
      if (neighbor) await handleSelectPaper(neighbor, { skipSave: true })
    }
    await refreshPapers()
    showToast('Paper deleted', 'success')
  }, [activePaperId, refreshPapers, removeTab, handleSelectPaper, syncNav])

  const handleCreateFolder = useCallback(async (name, parentPath = '') => {
    await createFolder(name, parentPath)
    await refreshFolders()
  }, [refreshFolders])

  const handleMovePaper = useCallback(async (paperId, folderPath) => {
    await movePaperToFolder(paperId, folderPath)
    await refreshPapers()
    if (paper && paper.id === paperId) setPaper(prev => ({ ...prev, folder_path: folderPath }))
    showToast(`Moved to ${folderPath || 'Root'}`, 'success')
  }, [paper, refreshPapers])

  // ─── Content Changes + Undo History ─────────────
  const pushHistory = useCallback((content) => {
    if (isUndoRedoRef.current) return
    const hist = historyRef.current
    const idx = historyIndexRef.current
    historyRef.current = hist.slice(0, idx + 1)
    historyRef.current.push(content)
    if (historyRef.current.length > 100) historyRef.current.shift()
    historyIndexRef.current = historyRef.current.length - 1
  }, [])

  // Called by an editor just before it swaps a text-replacement shortcut for
  // its phrase, so the first Ctrl+Z brings the typed shortcut back -- the way
  // macOS undoes a replacement. Records the current text right away instead of
  // waiting for the 400ms typing debounce, which would otherwise fold the
  // shortcut and its replacement into a single undo step.
  const handleHistoryCheckpoint = useCallback(() => {
    const current = paperRef.current?.content
    if (current == null) return
    clearTimeout(historyTimerRef.current)
    if (historyRef.current[historyIndexRef.current] !== current) pushHistory(current)
  }, [pushHistory])

  // ─── macOS Text Replacements ─────────────────────
  // On by default on a Mac (Settings can turn it off). Re-read whenever the
  // window comes back to the front, so edits made in System Settings show up
  // without restarting. See gui/text_replacements.py for why this is needed.
  const textReplacementsOn = IS_MAC && settings.text_replacements_enabled !== false
  const [textReplacements, setTextReplacements] = useState(null)
  useEffect(() => {
    if (!textReplacementsOn) { setTextReplacements(null); return }
    let alive = true
    const load = async () => {
      try {
        const res = await getTextReplacements()
        if (alive) setTextReplacements(buildReplacementMap(res?.items))
      } catch { /* keep whatever list we already had */ }
    }
    load()
    window.addEventListener('focus', load)
    return () => { alive = false; window.removeEventListener('focus', load) }
  }, [textReplacementsOn])

  // `paper` is replaced with a new object on every keystroke, so depending on
  // it here gave this callback a new identity every keystroke. That flowed
  // down as BlockEditor's `onChange`, rebuilding every callback that lists it
  // as a dependency, which handed every <Block/> new props and defeated their
  // React.memo — re-rendering the entire document on each character typed.
  // Read the paper from a ref instead so the identity stays stable; the state
  // update below already uses the functional form, so it never needs `paper`.
  //
  // paperRef is also what save/autosave/flush read, so they can never write a
  // stale snapshot captured in an old closure.
  const handleContentChange = useCallback((newContent) => {
    if (!paperRef.current) return
    setPaper(prev => ({ ...prev, content: newContent, modified_at: Date.now() / 1000 }))
    clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => pushHistory(newContent), 400)
  }, [pushHistory])

  const handleUndo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx <= 0) return
    isUndoRedoRef.current = true
    historyIndexRef.current = idx - 1
    const content = historyRef.current[historyIndexRef.current]
    setPaper(prev => prev ? { ...prev, content, modified_at: Date.now() / 1000 } : prev)
    setTimeout(() => { isUndoRedoRef.current = false }, 50)
  }, [])

  const handleRedo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx >= historyRef.current.length - 1) return
    isUndoRedoRef.current = true
    historyIndexRef.current = idx + 1
    const content = historyRef.current[historyIndexRef.current]
    setPaper(prev => prev ? { ...prev, content, modified_at: Date.now() / 1000 } : prev)
    setTimeout(() => { isUndoRedoRef.current = false }, 50)
  }, [])

  // Rename from a tab's right-click menu. Links point at paper ids, not
  // titles, so nothing else needs rewriting. The open paper is saved right
  // away (with whatever else is unsaved in it, as autosave would) so the
  // sidebar picks up the new name; any other paper is saved on its own.
  const handleRenamePaper = useCallback(async (id, newTitle) => {
    const title = (newTitle || '').trim()
    if (!title) return
    const current = paperRef.current
    const target = current && current.id === id
      ? current
      : papersRef.current.find((p) => p.id === id)
    if (!target || target.title === title) return
    const updated = { ...target, title }
    if (current && current.id === id) {
      setPaper((prev) => (prev && prev.id === id ? { ...prev, title } : prev))
      paperRef.current = { ...paperRef.current, title }
      if (isBusyRef.current) return  // saved with the paper once Generate/Save finishes
    }
    const res = await (current && current.id === id ? persistPaper(updated) : savePaper(updated))
    if (res && res.error) {
      showToast(`Rename failed: ${res.error}`, 'error')
      return
    }
    await refreshPapers()
  }, [persistPaper, refreshPapers])

  const handleDeckChange = useCallback(async (deckName) => {
    if (!paper) return
    const result = await moveCardsToDeck(paper.id, deckName)
    if (result.ok) {
      setPaper(prev => ({ ...prev, deck_name: deckName }))
      showToast(`Moved cards to ${deckName}`, 'success')
    } else {
      showToast(`Error moving cards: ${result.error}`, 'error')
    }
  }, [paper])

  // ─── Save ────────────────────────────────────────
  // Saves whatever is currently open. While this runs, isBusy is true, which
  // disables BOTH toolbar buttons — so Generate cannot start mid-save — and it
  // is cleared in `finally` so the buttons always come back, even on failure.
  const handleSave = useCallback(async () => {
    const current = paperRef.current
    if (!current || isBusyRef.current) return
    setBusy(true)
    try {
      const res = await persistPaper(await reconcileBacklinks(current))
      if (res && res.error) {
        showToast(`Save failed: ${res.error}`, 'error')
        return
      }
      await refreshPapers()
      showToast('Saved ✓', 'success')
    } catch (e) {
      showToast(`Save failed: ${e?.message || e}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [refreshPapers, setBusy, persistPaper, reconcileBacklinks])

  // ─── Auto-save ───────────────────────────────────
  // Reads paperRef rather than closing over `paper`, for two reasons:
  //   - it can never persist a stale snapshot from an old closure, and
  //   - the timer no longer restarts on every keystroke (it used to depend on
  //     `paper`, so while you were typing it was cleared and recreated
  //     constantly and effectively never fired until you paused).
  useEffect(() => {
    const interval = (settings.auto_save_interval_seconds || 30) * 1000
    const timer = setInterval(async () => {
      const current = paperRef.current
      // Respect the UI lock for autosaves too!
      if (current && !isBusyRef.current) {
        try { await persistPaper(current) } catch { /* keep the timer alive */ }
      }
    }, interval)
    return () => clearInterval(timer)
  }, [settings.auto_save_interval_seconds, persistPaper])

  // ─── Document links ──────────────────────────────
  // Resolve a link target and go there. Anchors are resolved against the
  // papers list (paperId is only a hint; a header moved to another document
  // still resolves). Dangling links are reported rather than failing silently.
  const handleOpenDocLink = useCallback(async (target) => {
    if (!target) return
    const resolved = resolveApTarget(target, papersRef.current)
    if (!resolved) {
      const { blockId } = parseApTarget(target)
      showToast(
        blockId ? 'That link target no longer exists' : 'That linked document no longer exists',
        'error'
      )
      return
    }
    const alreadyOpen = paperRef.current && paperRef.current.id === resolved.paperId
    if (alreadyOpen) pushNav(resolved.paperId, resolved.lineIndex)
    else await handleSelectPaper(resolved.paperId, { lineIndex: resolved.lineIndex })
    if (resolved.lineIndex >= 0) {
      // Give the editor a beat to mount the newly opened document.
      setTimeout(() => {
        blockEditorRef.current?.revealBlock?.(resolved.lineIndex)
      }, alreadyOpen ? 30 : 320)
    }
  }, [handleSelectPaper, pushNav])

  // ─── Creating a link ─────────────────────────────
  // BlockEditor hands us the highlighted phrase; we pick a target, make sure
  // that target has a stable anchor, then let BlockEditor write the link.
  const [linkRequest, setLinkRequest] = useState(null)
  const [showLinksPanel, setShowLinksPanel] = useState(false)
  const [showAskPanel, setShowAskPanel] = useState(false)
  const [showGraph, setShowGraph] = useState(false)

  // ─── Web browser ─────────────────────────────────
  // A native Qt view docked to the right of this whole page (see
  // gui/web_browser.py), so the page only switches it and sends it colors.
  // The pane's own close button reports back through
  // window.ankiPapersSetWebBrowserOpen.
  const [showWebBrowser, setShowWebBrowser] = useState(false)
  useEffect(() => {
    window.ankiPapersSetWebBrowserOpen = (open) => setShowWebBrowser(!!open)
    // A reloaded page (after a renderer crash) finds the pane already open.
    getWebBrowser().then((r) => { if (r?.open) setShowWebBrowser(true) })
    return () => { delete window.ankiPapersSetWebBrowserOpen }
  }, [])
  const toggleWebBrowser = useCallback(() => {
    setShowWebBrowser((v) => !v)
  }, [])
  const webBrowserUsedRef = useRef(false)
  useEffect(() => {
    // Nothing to tell the pane until it has been opened once.
    if (showWebBrowser) webBrowserUsedRef.current = true
    if (!webBrowserUsedRef.current) return
    const css = getComputedStyle(document.documentElement)
    const v = (name) => css.getPropertyValue(name).trim()
    const theme = {
      bg: v('--bg-secondary'), field: v('--bg-tertiary'), fg: v('--text-primary'),
      muted: v('--text-muted'), border: v('--border'), hover: v('--bg-hover'), accent: v('--accent'),
    }
    setWebBrowser(showWebBrowser, theme).then((r) => {
      if (r && !r.error && !!r.open !== showWebBrowser) setShowWebBrowser(!!r.open)
    })
  }, [showWebBrowser, settings?.editor_theme, settings?.color_scheme])

  // Open a document and reveal one of its lines. Used by the backlinks panel,
  // the graph and sidebar search, so all of them land the same way a link
  // does — in Source view too, where the caret moves to that line. Search
  // passes expandAll to unfold the whole paper; the others unfold only the
  // sections the line sits inside.
  const handleGoToLine = useCallback(async (paperId, lineIndex, { expandAll = false, align = 'center' } = {}) => {
    if (!paperId) return
    const alreadyOpen = paperRef.current?.id === paperId
    const line = lineIndex != null && lineIndex >= 0 ? lineIndex : -1
    if (alreadyOpen) pushNav(paperId, line)
    else await handleSelectPaper(paperId, { lineIndex: line })
    if (line >= 0) {
      setTimeout(() => {
        if (viewModeRef.current === 'source') editorRef.current?.goToLine?.(line)
        else blockEditorRef.current?.revealBlock?.(line, { expandAll, align })
      }, alreadyOpen ? 30 : 320)
    }
  }, [handleSelectPaper, pushNav])

  const handleRequestCreateLink = useCallback((req) => {
    if (req?.phrase) setLinkRequest(req)
  }, [])

  const handlePickLinkTarget = useCallback(async (pick) => {
    const req = linkRequest
    setLinkRequest(null)
    if (!req || !pick) return

    const openId = paperRef.current?.id
    const sameDocument = pick.paperId === openId

    // A header in ANOTHER document needs its anchor written over there first.
    // Same-document targets are anchored by BlockEditor in the same edit, so
    // the whole thing lands as one change.
    let targetBlockId = ''
    if (!pick.isDocument && pick.lineIndex >= 0 && !sameDocument) {
      const target = papersRef.current.find((p) => p.id === pick.paperId)
      if (!target) { showToast('That document could not be found', 'error'); return }
      const lines = String(target.content || '').split('\n')
      const anchored = ensureApBlockId(lines[pick.lineIndex] ?? '')
      targetBlockId = anchored.blockId
      if (anchored.changed) {
        lines[pick.lineIndex] = anchored.line
        const res = await savePaper({ ...target, content: lines.join('\n') })
        if (res && res.error) { showToast(`Could not anchor the target: ${res.error}`, 'error'); return }
        await refreshPapers()
      }
    }

    const written = blockEditorRef.current?.insertDocLink({
      index: req.index,
      selStart: req.selStart,
      selEnd: req.selEnd,
      targetPaperId: pick.paperId,
      targetBlockId,
      targetLineIndex: (!pick.isDocument && sameDocument) ? pick.lineIndex : null,
    })
    if (written) showToast(`Linked to ${pick.label}`, 'success')
    else showToast('Could not create the link', 'error')
  }, [linkRequest, refreshPapers])

  // ─── Final save on window close ──────────────────
  // When you close the window, gui/webview.py asks this page — repeatedly —
  // whether it is safe to go yet, and only tears the page down once the answer
  // is 'done'.
  //
  // It has to work by asking rather than by waiting, because Qt's
  // runJavaScript() cannot wait for a Promise: it hands the return value back
  // through a plain value conversion, and a Promise converts to "finished, no
  // result" instantly. That is exactly what went wrong before. The old
  // window.ankiPapersFlush() was an async function, so Qt treated the very
  // first call as complete, closed the window, and cut the bridge out from
  // under a save that had barely started — losing whatever had not reached
  // storage yet.
  //
  // So this returns a plain string, every time, immediately:
  //   'generating' — cards are being written to Anki; interrupting is worst
  //   'saving'     — the document is being written to storage
  //   'done'       — everything is on disk, the window can close
  const closeFlushRef = useRef(null)  // null = not started | 'running' | 'done'
  useEffect(() => {
    window.ankiPapersCloseState = () => {
      // 1. Anything you started yourself finishes first.
      if (isBusyRef.current) return busyKindRef.current || 'saving'
      // 2. Then the state of the one final save, if it has been started.
      if (closeFlushRef.current === 'running') return 'saving'
      if (closeFlushRef.current === 'done') return 'done'
      // 3. Nothing open means nothing to write. Answered fresh every time
      //    rather than latched, so this can never be remembered as 'done'
      //    from an earlier moment when no document happened to be open.
      const current = paperRef.current
      if (!current) return 'done'
      // 4. Start that final save — once, however many times this is called.
      closeFlushRef.current = 'running'
      Promise.resolve()
        .then(() => savePaper(current))
        .catch(() => { /* closing anyway; never strand the window */ })
        .finally(() => { closeFlushRef.current = 'done' })
      return 'saving'
    }

    // Kept for an older gui/webview.py that still calls the flush — the two
    // halves of the add-on are copied into place separately, so a new web/
    // build has to stay compatible with a webview.py that has not been
    // replaced yet.
    window.ankiPapersFlush = async () => {
      const current = paperRef.current
      if (!current) return true
      try {
        await savePaper(current)
      } catch { /* closing anyway — never block the window */ }
      return true
    }

    // A page-level backstop for any teardown that doesn't ask at all.
    const onPageHide = () => {
      const current = paperRef.current
      if (current) { try { savePaper(current) } catch { /* ignore */ } }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      delete window.ankiPapersCloseState
      delete window.ankiPapersFlush
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  // ─── Format Actions ──────────────────────────────
  const openTableDialog = useCallback((mode = 'insert', preset = null) => {
    setTableDialog({
      mode,
      rows: preset?.rows || 2,
      cols: preset?.cols || 2,
    })
  }, [])

  const applyTableDialog = useCallback((payload) => {
    if (viewMode === 'source') {
      if (editorRef.current) editorRef.current.applyFormat('tableApply', payload)
    } else if (viewMode === 'blocks') {
      if (blockEditorRef.current) blockEditorRef.current.applyFormat('tableApply', payload)
    }
    setTableDialog(null)
  }, [viewMode])

  const handleFormat = useCallback(async (action) => {
    if (action === 'insertTable') {
      const ctx = viewMode === 'source'
        ? editorRef.current?.getTableContext?.()
        : blockEditorRef.current?.getTableContext?.()
      openTableDialog(ctx ? 'edit' : 'insert', ctx || undefined)
      return
    }

    if (action === 'insertImage') {
      const result = await pickImage()
      if (!result.canceled && result.markdown) {
        if (viewMode === 'source' && editorRef.current) {
          editorRef.current.applyFormat('insertImageMd', result.markdown)
        } else if (viewMode === 'blocks' && blockEditorRef.current) {
          blockEditorRef.current.applyFormat('insertImageMd', result.markdown)
        }
      }
      return
    }

    if (viewMode === 'source') {
      if (editorRef.current) editorRef.current.applyFormat(action)
    } else if (viewMode === 'blocks') {
      if (blockEditorRef.current) blockEditorRef.current.applyFormat(action)
    }
  }, [viewMode, paper, handleContentChange, openTableDialog])

  // ─── Home ───────────────────────────────────────
  const handleGoHome = useCallback(async () => {
    if (paper) await persistPaper(await reconcileBacklinks(paper))
    setPaper(null)
    setActivePaperId(null)
  }, [paper, persistPaper, reconcileBacklinks])

  // ─── Tabs ───────────────────────────────────────
  const handleCloseTab = useCallback(async (id) => {
    drafts.dropPaper(id)
    const neighbor = removeTab(id)
    if (paperRef.current?.id !== id) return
    if (neighbor) await handleSelectPaper(neighbor)
    else await handleGoHome()
  }, [removeTab, handleSelectPaper, handleGoHome, drafts])

  // ─── PDF Export ──────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    if (!paper || isBusyRef.current) return
    setBusy(true)
    try {
      await persistPaper(paper)
      // Build the printable document here rather than in Python, so the PDF
      // and the document view share one renderer and cannot drift apart.
      let html = ''
      try {
        html = renderPrintHtml(paper, { mediaDir })
      } catch (e) {
        // Never block the export on a rendering fault; Python's older
        // converter still produces something.
        console.error('[Anki Papers] print rendering failed', e)
      }
      const result = await exportPdf(paper.id, html)
      if (result.canceled) return
      if (result.ok) showToast('PDF exported successfully', 'success')
      else if (result.error) showToast(`Export failed: ${result.error}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [paper, mediaDir, setBusy, persistPaper])

  // ─── Markdown Import/Export ─────────────────────
  const handleImportMarkdown = useCallback(async () => {
    const result = await importMarkdown()
    if (result.canceled) return
    if (result.error) { showToast(`Import failed: ${result.error}`, 'error'); return }
    if (result.share) await refreshFolders()
    await refreshPapers()
    setPaper(result)
    setActivePaperId(result.id)
    if (!result.share) { showToast('Markdown imported', 'success'); return }
    const pics = `${result.pictures} picture${result.pictures === 1 ? '' : 's'}`
    const missing = result.missing?.length
      ? ` (${result.missing.length} picture${result.missing.length === 1 ? ' was' : 's were'} missing on the sender's computer)`
      : ''
    showToast(result.kind === 'folder'
      ? `Imported the folder “${result.folder}”: ${result.papers} paper${result.papers === 1 ? '' : 's'}, ${pics}${missing}`
      : `Imported “${result.title}” with ${pics}${missing}`, 'success')
  }, [refreshPapers, refreshFolders])

  // Share: the paper or folder plus every picture it shows, as one .zip.
  const reportShare = useCallback((result, what) => {
    if (!result || result.canceled) return
    if (result.error) { showToast(`Share failed: ${result.error}`, 'error'); return }
    const pics = `${result.pictures} picture${result.pictures === 1 ? '' : 's'}`
    if (result.missing?.length) {
      // It worked; a picture already missing here just couldn't come along.
      showToast(`Shared ${what} with ${pics}. Not found, so left out: ${result.missing.join(', ')}`, 'success')
    } else {
      showToast(`Shared ${what} with ${pics}`, 'success')
    }
  }, [])

  const handleSharePaper = useCallback(async () => {
    if (!paper || isBusyRef.current) return
    setBusy(true)
    try {
      await persistPaper(paper)
      reportShare(await sharePaper(paper.id), `“${paper.title}”`)
    } finally {
      setBusy(false)
    }
  }, [paper, setBusy, persistPaper, reportShare])

  const handleShareFolder = useCallback(async (folderPath) => {
    if (paper) await persistPaper(paper)
    reportShare(await shareFolder(folderPath), `the folder “${folderPath.split('/').pop()}”`)
  }, [paper, persistPaper, reportShare])

  const handleExportMarkdown = useCallback(async () => {
    if (!paper || isBusyRef.current) return
    setBusy(true)
    try {
      await persistPaper(paper)
      const result = await exportMarkdown(paper.id)
      if (result.canceled) return
      if (result.ok) showToast('Markdown exported', 'success')
      else if (result.error) showToast(`Export failed: ${result.error}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [paper, setBusy, persistPaper])

  // ─── Settings ────────────────────────────────────
  // ─── One-time **bold** / *italic* → <b> / <i> conversion ───
  // Settings → "Convert old bold & italic". Runs in Python through the normal
  // save path (disk file and collection copy together), after a backup of
  // every paper. The open paper is saved first and reloaded after, so the
  // editor never holds -- or autosaves -- the pre-conversion text.
  const handleConvertEmphasis = useCallback(async () => {
    if (isBusyRef.current) return
    const open = paperRef.current
    if (open) {
      const res = await persistPaper(await reconcileBacklinks(open))
      if (res?.error) { showToast(`Save failed, nothing converted: ${res.error}`, 'error'); return }
    }
    const plan = await convertEmphasisToTags(true)
    if (plan?.error) { showToast(`Could not check your papers: ${plan.error}`, 'error'); return }
    if (!plan.papers) {
      window.alert('Nothing to convert: none of your papers use ** or * for bold or italic any more.')
      return
    }
    const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
    const ok = window.confirm(
      `Convert ${n(plan.bold, 'bold span')} and ${n(plan.italic, 'italic span')} in ${plan.papers} of your ${n(plan.scanned, 'paper')} ` +
      'from ** and * to <b> and <i> tags?\n\n' +
      'A backup of every paper is saved first. Your cards and the editor will look exactly the same; ' +
      'code and maths are left untouched.'
    )
    if (!ok) return
    setBusy(true, 'saving')
    let res
    try { res = await convertEmphasisToTags(false) } finally { setBusy(false) }
    if (res?.error) { showToast(`Conversion failed: ${res.error}`, 'error'); return }
    await refreshPapers()
    if (open) {
      const reloaded = await loadPaper(open.id)
      if (reloaded) {
        setPaper(reloaded)
        markSaved(reloaded)
        linkBaselineRef.current = { id: reloaded.id, content: reloaded.content }
        historyRef.current = [reloaded.content]
        historyIndexRef.current = 0
      }
    }
    const failed = res.failures || []
    window.alert(
      (failed.length
        ? `Converted ${res.papers - failed.length} of ${res.papers} papers. These could not be saved:\n` +
          failed.map((f) => `• ${f.title}: ${f.error}`).join('\n')
        : `Done: converted ${n(res.bold, 'bold span')} and ${n(res.italic, 'italic span')} in ${n(res.papers, 'paper')}.`) +
      `\n\nBackup of every paper before the change:\n${res.backup}`
    )
  }, [persistPaper, reconcileBacklinks, setBusy, refreshPapers, markSaved])

  const handleSaveSettings = useCallback(async (newSettings) => {
    const res = await saveSettingsBridge(newSettings)
    setSettings(newSettings)
    document.documentElement.dataset.theme = newSettings.editor_theme || 'dark'
    document.documentElement.dataset.scheme = newSettings.color_scheme || 'carolina'
    if (res?.card_style_error) showToast(`Settings saved, but the card style could not be applied: ${res.card_style_error}`, 'error')
    else if (res?.card_style_applied) showToast('Settings saved — card colors and style applied to all your cards', 'success')
    else showToast('Settings saved', 'success')
  }, [])

  // Sidebar preferences are written straight through rather than via
  // handleSaveSettings, which raises a "Settings saved" toast — nobody wants a
  // toast every time they drag a panel edge.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const persistSidebarPrefs = useCallback((next) => {
    const merged = { ...settingsRef.current, ...next }
    setSettings(merged)
    Promise.resolve(saveSettingsBridge(merged)).catch(() => {})
  }, [])

  // Remember which tabs are open across restarts. Skipped until the stored
  // list has been restored, so an empty initial state never overwrites it.
  useEffect(() => {
    if (!tabsLoadedRef.current) return
    if (JSON.stringify(settingsRef.current.open_tabs || []) === JSON.stringify(openTabs)) return
    persistSidebarPrefs({ open_tabs: openTabs })
  }, [openTabs, persistSidebarPrefs])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      persistSidebarPrefs({ sidebar_collapsed: !prev })
      return !prev
    })
  }, [persistSidebarPrefs])

  // Mirror of handleSourcePanelResizeStart, dragging the other way. Below
  // SNAP the drag stops narrowing and collapses instead.
  const handleSidebarResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    let latest = startWidth
    let collapse = false
    const onMove = (ev) => {
      const raw = startWidth + (ev.clientX - startX)
      collapse = raw < SIDEBAR_SNAP_WIDTH
      if (!collapse) {
        latest = clampSidebarWidth(raw)
        setSidebarWidth(latest)
      }
      document.body.classList.toggle('is-sidebar-snapping', collapse)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-resizing-sidebar', 'is-sidebar-snapping')
      if (collapse) {
        // Keep the width it had before the drag, not the squeezed-down value
        // it passed through on the way to the threshold — dragging it away
        // should not also resize it, so it comes back the size you left it.
        setSidebarWidth(startWidth)
        setSidebarCollapsed(true)
        persistSidebarPrefs({ sidebar_collapsed: true, sidebar_width: startWidth })
      } else {
        persistSidebarPrefs({ sidebar_width: latest })
      }
    }
    document.body.classList.add('is-resizing-sidebar')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth, persistSidebarPrefs])

  const handleCardCountChange = useCallback((counts) => { setCardCounts(counts) }, [])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }
  toastRef.current = showToast

  const handleDraftFromEditor = useCallback(() => {
    if (viewModeRef.current === 'source') {
      showToast('Switch to the Editor view to draft cards.', 'error')
      return
    }
    const ctx = blockEditorRef.current?.getDraftContext?.()
    if (!ctx) {
      showToast('Click into a line, or select some lines, to draft cards from.', 'error')
      return
    }
    drafts.startDraft(ctx)
  }, [drafts])

  const handleDeleteFolder = useCallback(async (folderPath) => {
    if (paper) await persistPaper(paper)
    const result = await deleteFolder(folderPath)
    if (result.error) {
      showToast(result.error, 'error')
      return
    }
    setSelectedFolder((prev) => mapSelectedFolderAfterDelete(prev, folderPath))
    setPaper((prev) => {
      if (!prev) return prev
      return { ...prev, folder_path: mapPaperFolderAfterDelete(prev.folder_path || '', folderPath) }
    })
    await refreshFolders()
    await refreshPapers()
    showToast('Folder removed', 'success')
  }, [paper, refreshFolders, refreshPapers, persistPaper])

  const handleRenameFolder = useCallback(async (oldPath, newName) => {
    if (paper) await persistPaper(paper)
    const result = await renameFolder(oldPath, newName)
    if (result.error) {
      showToast(result.error, 'error')
      return
    }
    const newPath = folderPathAfterRename(oldPath, newName)
    setSelectedFolder((prev) => mapSelectedFolderAfterRename(prev, oldPath, newPath))
    setPaper((prev) => {
      if (!prev) return prev
      return { ...prev, folder_path: mapPaperFolderAfterRename(prev.folder_path || '', oldPath, newPath) }
    })
    await refreshFolders()
    await refreshPapers()
    showToast('Folder renamed', 'success')
  }, [paper, refreshFolders, refreshPapers, persistPaper])

  const handleMoveFolder = useCallback(async (folderPath, newParentPath) => {
    if (paper) await persistPaper(paper)
    const result = await moveFolder(folderPath, newParentPath)
    if (result.error) {
      showToast(result.error, 'error')
      return
    }
    const newPath = folderPathAfterMove(folderPath, newParentPath)
    setSelectedFolder((prev) => mapSelectedFolderAfterRename(prev, folderPath, newPath))
    setPaper((prev) => {
      if (!prev) return prev
      return { ...prev, folder_path: mapPaperFolderAfterRename(prev.folder_path || '', folderPath, newPath) }
    })
    await refreshFolders()
    await refreshPapers()
    showToast('Folder moved', 'success')
  }, [paper, refreshFolders, refreshPapers, persistPaper])

  // Generate always saves first, then generates. The busy lock keeps the Save
  // button disabled for the whole operation.
  const runGenerateWithPolicy = useCallback(async (policy) => {
    const paper = paperRef.current
    if (!paper || isBusyRef.current) return
    setBusy(true, 'generating')
    try {
      const saved = await persistPaper(await reconcileBacklinks(paper))
      if (saved && saved.error) {
        showToast(`Save failed, not generating: ${saved.error}`, 'error')
        return
      }
      const result = await generateCards(paper.id, policy)
      await refreshPapers()
      if (result.error === 'anki_edit_conflicts') {
        showToast(
          `Generate stopped: ${result.conflicts?.length ?? 0} card(s) edited in Anki (Settings: abort on conflict)`,
          'error'
        )
        return
      }
      if (result.error) {
        showToast(`Error: ${result.error}`, 'error')
        return
      }
      const reloaded = await loadPaper(paper.id)
      if (reloaded) {
        setPaper(reloaded)
        markSaved(reloaded)
        linkBaselineRef.current = { id: reloaded.id, content: reloaded.content }
      }
      const parts = [`${result.created} created`]
      if (result.updated) parts.push(`${result.updated} updated`)
      if (result.deleted) parts.push(`${result.deleted} removed`)
      showToast(parts.join(', '), 'success')
    } catch (e) {
      showToast(`Generate failed: ${e?.message || e}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [refreshPapers, setBusy, persistPaper, reconcileBacklinks, markSaved])

  // ─── Weak spots and the outline ─────────────────
  // Review stats for the open paper's notes, straight from Anki (read-only).
  // Re-read whenever the paper or its card links change (e.g. after Generate).
  const [noteStats, setNoteStats] = useState(null)
  const [weakOnly, setWeakOnly] = useState(false)
  const [visibleLine, setVisibleLine] = useState(0)
  const visibleLineRef = useRef(0)
  visibleLineRef.current = visibleLine
  const weakMarkersOn = settings.weak_spot_markers !== false
  const paperNoteIds = useMemo(
    () => (paper?.card_refs || []).map((r) => r.anki_note_id).filter((n) => n != null),
    [paper?.card_refs],
  )
  const refreshNoteStats = useCallback(async () => {
    if (!weakMarkersOn || !paperNoteIds.length) { setNoteStats(null); return }
    const res = await getNoteStats(paperNoteIds)
    setNoteStats(res?.stats || null)
  }, [weakMarkersOn, paperNoteIds])
  useEffect(() => { refreshNoteStats() }, [refreshNoteStats])
  useEffect(() => { setWeakOnly(false); setVisibleLine(0) }, [paper?.id])

  const weakCount = useMemo(
    () => (noteStats ? Object.values(noteStats).filter((s) => s && s.status).length : 0),
    [noteStats],
  )
  useEffect(() => { if (weakCount === 0) setWeakOnly(false) }, [weakCount])

  const handleUnsuspendNote = useCallback(async (noteId) => {
    const res = await unsuspendNote(noteId)
    if (res?.error) showToast(`Could not unsuspend: ${res.error}`, 'error')
    else showToast('Card unsuspended', 'success')
    refreshNoteStats()
  }, [refreshNoteStats])

  // The sidebar outline: headings with card counts and weak-spot dots.
  const outline = useMemo(() => {
    if (!paper) return null
    const idx = buildCardRefIndex(paper.card_refs)
    const statusOf = (i, line) => {
      if (!noteStats) return null
      const nid = resolveNoteIdFromIndex(i, line, idx)
      return nid != null ? noteStats[String(nid)]?.status || null : null
    }
    return buildOutline(paper.content, statusOf)
  }, [paper, noteStats])

  const handleGenerate = useCallback(async () => {
    const paper = paperRef.current
    if (!paper || isBusyRef.current) return
    
    const mode = settings.anki_edit_conflict || 'ask'
    if (mode === 'ask') {
      setBusy(true, 'generating')
      let hasConflict = false
      try {
        await persistPaper(paper)
        const chk = await checkAnkiEditConflicts(paper.id)
        if (chk.error) {
          showToast(`Error: ${chk.error}`, 'error')
          return
        }
        if (chk.conflicts?.length > 0) {
          setGenerateConflict(chk.conflicts)
          hasConflict = true
        }
      } finally {
        setBusy(false) // Must unlock here so the user can click the modal
      }
      
      if (hasConflict) return // Stop execution, wait for modal interaction
      
      await runGenerateWithPolicy('preserve')
      return
    }
    
    // If not 'ask', run policy directly (it has its own lock)
    await runGenerateWithPolicy(mode)
  }, [settings.anki_edit_conflict, runGenerateWithPolicy, setBusy, persistPaper])

  // ─── Generate a whole folder ─────────────────────
  // Right-click a folder → "Generate all cards in folder". Runs the same
  // per-paper Generate on every paper in the folder and its subfolders, one at
  // a time, after one confirmation and -- with the "Ask" policy -- one combined
  // conflict choice for the whole folder. busy stays 'generating' for the whole
  // run, so autosave is held off and closing the window waits, exactly as it
  // does for a single Generate.
  const [folderGen, setFolderGen] = useState(null)
  const folderGenPapersRef = useRef([])

  const handleGenerateFolder = useCallback((folderPath) => {
    if (isBusyRef.current) return
    const inFolder = (p) => {
      const f = p.folder_path || ''
      return f === folderPath || f.startsWith(folderPath + '/')
    }
    const list = papersRef.current.filter(inFolder).sort((a, b) =>
      (a.folder_path || '').localeCompare(b.folder_path || '') ||
      (a.title || '').localeCompare(b.title || ''))
    folderGenPapersRef.current = list
    if (!list.length) { setFolderGen({ phase: 'empty', folder: folderPath }); return }
    setFolderGen({
      phase: 'confirm', folder: folderPath, papers: list,
      includesSubfolders: list.some((p) => (p.folder_path || '') !== folderPath),
    })
  }, [])

  const runFolderGenerate = useCallback(async (folder, policy) => {
    const list = folderGenPapersRef.current
    const totals = { created: 0, updated: 0, deleted: 0 }
    const failures = []
    setBusy(true, 'generating')
    try {
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        const title = p.title || 'Untitled'
        setFolderGen({ phase: 'running', folder, index: i, total: list.length, title })
        await letPaint()
        try {
          const res = await generateCards(p.id, policy)
          if (res?.error === 'anki_edit_conflicts') {
            failures.push({ id: p.id, title, reason: `stopped: ${res.conflicts?.length ?? 0} card(s) edited in Anki (Settings: abort on conflict)` })
          } else if (res?.error) {
            failures.push({ id: p.id, title, reason: res.error })
          } else {
            totals.created += res?.created || 0
            totals.updated += res?.updated || 0
            totals.deleted += res?.deleted || 0
          }
        } catch (e) {
          failures.push({ id: p.id, title, reason: e?.message || String(e) })
        }
      }
      await refreshPapers()
      // Generate rewrites a paper on disk (new card links, anchors). If the
      // open paper was in the folder, reload it so the editor -- and its next
      // save -- carry the generated version, not the stale one.
      const open = paperRef.current
      if (open && list.some((p) => p.id === open.id)) {
        const reloaded = await loadPaper(open.id)
        if (reloaded) {
          setPaper(reloaded)
          markSaved(reloaded)
          linkBaselineRef.current = { id: reloaded.id, content: reloaded.content }
        }
      }
    } finally {
      setBusy(false)
    }
    setFolderGen({ phase: 'done', folder, total: list.length, ...totals, failures })
  }, [setBusy, refreshPapers, markSaved])

  const handleConfirmFolderGenerate = useCallback(async () => {
    if (!folderGen || folderGen.phase !== 'confirm') return
    const folder = folderGen.folder
    const list = folderGenPapersRef.current
    document.activeElement?.blur?.()
    // Save the open paper first, so the run uses exactly what is on screen.
    const open = paperRef.current
    if (open) {
      try { await persistPaper(await reconcileBacklinks(open)) } catch { /* its own Generate will report it */ }
    }
    const mode = settingsRef.current.anki_edit_conflict || 'ask'
    if (mode !== 'ask') { await runFolderGenerate(folder, mode); return }

    // "Ask": check every paper first, then offer one combined choice.
    const conflicts = []
    setBusy(true, 'generating')
    try {
      for (let i = 0; i < list.length; i++) {
        setFolderGen({ phase: 'checking', folder, index: i, total: list.length })
        await letPaint()
        try {
          const chk = await checkAnkiEditConflicts(list[i].id)
          for (const c of chk?.conflicts || []) conflicts.push({ ...c, paper_title: list[i].title || 'Untitled' })
        } catch { /* a paper that can't be checked is still generated, and reports its own error */ }
      }
    } finally {
      // Unlocked while the choice is on screen: nothing is running, so
      // closing the window must not be held up by an open dialog.
      setBusy(false)
    }
    if (conflicts.length) { setFolderGen({ phase: 'conflicts', folder, conflicts }); return }
    await runFolderGenerate(folder, 'preserve')
  }, [folderGen, persistPaper, reconcileBacklinks, setBusy, runFolderGenerate])


  // ─── Sources (files and web pages for this paper and its folders) ───
  const [paperSources, setPaperSources] = useState({ paperId: null, list: [] })
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [activeSourceKeys, setActiveSourceKeys] = useState({}) // paperId -> key
  const [sourceJump, setSourceJump] = useState(null) // { key, page, url, quote, nonce }
  const [legacySource, setLegacySource] = useState(null)
  const sourcesPanelRef = useRef(null)

  const refreshSources = useCallback(async (paperId = paperRef.current?.id) => {
    if (!paperId) return
    setSourcesLoading(true)
    const r = await srcForPaper(paperId)
    setSourcesLoading(false)
    if (paperRef.current?.id !== paperId) return
    setPaperSources({ paperId, list: r?.sources || [] })
  }, [])
  useEffect(() => { setLegacySource(null); refreshSources(paper?.id) }, [paper?.id, paper?.folder_path, paper?.title, refreshSources])

  const sourcesList = useMemo(() => {
    const list = paper && paperSources.paperId === paper.id ? paperSources.list : []
    return legacySource ? [...list, legacySource] : list
  }, [paper, paperSources, legacySource])
  const chapterEntry = useMemo(() => sourcesList.find((s) => s.chapter) || null, [sourcesList])
  // The chapter bar: everywhere when Settings → Chapter bar is on; otherwise
  // only on papers whose toolbar book button turned it on.
  const chapterBarGlobal = settings?.show_chapter_bar === true
  const showChapterBar = !!chapterEntry && (chapterBarGlobal || paper?.show_chapter_bar === true)
  const toggleChapterBar = useCallback(async () => {
    const p = paperRef.current
    if (!p) return
    const next = { ...p, show_chapter_bar: !p.show_chapter_bar }
    setPaper(next)
    setPapers((list) => list.map((x) => (x.id === next.id ? { ...x, show_chapter_bar: next.show_chapter_bar } : x)))
    const r = await persistPaper(next)
    if (r?.error) showToast(r.error, 'error')
  }, [persistPaper])
  const activeSourceKey = paper ? activeSourceKeys[paper.id] : null
  const selectSource = useCallback((key) => {
    const pid = paperRef.current?.id
    if (pid) setActiveSourceKeys((m) => ({ ...m, [pid]: key }))
  }, [])

  const handleAttachFile = useCallback(async () => {
    const p = paperRef.current
    if (!p) return
    const r = await srcAttachPaperFile(p.id)
    if (r?.error) { showToast(r.error, 'error'); return }
    if (r?.canceled) return
    await refreshSources(p.id)
    selectSource(`paper::${r.source.id}`)
    setShowSourcePanel(true)
  }, [refreshSources, selectSource])

  const handleAttachWeb = useCallback(async (url) => {
    const p = paperRef.current
    if (!p) return { error: 'No paper open' }
    const r = await srcAttachPaperWeb(p.id, url)
    if (r?.error) return r
    await refreshSources(p.id)
    if (r?.source) selectSource(`paper::${r.source.id}`)
    return r
  }, [refreshSources, selectSource])

  const handleDetachSource = useCallback(async (entry) => {
    const p = paperRef.current
    if (!p) return
    await srcDetachPaper(p.id, entry.source.id)
    await refreshSources(p.id)
  }, [refreshSources])

  const handleCreateChapterPaper = useCallback(async (entry, chapter) => {
    const r = await srcCreateChapterPaper(entry.folder, entry.source.id, chapter.key)
    if (!r || r.error) { showToast(r?.error || 'Couldn’t create the paper', 'error'); return }
    await refreshPapers()
    await handleSelectPaper(r.id)
  }, [refreshPapers, handleSelectPaper])

  const handleChapterStep = useCallback(async (entry, chapter) => {
    if (chapter.paper_id) await handleSelectPaper(chapter.paper_id)
    else await handleCreateChapterPaper(entry, chapter)
  }, [handleSelectPaper, handleCreateChapterPaper])

  // Folder sources: books, web sources and files attached to a folder.
  const [folderSources, setFolderSources] = useState({ folders: {}, waiting: {} })
  const [folderDialog, setFolderDialog] = useState(null) // { mode, folder }
  const refreshFolderSources = useCallback(async () => {
    const r = await srcFoldersSummary()
    if (r?.folders) setFolderSources({ folders: r.folders, waiting: r.waiting || {} })
  }, [])
  useEffect(() => { refreshFolderSources() }, [refreshFolderSources, folders, papers])

  const handleFolderSource = useCallback(async (mode, folder, src) => {
    if (mode === 'remove') {
      const name = folder.split('/').pop()
      if (!window.confirm(`Remove “${src.title}” from ${name}?\n\nYour papers and their cards aren’t changed; they just stop showing this source.`)) return
      const r = await srcFolderDetach(folder, src.id)
      if (r?.error) { showToast(r.error, 'error'); return }
      await refreshFolderSources()
      await refreshSources()
      showToast(`Removed “${src.title}”`, 'success')
      return
    }
    if (mode === 'file') {
      const r = await srcFolderAttachFile(folder)
      if (r?.error) { showToast(r.error, 'error'); return }
      if (r?.canceled) return
      await refreshFolderSources()
      await refreshSources()
      showToast(`Attached to ${folder.split('/').pop()}`, 'success')
      return
    }
    setFolderDialog({ mode, folder })
  }, [refreshFolderSources, refreshSources])

  const handleFolderDialogDone = useCallback(async (result) => {
    const mode = folderDialog?.mode
    if (mode !== 'manage') setFolderDialog(null)
    await refreshFolders()
    await refreshPapers()
    await refreshFolderSources()
    await refreshSources()
    if (result?.source) {
      const made = result.created ? ` · ${result.created} new ${result.created === 1 ? 'paper' : 'papers'}` : ''
      showToast(`Attached “${result.source.title}”${made}`, 'success')
    }
  }, [folderDialog, refreshFolders, refreshPapers, refreshFolderSources, refreshSources])

  const handleCreateWaitingChapter = useCallback(async (folder, w) => {
    const r = await srcCreateChapterPaper(folder, w.source_id, w.key)
    if (!r || r.error) { showToast(r?.error || 'Couldn’t create the paper', 'error'); return }
    await refreshPapers()
    await refreshFolderSources()
    await handleSelectPaper(r.id)
  }, [refreshPapers, refreshFolderSources, handleSelectPaper])

  // Text selected in the Sources panel: Add to notes / Draft cards / Ask.
  const [askSeed, setAskSeed] = useState(null)
  const handleSourceAction = useCallback(async (kind, info) => {
    const p = paperRef.current
    if (!p) return
    const entry = info.sourceEntry
    const flat = (info.text || '').replace(/\r\n/g, '\n').replace(/\s*\n+\s*/g, ' ').replace(/ +/g, ' ').trim()
    const kindOf = entry.source.kind
    const pageLabel = kindOf === 'pptx' && info.page ? `slide ${info.page}`
      : (kindOf === 'pdf' || kindOf === 'legacy-pdf') && info.printedPage ? `p. ${info.printedPage}` : null
    const srcMeta = {
      source_id: entry.source.id, kind: kindOf, page: info.page || null, pageLabel,
      url: info.url || null, quote: flat.slice(0, 400), title: entry.source.title,
    }
    if (kind === 'ask') {
      setAskSeed({ quote: flat, label: info.label, nonce: Date.now() })
      setShowAskPanel(true)
      return
    }
    if (viewModeRef.current === 'source') {
      showToast('Switch to the Editor view first.', 'error')
      return
    }
    const anchor = blockEditorRef.current?.getDraftAnchor?.(visibleLineRef.current)
    if (!anchor) return
    if (kind === 'draft') {
      drafts.startDraft({
        text: flat, headingPath: anchor.headingPath, existing: [], anchorId: anchor.anchorId,
        label: pageLabel ? `${entry.source.title}, ${pageLabel}` : info.label,
        source: srcMeta,
      })
      return
    }
    const ids = blockEditorRef.current?.insertLinesAfter?.(anchor.anchorId, [flat]) || []
    if (ids[0]) {
      await saveSourceLink(p.id, ids[0], {
        source_type: 'attached', source_uri: entry.source.id,
        locator: { page: info.page || null, url: info.url || null }, captured_text: flat,
      })
    }
    showToast('Added to your notes', 'success')
  }, [drafts])

  // Ask panel: put an answer into the paper, or draft cards from it.
  const answerAnchor = useCallback((lineIndex) => {
    const ed = blockEditorRef.current
    if (!ed || viewModeRef.current === 'source') { showToast('Switch to the Editor view first.', 'error'); return null }
    return (lineIndex != null && ed.getAnchorForLine?.(lineIndex)) || ed.getDraftAnchor?.(visibleLineRef.current) || null
  }, [])
  const handleInsertSupplement = useCallback((text, lineIndex) => {
    const anchor = answerAnchor(lineIndex)
    if (!anchor || !text) return
    blockEditorRef.current.insertLinesAfter(anchor.anchorId, [`&& ${text.replace(/\s*\n+\s*/g, ' ')}`])
    showToast('Added as an && supplement', 'success')
  }, [answerAnchor])
  const handleDraftFromAnswer = useCallback((text, lineIndex) => {
    const anchor = answerAnchor(lineIndex)
    if (!anchor || !text) return
    drafts.startDraft({ text, headingPath: anchor.headingPath, existing: [], anchorId: anchor.anchorId, label: 'the answer' })
  }, [answerAnchor, drafts])
  const handleOpenSourceAt = useCallback((entry, page) => {
    const key = sourceKey(entry)
    selectSource(key)
    setSourceJump({ key, page: page || null, url: null, quote: null, nonce: Date.now() })
    setShowSourcePanel(true)
  }, [selectSource])

  const handleGoToSource = useCallback(async ({ lineIndex }) => {
    const p = paperRef.current
    if (!p) return
    const line = (p.content || '').split('\n')[lineIndex] || ''
    const blockId = getApBlockId(line)
    const link = blockId ? await loadSourceLink(p.id, blockId) : null
    if (!link || link.error) {
      showToast('This line wasn’t added from a source.', 'error')
      return
    }
    const quote = (link.captured_text || '').trim() || null
    if (link.source_type === 'attached') {
      const entry = sourcesList.find((s) => s.source.id === link.source_uri)
      if (!entry) { showToast('That source isn’t attached to this paper any more.', 'error'); return }
      const key = sourceKey(entry)
      selectSource(key)
      setSourceJump({ key, page: link.locator?.page || null, url: link.locator?.url || null, quote, nonce: Date.now() })
      setShowSourcePanel(true)
      return
    }
    if (link.source_type === 'pdf' && link.source_uri) {
      // Lines added from the old one-off PDF panel: open that file again.
      const entry = { scope: 'legacy', folder: '', legacyPath: link.source_uri,
        source: { id: 'legacy', kind: 'legacy-pdf', title: link.source_uri.split('/').pop(), available: true } }
      setLegacySource(entry)
      selectSource(sourceKey(entry))
      setSourceJump({ key: sourceKey(entry), page: link.locator?.page || 1, quote, nonce: Date.now() })
      setShowSourcePanel(true)
      return
    }
    if (link.source_uri) await openUrl(link.source_uri)
  }, [sourcesList, selectSource])

  const handleSourcePanelResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sourcePanelWidth
    const onMove = (ev) => {
      setSourcePanelWidth(clampSourcePanelWidth(startWidth - (ev.clientX - startX)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-resizing-sources')
    }
    // The class stops the PDF / web frames taking the pointer mid-drag: a
    // frame keeps its mouse events to itself, so narrowing the panel stalled
    // as soon as the cursor crossed onto the page.
    document.body.classList.add('is-resizing-sources')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sourcePanelWidth])

  // Shrinking the window pulls the panel back to half of it.
  useEffect(() => {
    const onResize = () => setSourcePanelWidth((w) => clampSourcePanelWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ─── Keyboard Shortcuts ──────────────────────────
  useEffect(() => {
    const handle = (e) => {
      // The lock completely ignores global keystrokes while busy
       if ((isBusyRef.current || Date.now() < keyboardLockUntilRef.current) && e.ctrlKey && (e.key === 's' || e.key === 'g')) {
        e.preventDefault()
        return
      }

      // Subscript / superscript: Control+5 and Control+6 -- the Control key on
      // every platform, macOS included, like the rest of the app's shortcuts.
      // (Shift+Cmd+- / Shift+Cmd+= were tried first and never reached the page
      // inside Anki on macOS.) Matched on e.key like the shortcuts that do
      // work, with e.code as a fallback for layouts where the digit row needs
      // Shift.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const sub = e.key === '5' || e.code === 'Digit5'
        const sup = e.key === '6' || e.code === 'Digit6'
        if (sub || sup) {
          e.preventDefault()
          handleFormat(sub ? 'subscript' : 'superscript')
          return
        }
      }

      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSave() }
      else if (e.ctrlKey && e.key === 'g') { e.preventDefault(); handleGenerate() }
      else if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); setViewMode(v => v === 'blocks' ? 'source' : 'blocks') }
      else if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd') && aiOnRef.current) { e.preventDefault(); handleDraftFromEditor() }
      else if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a') && aiOnRef.current) { e.preventDefault(); setShowAskPanel((v) => !v) }
      else if (e.ctrlKey && e.key === 'b') { e.preventDefault(); handleFormat('bold') }
      else if (e.ctrlKey && e.key === 'i') { e.preventDefault(); handleFormat('italic') }
      // Underline: <u>, toggled like subscript. Control on macOS too, like Ctrl+B / Ctrl+I.
      else if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'u' || e.code === 'KeyU')) { e.preventDefault(); handleFormat('underline') }
      else if (e.ctrlKey && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      else if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); handleUndo() }
      else if (e.ctrlKey && e.shiftKey && e.key === 'Z') { e.preventDefault(); handleRedo() }
      else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo() }
      else if (e.ctrlKey && e.key === '\\') { e.preventDefault(); toggleSidebar() }
      else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1) }
      else if (e.ctrlKey && e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goHistory(-1) }
      else if (e.ctrlKey && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goHistory(1) }
    }
    // Mouse back / forward buttons, as in a browser.
    const onMouse = (e) => {
      if (e.button === 3) { e.preventDefault(); goHistory(-1) }
      else if (e.button === 4) { e.preventDefault(); goHistory(1) }
    }
    window.addEventListener('keydown', handle)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', handle)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [handleSave, handleGenerate, handleFormat, handleUndo, handleRedo, toggleSidebar, cycleTab, goHistory, handleDraftFromEditor])

  // ─── External API ───────────────────────────────
  useEffect(() => {
    window.jumpToBlock = async (source) => {
      const [paperId, lineIndex] = source.split(':')
      if (paperId && lineIndex !== undefined) {
        await handleSelectPaper(paperId)
        setTimeout(() => {
          if (blockEditorRef.current) {
            blockEditorRef.current.focusBlock(parseInt(lineIndex))
          }
        }, 300)
      }
    }
    
    window.openZettel = async (title) => {
      if (!title) return
      const targetQuery = title.trim().toLowerCase().replace(/\s+/g, ' ')
      const p = papers.find(pp => {
        const t = (pp.title || '').trim().toLowerCase().replace(/\s+/g, ' ')
        return t === targetQuery
      })
      if (p) {
         await handleSelectPaper(p.id)
      } else {
         showToast(`Paper not found: ${title}`, 'error')
      }
    }

    return () => { 
       delete window.jumpToBlock
       delete window.openZettel 
    }
  }, [handleSelectPaper, papers])

  // ─── Render ──────────────────────────────────────
  const aiOn = settings?.ai_enabled !== false
  aiOnRef.current = aiOn
  const draftGroup = paper ? drafts.groupFor(paper.id) : null
  const saved = savedRef.current
  const paperDirty = !!paper && saved.id === paper.id &&
    (paper.content !== saved.content || paper.title !== saved.title)

  return (
    <div className="app">
      <Sidebar
        papers={papers} folders={folders} activePaperId={activePaperId}
        onSelectPaper={handleSelectPaper} onCreatePaper={handleCreatePaper}
        onGoToLine={(id, line) => handleGoToLine(id, line, { expandAll: true })}
        onDeletePaper={handleDeletePaper} onCreateFolder={handleCreateFolder}
        onMovePaper={handleMovePaper}
        onSelectFolder={setSelectedFolder} selectedFolder={selectedFolder}
        onGoHome={handleGoHome}
        onOpenSettings={() => setShowSettings(true)}
        onDeleteFolder={handleDeleteFolder}
        onRenameFolder={handleRenameFolder}
        onGenerateFolder={handleGenerateFolder}
        onShareFolder={handleShareFolder}
        onMoveFolder={handleMoveFolder}
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onToggleCollapse={toggleSidebar}
        outline={outline}
        outlineTitle={paper?.title || ''}
        outlineCurrentLine={visibleLine}
        currentPaper={paper}
        folderSources={folderSources}
        onFolderSource={handleFolderSource}
        onCreateWaitingChapter={handleCreateWaitingChapter}
        showWaiting={settings?.show_waiting_chapters === true}
        onJumpToHeading={(lineIndex) => {
          if (!paper) return
          setVisibleLine(lineIndex) // short papers may not scroll, so mark it now
          handleGoToLine(paper.id, lineIndex, { align: 'start' })
        }}
      />

      {!sidebarCollapsed && (
        <div
          className="sidebar-resizer"
          onMouseDown={handleSidebarResizeStart}
          onDoubleClick={toggleSidebar}
          title="Drag to resize — drag left to collapse, double-click to hide"
          role="separator"
          aria-orientation="vertical"
        />
      )}

      <div className="main-content">
        <TabBar
          tabs={openTabs}
          papers={papers}
          activePaperId={paper?.id ?? null}
          activeTitle={paper?.title}
          activeDirty={paperDirty}
          onSelect={handleSelectPaper}
          onClose={handleCloseTab}
          onRename={handleRenamePaper}
        />
        {paper ? (
          <>
            <EditorHeader
              canBack={navState.canBack} canForward={navState.canForward}
              onBack={() => goHistory(-1)} onForward={() => goHistory(1)}
              deckName={paper.deck_name} decks={decks}
              viewMode={viewMode} showSourcePanel={showSourcePanel}
              showLinksPanel={showLinksPanel}
              onFormat={handleFormat}
              onDeckChange={handleDeckChange} onViewChange={setViewMode}
              onToggleSource={() => setShowSourcePanel((v) => !v)}
              onToggleLinks={() => setShowLinksPanel((v) => !v)}
              onExportPdf={handleExportPdf} onExportMarkdown={handleExportMarkdown}
              onImportMarkdown={handleImportMarkdown}
              onShare={handleSharePaper}
              aiEnabled={aiOn}
              onDraftCards={handleDraftFromEditor}
              sourceCount={sourcesList.length}
              showAskPanel={showAskPanel}
              onToggleAsk={() => setShowAskPanel((v) => !v)}
              showWebBrowser={showWebBrowser}
              onToggleWebBrowser={toggleWebBrowser}
              scrollable={!!settings?.toolbar_scroll}
              chapterBar={chapterEntry ? { global: chapterBarGlobal, on: showChapterBar, onToggle: toggleChapterBar } : null}
            />

            {showChapterBar && <ChapterStrip entry={chapterEntry} onGo={handleChapterStep} />}
            <div className="editor-area">
              {viewMode === 'source' ? (
                <SourceEditor
                  key={paper.id}
                  ref={editorRef}
                  textReplacements={textReplacements}
                  onHistoryCheckpoint={handleHistoryCheckpoint}
                  content={paper.content}
                  onChange={handleContentChange}
                  onCardCountChange={handleCardCountChange}
                  settings={settings}
                  cardRefs={paper.card_refs}
                />
              ) : (
                <BlockEditor
                  key={paper.id}
                  ref={blockEditorRef}
                  textReplacements={textReplacements}
                  onHistoryCheckpoint={handleHistoryCheckpoint}
                  content={paper.content}
                  onChange={handleContentChange}
                  onCardCountChange={handleCardCountChange}
                  settings={settings}
                  mediaDir={mediaDir}
                  cardRefs={paper.card_refs}
                  papers={papers}
                  onTableEditRequest={(ctx) => openTableDialog('edit', ctx)}
                  onGoToSource={handleGoToSource}
                  onOpenDocLink={handleOpenDocLink}
                  onRequestCreateLink={handleRequestCreateLink}
                  onNotify={showToast}
                  noteStats={noteStats}
                  weakOnly={weakOnly}
                  onUnsuspendNote={handleUnsuspendNote}
                  onVisibleLineChange={setVisibleLine}
                  draftGroup={draftGroup}
                  onRequestDraft={aiOn ? drafts.startDraft : null}
                  onDraftAccept={(inserted) => drafts.accept(paper.id, inserted)}
                  onDraftDiscard={(ids) => drafts.discard(paper.id, ids)}
                  onDraftRedo={(id) => drafts.redo(paper.id, id)}
                  onDraftEdit={(id, text) => drafts.edit(paper.id, id, text)}
                  onDraftRedraft={() => drafts.redraft(paper.id)}
                  onDraftCancel={() => drafts.cancel(paper.id)}
                  onOpenAiSettings={openAiSettings}
                />
              )}
            </div>

            <BottomToolbar 
              cardCounts={cardCounts} 
              viewMode={viewMode}
              modifiedAt={paper.modified_at}
              onSave={handleSave} 
              onGenerate={handleGenerate} 
              isSaving={isBusy} // Passes lock state to toolbar UI
              weakCount={weakMarkersOn ? weakCount : 0}
              draftCount={draftGroup?.items?.length || 0}
              weakOnly={weakOnly}
              onToggleWeakOnly={() => setWeakOnly((v) => !v)}
            />
          </>
        ) : (
          <WelcomeScreen
            papers={papers}
            selectedFolder={selectedFolder}
            onSelectPaper={handleSelectPaper}
            onCreatePaper={handleCreatePaper}
            onImportMarkdown={handleImportMarkdown}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      </div>
      {showLinksPanel && paper && (
        <LinksPanel
          papers={papers}
          paperId={paper.id}
          onOpenLink={handleOpenDocLink}
          onGoToLine={handleGoToLine}
          onOpenGraph={() => setShowGraph(true)}
          onClose={() => setShowLinksPanel(false)}
        />
      )}
      {showAskPanel && paper && aiOn && (
        <AskPanel
          paper={paper}
          papers={papers.map((p) => (p.id === paper.id ? paper : p))}
          sourcesPanelRef={sourcesPanelRef}
          sources={sourcesList}
          activeKey={activeSourceKey}
          seed={askSeed}
          onClose={() => setShowAskPanel(false)}
          onInsertSupplement={handleInsertSupplement}
          onDraftFromAnswer={handleDraftFromAnswer}
          onGoToLine={(i) => handleGoToLine(paper.id, i)}
          onOpenSourceAt={handleOpenSourceAt}
          onNotify={(m) => showToast(m, 'success')}
        />
      )}
      {showSourcePanel && paper && (
        <>
          <div className="source-panel-resizer" onMouseDown={handleSourcePanelResizeStart} />
          <div style={{ width: sourcePanelWidth, minWidth: sourcePanelWidth }}>
            <SourcesPanel
              ref={sourcesPanelRef}
              paper={paper}
              sources={sourcesList}
              loading={sourcesLoading}
              activeKey={activeSourceKey}
              onSelectKey={selectSource}
              jump={sourceJump}
              aiEnabled={aiOn}
              onAttachFile={handleAttachFile}
              onAttachWeb={handleAttachWeb}
              onDetach={handleDetachSource}
              onRemoveSource={(entry) => (entry.scope === 'folder'
                ? handleFolderSource('remove', entry.folder, { id: entry.source.id, title: entry.source.title })
                : (window.confirm(`Remove “${entry.source.title}” from this paper? Lines you added from it keep their text.`) && handleDetachSource(entry)))}
              onClose={() => setShowSourcePanel(false)}
              onAction={handleSourceAction}
              onOpenPaper={(id) => handleSelectPaper(id)}
              onCreateChapterPaper={handleCreateChapterPaper}
            />
          </div>
        </>
      )}
      {showSettings && <Settings settings={settings} onSave={handleSaveSettings} onClose={() => { setShowSettings(false); setSettingsSection(null) }}
        initialSection={settingsSection}
        onConvertEmphasis={() => { setShowSettings(false); handleConvertEmphasis() }} />}
      <FolderGenerateDialog
        state={folderGen && folderGen.phase !== 'conflicts' ? folderGen : null}
        onConfirm={handleConfirmFolderGenerate}
        onClose={() => setFolderGen(null)}
      />
      {folderGen?.phase === 'conflicts' && (
        <GenerateConflictModal
          conflicts={folderGen.conflicts}
          onCancel={() => setFolderGen(null)}
          onKeepAnki={() => runFolderGenerate(folderGen.folder, 'preserve')}
          onUsePaper={() => runFolderGenerate(folderGen.folder, 'overwrite')}
        />
      )}
      {generateConflict && (
        <GenerateConflictModal
          conflicts={generateConflict}
          onCancel={() => setGenerateConflict(null)}
          onKeepAnki={async () => {
            setGenerateConflict(null)
            await runGenerateWithPolicy('preserve')
          }}
          onUsePaper={async () => {
            setGenerateConflict(null)
            await runGenerateWithPolicy('overwrite')
          }}
        />
      )}
      {showGraph && (
        <ErrorBoundary label="The link graph" onClose={() => setShowGraph(false)}>
          <GraphView
            papers={papers}
            currentPaperId={paper?.id}
            onOpen={(pid, lineIndex) => { setShowGraph(false); handleGoToLine(pid, lineIndex) }}
            onClose={() => setShowGraph(false)}
          />
        </ErrorBoundary>
      )}

      {folderDialog && (
        <FolderSourceDialog
          folder={folderDialog.folder}
          mode={folderDialog.mode}
          onClose={() => setFolderDialog(null)}
          onDone={handleFolderDialogDone}
        />
      )}

      {linkRequest && (
        <LinkPicker
          phrase={linkRequest.phrase}
          papers={papers}
          onPick={handlePickLinkTarget}
          onClose={() => setLinkRequest(null)}
        />
      )}

      {tableDialog && (
        <TableDialog
          mode={tableDialog.mode}
          initialRows={tableDialog.rows}
          initialCols={tableDialog.cols}
          onApply={applyTableDialog}
          onClose={() => setTableDialog(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  )
}