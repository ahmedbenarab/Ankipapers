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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
