"""
Anki Papers — A Universal Note Editor for Anki

Write notes in a continuous document and create flashcards using special syntax.
Inspired by RemNote's workflow, integrated directly into Anki.

Uses a React-based web UI for rich editing, live preview, and formatting tools.

Author: Dr. Ahmed Benarab
"""

import os
import urllib.parse

from aqt import mw, gui_hooks
from aqt.qt import QAction, QIcon, QKeySequence, QTimer

# Serve everything under web/ at {mw.serverURL()}_addons/<package>/web/<path>
# (gui/webview.py loads web/index.html from there; see the migration brief's
# D1 for why file:// loading was replaced with Anki's media server).
mw.addonManager.setWebExports(__name__, r"web/.*")


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
    """Add Anki Papers to the Tools menu, with the add-on's logo as its icon."""
    action = QAction("Anki Papers", mw)
    logo = os.path.join(os.path.dirname(__file__), "AnkiPapers logo.png")
    if os.path.exists(logo):
        action.setIcon(QIcon(logo))
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


def _current_source(source, context):
    """The jump target with the card's line as it is in the paper now.

    The note's Source field holds the line number from the last Generate, and
    lines move whenever something above them changes. The card being shown
    knows its note, and the note's anchor in the paper knows its line.
    Anything that can't be worked out keeps the stored line.
    """
    try:
        paper_id, _ = source.split(":", 1)
        card = getattr(context, "card", None)
        if callable(card):   # the Previewer has card(), the Reviewer .card
            card = card()
        note_id = getattr(card, "nid", None)
        if not paper_id or not note_id:
            return source
        from .core.card_manager import current_line_for_note
        from .core.storage import load_paper
        line = current_line_for_note(load_paper(paper_id), note_id)
        return source if line is None else f"{paper_id}:{line}"
    except Exception:
        return source


def on_pycmd(handled, message, context):
    """Handle pycmd clicks."""
    if message == "ankipapers_open":
        open_anki_papers()
        return True, None
    if message.startswith("ankipapers_jump:"):
        source = _current_source(message.split(":", 1)[1], context)
        open_anki_papers(source)
        return True, None
    return handled


# The top bar's "Papers" link: a page with lines of notes beside the word.
# Anki writes a link's label into the page twice, once as its text and once
# inside aria-label="…", so the label has to stay plain text: an icon written
# into it broke out of that attribute and showed its markup on the toolbar.
# The icon is drawn by CSS on the toolbar page instead, as a mask filled with
# the text color, so it follows Anki's light and dark themes like the text.
_PAPERS_ICON_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' "
    "stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>"
    "<path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z'/>"
    "<path d='M15 2v5h5'/><path d='M8 12h8M8 16h8M8 8h3'/></svg>"
)
_PAPERS_ICON_URL = "data:image/svg+xml," + urllib.parse.quote(_PAPERS_ICON_SVG)
PAPERS_TOOLBAR_CSS = f"""
<style>
#ankipapers::before {{
  content: ""; display: inline-block; width: 1.05em; height: 1.05em;
  margin-right: 0.35em; vertical-align: -0.17em; background-color: currentColor;
  -webkit-mask: url("{_PAPERS_ICON_URL}") center / contain no-repeat;
  mask: url("{_PAPERS_ICON_URL}") center / contain no-repeat;
}}
</style>
"""


def add_papers_toolbar_icon(web_content, context):
    """webview_will_set_content: give the top bar's Papers link its icon."""
    try:
        from aqt.toolbar import Toolbar
        if isinstance(context, Toolbar):
            web_content.head += PAPERS_TOOLBAR_CSS
    except Exception:
        pass


# Register hooks
gui_hooks.main_window_did_init.append(setup_menu)
gui_hooks.webview_did_receive_js_message.append(on_pycmd)
gui_hooks.webview_will_set_content.append(add_papers_toolbar_icon)
gui_hooks.top_toolbar_did_init_links.append(
    lambda links, toolbar: links.append(
        toolbar.create_link(
            "ankipapers",
            "Papers",
            open_anki_papers,
            tip="Open Anki Papers (Ctrl+Shift+P)",
            id="ankipapers",
        )
    )
)

# Keep Tools → Check Media from listing (and Delete Unused from trashing) the
# pictures papers show but no card uses. See gui/media_protect.py.
from .gui.media_protect import protect_paper_media  # noqa: E402

gui_hooks.media_check_did_finish.append(protect_paper_media)

# Recount the image occlusion badges on pictures whenever notes are added,
# edited or deleted anywhere in Anki. See gui/occlusion.py.
from .gui.occlusion import notify_occlusions_changed  # noqa: E402

gui_hooks.operation_did_execute.append(notify_occlusions_changed)
