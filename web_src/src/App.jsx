import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  initBridge, listPapers, loadPaper, savePaper, createPaper, deletePaper,
  generateCards, checkAnkiEditConflicts, getDecks, createFolder, getFolders, movePaperToFolder,
  deleteFolder, renameFolder, moveFolder,
  pickImage, pasteImage, exportPdf, exportMarkdown, importMarkdown, getSettings, saveSettings as saveSettingsBridge,
  getMediaDir, openInBrowser, moveCardsToDeck, extractPdfText, extractWebText, saveSourceLink, loadSourceLink, openSourceAtLocation,
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
import TableDialog from './components/TableDialog'
import SourcePanel from './components/SourcePanel'

const BLOCK_ID_RE = /<!--ap:([0-9a-f-]{36})-->\s*$/i
const randomId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const withBlockId = (line) => BLOCK_ID_RE.test(line || '') ? line : `${line || ''} <!--ap:${randomId()}-->`
const getBlockIdFromLine = (line) => {
  const m = (line || '').match(BLOCK_ID_RE)
  return m ? m[1] : null
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
  const [sourceState, setSourceState] = useState({ type: 'pdf', path: '', url: '', page: 1, jumpQuote: null })
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
  }, [viewMode, paper, handleContentChange, openTableDialog])

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

  const handleDeleteFolder = useCallback(async (folderPath) => {
    if (paper) await savePaper(paper)
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
  }, [paper, refreshFolders, refreshPapers])

  const handleRenameFolder = useCallback(async (oldPath, newName) => {
    if (paper) await savePaper(paper)
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
  }, [paper, refreshFolders, refreshPapers])

  const handleMoveFolder = useCallback(async (folderPath, newParentPath) => {
    if (paper) await savePaper(paper)
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
  }, [paper, refreshFolders, refreshPapers])

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

  const handleExtractFromSource = useCallback(async ({ mode, page, customText }) => {
    if (!paper) return
    const trimmedSelection = (customText || '').trim()
    let extracted = null
    if (mode === 'pdf') {
      // Text selected in the viewer — use it directly; skip Python (often empty on scanned PDFs).
      if (trimmedSelection) {
        extracted = {
          ok: true,
          text: '',
          path: (sourceState.path || '').replace(/\\/g, '/'),
          page: Number(page || sourceState.page || 1),
        }
      } else {
        extracted = await extractPdfText(sourceState.path || '', Number(page || sourceState.page || 1))
      }
    } else {
      extracted = await extractWebText(sourceState.url || '')
    }
    if (!extracted || extracted.error) {
      showToast(extracted?.error || 'Extraction failed', 'error')
      return
    }
    const rawNote = trimmedSelection || extracted.text || ''
    if (!rawNote.trim()) {
      showToast('No extracted text', 'error')
      return
    }
    // One block = one source line; newlines in PDF selection would split the document on next load.
    const noteText = rawNote.replace(/\r\n/g, '\n').replace(/\s*\n+\s*/g, ' ').replace(/ +/g, ' ').trim()
    const lines = (paper.content || '').split('\n')
    const idx = lines.length
    lines.push(withBlockId(noteText))
    const updated = { ...paper, content: lines.join('\n'), modified_at: Date.now() / 1000 }
    setPaper(updated)
    const blockId = getBlockIdFromLine(lines[idx])
    if (blockId) {
      await saveSourceLink(updated.id, blockId, {
        source_type: mode,
        source_uri: mode === 'pdf' ? (sourceState.path || extracted.path || '') : (sourceState.url || extracted.url || ''),
        locator: mode === 'pdf' ? { page: Number(page || sourceState.page || 1) } : {},
        captured_text: noteText,
      })
    }
    showToast('Extracted text added to notes', 'success')
  }, [paper, sourceState])

  const handleGoToSource = useCallback(async ({ lineIndex }) => {
    if (!paper) return
    const lines = (paper.content || '').split('\n')
    const line = lines[lineIndex] || ''
    const blockId = getBlockIdFromLine(line)
    if (!blockId) {
      showToast('No source link for this block', 'error')
      return
    }
    const link = await loadSourceLink(paper.id, blockId)
    if (!link || link.error) {
      showToast('Source link not found', 'error')
      return
    }
    if (link.source_type === 'pdf') {
      const cap = (link.captured_text || '').trim()
      setSourceState({
        type: 'pdf',
        path: link.source_uri || '',
        url: '',
        page: Number(link.locator?.page || 1),
        jumpQuote: cap.length > 0 ? cap : null,
      })
    } else {
      setSourceState({ type: 'web', path: '', url: link.source_uri || '', page: 1, jumpQuote: null })
    }
    setShowSourcePanel(true)
    await openSourceAtLocation(link)
  }, [paper])

  const handleSourcePanelResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sourcePanelWidth
    const onMove = (ev) => {
      const next = Math.max(280, Math.min(700, startWidth - (ev.clientX - startX)))
      setSourcePanelWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sourcePanelWidth])

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
        onDeleteFolder={handleDeleteFolder}
        onRenameFolder={handleRenameFolder}
        onMoveFolder={handleMoveFolder}
      />

      <div className="main-content">
        {paper ? (
          <>
            <EditorHeader
              title={paper.title} deckName={paper.deck_name} decks={decks}
              viewMode={viewMode} showSourcePanel={showSourcePanel}
              onTitleChange={handleTitleChange}
              onDeckChange={handleDeckChange} onViewChange={setViewMode}
              onToggleSource={() => setShowSourcePanel((v) => !v)}
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
                  papers={papers}
                  onTableEditRequest={(ctx) => openTableDialog('edit', ctx)}
                  onGoToSource={handleGoToSource}
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
      {showSourcePanel && (
        <>
          <div className="source-panel-resizer" onMouseDown={handleSourcePanelResizeStart} />
          <div style={{ width: sourcePanelWidth, minWidth: sourcePanelWidth }}>
            <SourcePanel
              source={sourceState}
              onSourceChange={(next) => setSourceState((prev) => ({ ...prev, ...next }))}
              onExtract={handleExtractFromSource}
              onClose={() => setShowSourcePanel(false)}
            />
          </div>
        </>
      )}
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
