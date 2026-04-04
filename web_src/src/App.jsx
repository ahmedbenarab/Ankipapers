import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  initBridge, listPapers, loadPaper, savePaper, createPaper, deletePaper,
  generateCards, checkAnkiEditConflicts, getDecks, createFolder, getFolders, movePaperToFolder,
  pickImage, pasteImage, exportPdf, exportMarkdown, importMarkdown, getSettings, saveSettings as saveSettingsBridge,
  getMediaDir, openInBrowser, moveCardsToDeck,
} from './bridge'
import Sidebar from './components/Sidebar'
import EditorHeader from './components/EditorHeader'
import FormattingToolbar from './components/FormattingToolbar'
import SourceEditor from './components/SourceEditor'
import BlockEditor from './components/BlockEditor'
import BottomToolbar from './components/BottomToolbar'
import WelcomeScreen from './components/WelcomeScreen'
import Toast from './components/Toast'
import Settings from './components/Settings'
import GenerateConflictModal from './components/GenerateConflictModal'

export default function App() {
  const [papers, setPapers] = useState([])
  const [folders, setFolders] = useState({ name: 'Root', children: [] })
  const [activePaperId, setActivePaperId] = useState(null)
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
  const editorRef = useRef(null)
  const blockEditorRef = useRef(null)

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
      // Apply theme
      document.documentElement.dataset.theme = s.editor_theme || 'dark'
      const md = await getMediaDir()
      setMediaDir(md.path || '')
    })
  }, [])

  const refreshPapers = useCallback(async () => { setPapers(await listPapers()) }, [])
  const refreshDecks = useCallback(async () => { setDecks(await getDecks()) }, [])
  const refreshFolders = useCallback(async () => { setFolders(await getFolders()) }, [])

  // ─── Paper Operations ────────────────────────────
  const handleSelectPaper = useCallback(async (id) => {
    if (paper && paper.id !== id) {
      await savePaper(paper)
    }
    const loaded = await loadPaper(id)
    if (loaded) {
      setPaper(loaded)
      setActivePaperId(id)
      historyRef.current = [loaded.content]
      historyIndexRef.current = 0
    }
  }, [paper])

  const handleCreatePaper = useCallback(async (title, folderPath = '') => {
    const newPaper = await createPaper(title, folderPath)
    await refreshPapers()
    setPaper(newPaper)
    setActivePaperId(newPaper.id)
    showToast('Paper created', 'success')
  }, [refreshPapers])

  const handleDeletePaper = useCallback(async (id) => {
    await deletePaper(id)
    if (activePaperId === id) { setPaper(null); setActivePaperId(null) }
    await refreshPapers()
    showToast('Paper deleted', 'success')
  }, [activePaperId, refreshPapers])

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

  const handleContentChange = useCallback((newContent) => {
    if (!paper) return
    setPaper(prev => ({ ...prev, content: newContent, modified_at: Date.now() / 1000 }))
    clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => pushHistory(newContent), 400)
  }, [paper, pushHistory])

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

  const handleTitleChange = useCallback((newTitle) => {
    if (!paper) return
    setPaper(prev => ({ ...prev, title: newTitle }))
  }, [paper])

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
  const handleSave = useCallback(async () => {
    if (!paper) return
    await savePaper(paper)
    await refreshPapers()
    showToast('Saved ✓', 'success')
  }, [paper, refreshPapers])

  // ─── Auto-save ───────────────────────────────────
  useEffect(() => {
    if (!paper) return
    const interval = (settings.auto_save_interval_seconds || 30) * 1000
    const timer = setInterval(async () => { await savePaper(paper) }, interval)
    return () => clearInterval(timer)
  }, [paper, settings.auto_save_interval_seconds])

  // ─── Format Actions ──────────────────────────────
  const handleFormat = useCallback(async (action) => {
    if (action === 'insertImage') {
      const result = await pickImage()
      if (!result.cancelled && result.markdown) {
        if (viewMode === 'source' && editorRef.current) {
          editorRef.current.applyFormat('insertImageMd', result.markdown)
        } else if (viewMode === 'blocks') {
          // Insert image markdown as a new line
          const lines = paper.content.split('\n')
          lines.push(result.markdown)
          handleContentChange(lines.join('\n'))
        }
      }
      return
    }

    if (viewMode === 'source') {
      if (editorRef.current) editorRef.current.applyFormat(action)
    } else if (viewMode === 'blocks') {
      if (blockEditorRef.current) blockEditorRef.current.applyFormat(action)
    }
  }, [viewMode, paper, handleContentChange])

  // ─── Home ───────────────────────────────────────
  const handleGoHome = useCallback(async () => {
    if (paper) await savePaper(paper)
    setPaper(null)
    setActivePaperId(null)
  }, [paper])

  // ─── PDF Export ──────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    if (!paper) return
    await savePaper(paper)
    const result = await exportPdf(paper.id)
    if (result.cancelled) return
    if (result.ok) {
      showToast('PDF exported successfully', 'success')
    } else if (result.error) {
      showToast(`Export failed: ${result.error}`, 'error')
    }
  }, [paper])

  // ─── Markdown Import/Export ─────────────────────
  const handleImportMarkdown = useCallback(async () => {
    const result = await importMarkdown()
    if (result.cancelled) return
    if (result.error) { showToast(`Import failed: ${result.error}`, 'error'); return }
    await refreshPapers()
    setPaper(result)
    setActivePaperId(result.id)
    showToast('Markdown imported', 'success')
  }, [refreshPapers])

  const handleExportMarkdown = useCallback(async () => {
    if (!paper) return
    await savePaper(paper)
    const result = await exportMarkdown(paper.id)
    if (result.cancelled) return
    if (result.ok) showToast('Markdown exported', 'success')
    else if (result.error) showToast(`Export failed: ${result.error}`, 'error')
  }, [paper])

  // ─── Settings ────────────────────────────────────
  const handleSaveSettings = useCallback(async (newSettings) => {
    await saveSettingsBridge(newSettings)
    setSettings(newSettings)
    // Apply theme immediately
    document.documentElement.dataset.theme = newSettings.editor_theme || 'dark'
    showToast('Settings saved', 'success')
  }, [])

  const handleCardCountChange = useCallback((counts) => { setCardCounts(counts) }, [])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const runGenerateWithPolicy = useCallback(async (policy) => {
    if (!paper) return
    await savePaper(paper)
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
    if (reloaded) setPaper(reloaded)
    const parts = [`${result.created} created`]
    if (result.updated) parts.push(`${result.updated} updated`)
    if (result.deleted) parts.push(`${result.deleted} removed`)
    showToast(parts.join(', '), 'success')
  }, [paper, refreshPapers])

  const handleGenerate = useCallback(async () => {
    if (!paper) return
    await savePaper(paper)
    const mode = settings.anki_edit_conflict || 'ask'
    if (mode === 'ask') {
      const chk = await checkAnkiEditConflicts(paper.id)
      if (chk.error) {
        showToast(`Error: ${chk.error}`, 'error')
        return
      }
      if (chk.conflicts?.length > 0) {
        setGenerateConflict(chk.conflicts)
        return
      }
      await runGenerateWithPolicy('preserve')
      return
    }
    await runGenerateWithPolicy(mode)
  }, [paper, settings.anki_edit_conflict, runGenerateWithPolicy])

  // ─── Keyboard Shortcuts ──────────────────────────
  useEffect(() => {
    const handle = (e) => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSave() }
      else if (e.ctrlKey && e.key === 'g') { e.preventDefault(); handleGenerate() }
      else if (e.ctrlKey && e.shiftKey && e.key === 'V') { e.preventDefault(); setViewMode(v => v === 'blocks' ? 'source' : 'blocks') }
      else if (e.ctrlKey && e.key === 'b') { e.preventDefault(); handleFormat('bold') }
      else if (e.ctrlKey && e.key === 'i') { e.preventDefault(); handleFormat('italic') }
      else if (e.ctrlKey && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      else if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); handleUndo() }
      else if (e.ctrlKey && e.shiftKey && e.key === 'Z') { e.preventDefault(); handleRedo() }
      else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [handleSave, handleGenerate, handleFormat, handleUndo, handleRedo])

  // ─── External API ───────────────────────────────
  useEffect(() => {
    window.jumpToBlock = async (source) => {
      // source is "paper_id:line_index"
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
    return () => { delete window.jumpToBlock }
  }, [handleSelectPaper])

  // ─── Render ──────────────────────────────────────
  return (
    <div className="app">
      <Sidebar
        papers={papers} folders={folders} activePaperId={activePaperId}
        onSelectPaper={handleSelectPaper} onCreatePaper={handleCreatePaper}
        onDeletePaper={handleDeletePaper} onCreateFolder={handleCreateFolder}
        onMovePaper={handleMovePaper}
        onSelectFolder={setSelectedFolder} selectedFolder={selectedFolder}
        onGoHome={handleGoHome}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="main-content">
        {paper ? (
          <>
            <EditorHeader
              title={paper.title} deckName={paper.deck_name} decks={decks}
              viewMode={viewMode} onTitleChange={handleTitleChange}
              onDeckChange={handleDeckChange} onViewChange={setViewMode}
              onExportPdf={handleExportPdf} onExportMarkdown={handleExportMarkdown}
              onImportMarkdown={handleImportMarkdown}
            />
            <FormattingToolbar onFormat={handleFormat} />

            <div className="editor-area">
              {viewMode === 'source' ? (
                <SourceEditor
                  key={paper.id}
                  ref={editorRef}
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
                  content={paper.content}
                  onChange={handleContentChange}
                  onCardCountChange={handleCardCountChange}
                  settings={settings}
                  mediaDir={mediaDir}
                  cardRefs={paper.card_refs}
                />
              )}
            </div>

            <BottomToolbar cardCounts={cardCounts} onSave={handleSave} onGenerate={handleGenerate} />

            <div className="status-bar">
              <span>Anki Papers</span>
              <span className="spacer" />
              <span className="status-mode">{viewMode === 'source' ? '✎ SOURCE' : '◻ EDITOR'}</span>
              <span>Modified: {new Date(paper.modified_at * 1000).toLocaleTimeString()}</span>
            </div>
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
      {showSettings && <Settings settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
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
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  )
}
