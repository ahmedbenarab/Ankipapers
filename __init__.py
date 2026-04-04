"""
Anki Papers — A Universal Note Editor for Anki

Write notes in a continuous document and create flashcards using special syntax.
Inspired by RemNote's workflow, integrated directly into Anki.

Uses a React-based web UI for rich editing, live preview, and formatting tools.

Author: Dr. Ahmed Benarab
"""

from aqt import mw, gui_hooks
from aqt.qt import QAction, QKeySequence, QTimer


def open_anki_papers(source=None):
    """Open the Anki Papers window."""
    from .gui.webview import AnkiPapersWindow
    window = AnkiPapersWindow.show_window()
    if source and window:
        _jump_when_ready(window, source, attempt=0)


def _jump_when_ready(window, source, attempt):
    """Retry jumpToBlock until the React app has mounted (up to ~3 s)."""
    if attempt > 20:
        return
    js = (
        f"if(typeof window.jumpToBlock === 'function') "
        f"{{ window.jumpToBlock('{source}'); true; }} else {{ false; }}"
    )
    def on_result(ok):
        if not ok:
            QTimer.singleShot(150, lambda: _jump_when_ready(window, source, attempt + 1))
    window.webview.page().runJavaScript(js, on_result)


def setup_menu():
    """Add Anki Papers to the Tools menu."""
    action = QAction("📝 Anki Papers", mw)
    action.setShortcut(QKeySequence("Ctrl+Shift+P"))
    action.triggered.connect(open_anki_papers)
    mw.form.menuTools.addAction(action)


def setup_toolbar():
    """Add Anki Papers icon to the main window toolbar."""
    try:
        toolbar = mw.toolbar
        # Inject a button into Anki's top toolbar via web content
        toolbar.web.eval("""
            (function() {
                if (document.getElementById('ankipapers-btn')) return;
                var toolbar = document.querySelector('tr');
                if (!toolbar) return;
                var td = document.createElement('td');
                td.id = 'ankipapers-btn';
                var link = document.createElement('a');
                link.className = 'hitem';
                link.href = '#';
                link.title = 'Anki Papers (Ctrl+Shift+P)';
                link.innerHTML = '📝 Papers';
                link.onclick = function(e) {
                    e.preventDefault();
                    pycmd('ankipapers_open');
                    return false;
                };
                toolbar.appendChild(td);
                td.appendChild(link);
            })();
        """)
    except Exception:
        pass


def on_pycmd(handled, message, context):
    """Handle pycmd clicks."""
    if message == "ankipapers_open":
        open_anki_papers()
        return True, None
    if message.startswith("ankipapers_jump:"):
        source = message.split(":", 1)[1]
        open_anki_papers(source)
        return True, None
    return handled


# Register hooks
gui_hooks.main_window_did_init.append(setup_menu)
gui_hooks.webview_did_receive_js_message.append(on_pycmd)
gui_hooks.top_toolbar_did_init_links.append(
    lambda links, toolbar: links.append(
        toolbar.create_link(
            "ankipapers",
            "📝 Papers",
            open_anki_papers,
            tip="Open Anki Papers (Ctrl+Shift+P)",
            id="ankipapers",
        )
    )
)
