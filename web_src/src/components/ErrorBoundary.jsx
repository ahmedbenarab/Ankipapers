import React from 'react'

/**
 * Catches a JavaScript error thrown while rendering.
 *
 * Without this, React unmounts the whole root when a render throws, and Anki's
 * webview is left showing an empty white window with no indication of what
 * happened or how to get back. There is nowhere for a stack trace to surface
 * inside Anki, so this puts the error on screen and offers a way out.
 *
 * Two shapes:
 *   - as a wrapper around a panel (pass `onClose`), the panel is dismissed and
 *     the rest of the app keeps working;
 *   - as the outermost wrapper, the whole window is replaced by the report,
 *     with a reload button.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Anki shows webview console output on stderr when it is launched from a
    // terminal, so this is the one place a stack trace can actually be read.
    console.error('[Anki Papers] render error in', this.props.label || 'the app', error, info)
    this.setState({ info })
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    const label = this.props.label || 'Anki Papers'
    const details = [String(error && error.stack ? error.stack : error),
                     info && info.componentStack].filter(Boolean).join('\n')

    // Inline styles on purpose: if the stylesheet is what failed, class names
    // would render this as unreadable white-on-white.
    const wrap = {
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,10,16,0.72)', padding: 24,
    }
    const card = {
      maxWidth: 720, width: '100%', maxHeight: '80vh', overflow: 'auto',
      background: '#15151f', color: '#e8e8f0', border: '1px solid #2a2a3d',
      borderRadius: 10, padding: '20px 22px',
      font: '13px/1.55 Inter, -apple-system, system-ui, sans-serif',
    }
    const button = {
      background: '#19468d', color: '#fff', border: 'none', borderRadius: 6,
      padding: '7px 14px', fontSize: 13, cursor: 'pointer', marginRight: 8,
    }
    const ghost = { ...button, background: 'transparent', border: '1px solid #2a2a3d', color: '#b8b8c8' }

    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            {label} hit an error
          </div>
          <div style={{ color: '#9a9aae', marginBottom: 14 }}>
            {this.props.onClose
              ? 'The rest of Anki Papers is still running. Your document has not been touched.'
              : 'Your work is saved up to the last autosave. Reloading restores the window.'}
          </div>

          <pre style={{
            background: '#0e0e16', border: '1px solid #23233a', borderRadius: 6,
            padding: 12, overflow: 'auto', maxHeight: 260, fontSize: 11.5,
            font: '11.5px/1.5 "JetBrains Mono", ui-monospace, monospace',
            color: '#e17055', whiteSpace: 'pre-wrap', marginBottom: 14,
          }}>{details}</pre>

          <div>
            {this.props.onClose ? (
              <button style={button} onClick={() => { this.reset(); this.props.onClose() }}>
                Close
              </button>
            ) : (
              <button style={button} onClick={() => window.location.reload()}>
                Reload Anki Papers
              </button>
            )}
            <button
              style={ghost}
              onClick={() => { try { navigator.clipboard.writeText(details) } catch { /* ignore */ } }}
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    )
  }
}
