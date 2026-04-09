/**
 * Bridge module — QWebChannel communication with Python backend.
 */

import { searchPapersAdvanced } from './searchQuery.js';

let _bridge = null;
let _ready = false;
const _readyCallbacks = [];

export function initBridge() {
  return new Promise((resolve) => {
    if (typeof qt !== 'undefined' && qt.webChannelTransport) {
      new QWebChannel(qt.webChannelTransport, (channel) => {
        _bridge = channel.objects.bridge;
        _ready = true;
        _readyCallbacks.forEach(cb => cb());
        resolve(_bridge);
      });
    } else {
      console.warn('[AnkiPapers] No QWebChannel, using mock bridge');
      _bridge = createMockBridge();
      _ready = true;
      _readyCallbacks.forEach(cb => cb());
      resolve(_bridge);
    }
  });
}

export function getBridge() {
  if (_ready) return Promise.resolve(_bridge);
  return new Promise((resolve) => { _readyCallbacks.push(() => resolve(_bridge)); });
}

// Paper API
export async function listPapers() {
  const b = await getBridge();
  return new Promise(r => b.list_papers(v => r(JSON.parse(v))));
}
export async function loadPaper(id) {
  const b = await getBridge();
  return new Promise(r => b.load_paper(id, v => { const d = JSON.parse(v); r(d.error ? null : d); }));
}
export async function savePaper(data) {
  const b = await getBridge();
  return new Promise(r => b.save_paper(JSON.stringify(data), v => r(JSON.parse(v))));
}
export async function createPaper(title, folderPath = '') {
  const b = await getBridge();
  return new Promise(r => b.create_paper(title, folderPath, v => r(JSON.parse(v))));
}
export async function deletePaper(id) {
  const b = await getBridge();
  return new Promise(r => b.delete_paper(id, v => r(JSON.parse(v))));
}
export async function movePaperToFolder(id, folder) {
  const b = await getBridge();
  return new Promise(r => b.move_paper_to_folder(id, folder, v => r(JSON.parse(v))));
}
/** @param {string} ankiEditConflict preserve | overwrite | abort */
export async function generateCards(id, ankiEditConflict = 'preserve') {
  const b = await getBridge();
  const policy = ankiEditConflict || 'preserve';
  return new Promise(r => b.generate_cards(id, policy, v => r(JSON.parse(v))));
}

export async function checkAnkiEditConflicts(paperId) {
  const b = await getBridge();
  if (!b.check_anki_edit_conflicts) {
    return { conflicts: [], error: 'check_anki_edit_conflicts not available' };
  }
  return new Promise((resolve) => {
    b.check_anki_edit_conflicts(paperId, (v) => {
      try {
        resolve(JSON.parse(v));
      } catch {
        resolve({ error: 'invalid_json', raw: v });
      }
    });
  });
}

// Decks & Folders
export async function getDecks() {
  const b = await getBridge();
  return new Promise(r => b.get_decks(v => r(JSON.parse(v))));
}
export async function getFolders() {
  const b = await getBridge();
  return new Promise(r => b.get_folders(v => r(JSON.parse(v))));
}
export async function createFolder(name, parentPath = '') {
  const b = await getBridge();
  return new Promise(r => b.create_folder(name, parentPath, v => r(JSON.parse(v))));
}
export async function deleteFolder(folderPath) {
  const b = await getBridge();
  if (!b.delete_folder) return { error: 'delete_folder not available' };
  return new Promise(r => b.delete_folder(folderPath || '', v => r(JSON.parse(v))));
}
export async function renameFolder(oldPath, newName) {
  const b = await getBridge();
  if (!b.rename_folder) return { error: 'rename_folder not available' };
  return new Promise(r => b.rename_folder(oldPath || '', (newName || '').trim(), v => r(JSON.parse(v))));
}
export async function moveFolder(folderPath, newParentPath) {
  const b = await getBridge();
  if (!b.move_folder) return { error: 'move_folder not available' };
  return new Promise(r => b.move_folder(folderPath || '', newParentPath || '', v => r(JSON.parse(v))));
}

// Images
export async function getMediaDir() {
  const b = await getBridge();
  return new Promise(r => b.get_media_dir(v => r(JSON.parse(v))));
}
export async function pickImage() {
  const b = await getBridge();
  return new Promise(r => b.pick_image(v => r(JSON.parse(v))));
}
export async function pasteImage() {
  const b = await getBridge();
  return new Promise(r => b.paste_image(v => r(JSON.parse(v))));
}

// Browser linking — Python runs Browser.search_for("nid:" + id), same as manual Anki search
export async function openInBrowser(noteId) {
  const n = Number(noteId);
  if (noteId == null || noteId === '' || !Number.isFinite(n) || n <= 0) {
    console.warn('[AnkiPapers] openInBrowser: invalid note id', noteId);
    return;
  }
  const b = await getBridge();
  b.open_in_browser(String(Math.trunc(n)));
}

/** Parsed object: verify nid: search and Browser APIs (Settings debug). */
export async function diagnoseCrosslink(noteId) {
  const b = await getBridge();
  if (!b.diagnose_crosslink) return { error: 'diagnose_crosslink not available' };
  return new Promise((resolve) => {
    b.diagnose_crosslink(String(noteId).trim(), (v) => {
      try {
        resolve(JSON.parse(v));
      } catch {
        resolve({ error: 'invalid_json', raw: v });
      }
    });
  });
}

export async function moveCardsToDeck(paperId, deckName) {
  const b = await getBridge();
  return new Promise(r => b.move_cards_to_deck(paperId, deckName, v => r(JSON.parse(v))));
}

// Search
export async function searchPapers(query) {
  const b = await getBridge();
  if (!b.search_papers) return [];
  return new Promise(r => b.search_papers(query, v => r(JSON.parse(v))));
}

// Markdown Import/Export
export async function importMarkdown() {
  const b = await getBridge();
  if (!b.import_markdown) return { error: 'not available' };
  return new Promise(r => b.import_markdown(v => r(JSON.parse(v))));
}
export async function exportMarkdown(id) {
  const b = await getBridge();
  if (!b.export_markdown) return { error: 'not available' };
  return new Promise(r => b.export_markdown(id, v => r(JSON.parse(v))));
}

// PDF Export
export async function exportPdf(id) {
  const b = await getBridge();
  return new Promise(r => b.export_pdf(id, v => r(JSON.parse(v))));
}

// Settings
export async function getSettings() {
  const b = await getBridge();
  return new Promise(r => b.get_settings(v => r(JSON.parse(v))));
}
export async function saveSettings(settings) {
  const b = await getBridge();
  return new Promise(r => b.save_settings(JSON.stringify(settings), v => r(JSON.parse(v))));
}

export async function openUrl(url) {
  const b = await getBridge();
  b.open_url(url);
}

// Source panel
export async function pickPdfFile() {
  const b = await getBridge();
  if (!b.pick_pdf_file) return { error: 'not available' };
  return new Promise(r => b.pick_pdf_file(v => r(JSON.parse(v))));
}
export async function extractPdfText(path, page = 1) {
  const b = await getBridge();
  if (!b.extract_pdf_text) return { error: 'not available' };
  return new Promise(r => b.extract_pdf_text(path, Number(page || 1), v => r(JSON.parse(v))));
}
export async function extractWebText(url) {
  const b = await getBridge();
  if (!b.extract_web_text) return { error: 'not available' };
  return new Promise(r => b.extract_web_text(url, v => r(JSON.parse(v))));
}
export async function saveSourceLink(paperId, blockId, linkData) {
  const b = await getBridge();
  if (!b.save_source_link) return { error: 'not available' };
  return new Promise(r => b.save_source_link(paperId, blockId, JSON.stringify(linkData || {}), v => r(JSON.parse(v))));
}
export async function loadSourceLink(paperId, blockId) {
  const b = await getBridge();
  if (!b.load_source_link) return { error: 'not available' };
  return new Promise(r => b.load_source_link(paperId, blockId, v => r(JSON.parse(v))));
}
export async function openSourceAtLocation(linkData) {
  const b = await getBridge();
  if (!b.open_source_at_location) return { error: 'not available' };
  return new Promise(r => b.open_source_at_location(JSON.stringify(linkData || {}), v => r(JSON.parse(v))));
}

// ─── Mock Bridge ────────────────────────────────────
function createMockBridge() {
  const papers = [
    {
      id: 'demo-1', title: 'Cell Biology',
      content: '# Cell Biology\n\n## Organelles\n\nWhat is the powerhouse of the cell? >> Mitochondria\n\nATP <> Adenosine Triphosphate\n\nThe {{mitochondria}} is the powerhouse of the cell.\n\n{{c1::ATP}} is produced through {{c2::oxidative phosphorylation}}.\n\n## Cell Membrane\n\n- **Phospholipid bilayer** forms the basic structure\n\n> The fluid mosaic model describes membrane structure\n\n---\n\nWhat is endocytosis? >> The process by which cells absorb molecules\n',
      deck_name: 'Biology', folder_path: 'Biology', card_refs: [], tags: [],
      created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
    },
  ];
  return {
    list_papers: cb => cb(JSON.stringify(papers)),
    load_paper: (id, cb) => { const p = papers.find(x => x.id === id); cb(JSON.stringify(p || { error: 'not found' })); },
    save_paper: (json, cb) => { const d = JSON.parse(json); const i = papers.findIndex(x => x.id === d.id); if (i >= 0) Object.assign(papers[i], d); cb('{"ok":true}'); },
    create_paper: (title, folder, cb) => { const p = { id: 'p-' + Date.now(), title, content: `# ${title}\n\n`, deck_name: 'Default', folder_path: folder, card_refs: [], tags: [], created_at: Date.now() / 1000, modified_at: Date.now() / 1000 }; papers.push(p); cb(JSON.stringify(p)); },
    delete_paper: (id, cb) => { const i = papers.findIndex(x => x.id === id); if (i >= 0) papers.splice(i, 1); cb('{"ok":true}'); },
    move_paper_to_folder: (id, f, cb) => { const p = papers.find(x => x.id === id); if (p) p.folder_path = f; cb('{"ok":true}'); },
    generate_cards: (id, policy, cb) => cb(JSON.stringify({ created: 3, updated: 0, deleted: 0 })),
    check_anki_edit_conflicts: (id, cb) => cb(JSON.stringify({ conflicts: [] })),
    get_decks: cb => cb('["Default","Biology","Medicine"]'),
    get_folders: cb => cb(JSON.stringify({ name: 'Root', children: [{ type: 'folder', name: 'Biology', path: 'Biology', children: [] }] })),
    create_folder: (n, p, cb) => cb('{"ok":true}'),
    delete_folder: (path, cb) => cb('{"ok":true}'),
    rename_folder: (oldP, newN, cb) => cb('{"ok":true}'),
    move_folder: (fp, np, cb) => cb('{"ok":true}'),
    get_media_dir: cb => cb('{"path":""}'),
    pick_image: cb => cb('{"cancelled":true}'),
    paste_image: cb => cb('{"cancelled":true}'),
    open_in_browser: id => console.log('Mock: Open in browser', id),
    diagnose_crosslink: (id, cb) => cb(JSON.stringify({
      note_id: Number(id) || 0,
      query: `nid:${id}`,
      note_found: true,
      find_cards_count: 1,
      first_cid: 1,
      browser_open: false,
      has_select_single_card: true,
    })),
    move_cards_to_deck: (p, d, cb) => cb('{"ok":true}'),
    search_papers: (q, cb) => { cb(JSON.stringify(searchPapersAdvanced(papers, q))); },
    import_markdown: cb => cb('{"cancelled":true}'),
    export_markdown: (id, cb) => cb('{"cancelled":true}'),
    export_pdf: (id, cb) => cb('{"cancelled":true}'),
    get_settings: cb => cb('{"default_deck":"Default","auto_save_interval_seconds":30,"font_size":14,"font_family":"JetBrains Mono","editor_theme":"dark","show_card_indicators":true,"anki_edit_conflict":"ask"}'),
    save_settings: (j, cb) => cb('{"ok":true}'),
    open_url: url => console.log('Mock: Open URL', url),
    pick_pdf_file: cb => cb(JSON.stringify({ cancelled: true })),
    extract_pdf_text: (path, page, cb) => cb(JSON.stringify({ ok: true, title: 'Demo PDF', text: `Extracted text from page ${page}`, path, page })),
    extract_web_text: (url, cb) => cb(JSON.stringify({ ok: true, title: url, text: 'Extracted web content demo', url })),
    save_source_link: (paperId, blockId, linkJson, cb) => cb(JSON.stringify({ ok: true })),
    load_source_link: (paperId, blockId, cb) => cb(JSON.stringify({ error: 'Source link not found' })),
    open_source_at_location: (meta, cb) => cb(JSON.stringify({ ok: true })),
  };
}
