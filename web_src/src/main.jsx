import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/global.css'
import './styles/ai.css'

// Files dragged in from Finder would otherwise make the webview navigate to
// them, replacing the app. Nothing in the page takes dropped files, so refuse
// them everywhere; drags inside the page (sidebar, blocks) are unaffected.
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none' } })
window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault() })

// Dev server only: ?demo=<name> loads a demo library from
// web_src/.devtest/<name>-demo/demo.js (untracked) into the mock bridge, for
// screenshots. A production build drops this along with the mock.
async function loadDemo() {
  if (!import.meta.env.DEV) return
  const name = new URLSearchParams(window.location.search).get('demo')
  if (!name || !/^[a-z0-9-]+$/i.test(name)) return
  try {
    const mod = await import(/* @vite-ignore */ `/.devtest/${name}-demo/demo.js`)
    window.__apDemo = mod.default()
  } catch (e) {
    console.warn(`[AnkiPapers] demo "${name}" not found under web_src/.devtest/`, e)
  }
}

loadDemo().then(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
))
