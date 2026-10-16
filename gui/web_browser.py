"""
A small web browser that docks to the right of the Anki Papers editor.

It is a native QWebEngineView, not an iframe inside the React page: most of
the sites worth reading beside a paper (Google, PubMed, UpToDate, GitHub)
send X-Frame-Options / frame-ancestors headers that leave an iframe blank.
A real view also keeps its own cookies and logins between sessions.

The React toolbar's globe button shows and hides it through the
"set_web_browser" bridge command; the pane's own close button tells the page
back through window.ankiPapersSetWebBrowserOpen so the button stays in step.
"""

import json
import os
import re
import shutil
from urllib.parse import quote_plus

from aqt import mw
from aqt.qt import (
    QHBoxLayout,
    QMessageBox,
    QKeySequence,
    QLineEdit,
    QShortcut,
    Qt,
    QToolButton,
    QUrl,
    QVBoxLayout,
    QWidget,
    QWebEnginePage,
    QWebEngineProfile,
    QWebEngineView,
)

HOME_URL = "https://www.google.com/"
SEARCH_URL = "https://www.google.com/search?q="
DEFAULT_WIDTH = 480
MIN_WIDTH = 300

_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
_HOST_RE = re.compile(r"^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$")

PROFILE_BASE_NAME = "AnkiPapersBrowser"

_profile = None


def _make_profile(name):
    # Parented to mw rather than the window: a profile deleted before its
    # pages makes Qt warn, and the pane is rebuilt every time the window is
    # reopened. So a profile lives until Anki quits.
    profile = QWebEngineProfile(name, mw)
    # Some sites (Google among them) serve a stripped-down page to a user
    # agent that names QtWebEngine. Without that token it reads as Chrome.
    ua = re.sub(r"\s*QtWebEngine/\S+", "", profile.httpUserAgent())
    profile.setHttpUserAgent(ua)
    return profile


def _browser_profile():
    """The current persistent profile (cookies, logins and history on disk).

    Its storage lives in ~/Library/Application Support/Anki/QtWebEngine/<name>.
    Clearing browsing data moves to a fresh profile name and leaves the old
    folder on the purge list; it is deleted here, the next time Anki starts,
    before anything can have it open.
    """
    global _profile
    if _profile is None:
        state = load_state()
        _profile = _make_profile(state.get("profile") or PROFILE_BASE_NAME)
        _purge_old_profiles(_profile, state.get("purge") or [])
    return _profile


def _purge_old_profiles(current, names):
    base = os.path.dirname(current.persistentStoragePath())
    left = []
    for name in names:
        if not isinstance(name, str) or not name.startswith(PROFILE_BASE_NAME):
            continue
        if name == current.storageName():
            continue
        path = os.path.join(base, name)
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
        except Exception:
            left.append(name)
    save_state(purge=left)


def clear_browsing_data():
    """Sign out of everything and forget everything the pane has stored.

    Cookies and cache go at once. Qt has no call that empties a profile's
    site storage (localStorage, IndexedDB) or history files while it is
    open, so the pane moves to a brand-new, empty profile straight away and
    the old one's folder is deleted at the next start. Returns the new profile.
    """
    global _profile
    old = _browser_profile()
    try:
        old.cookieStore().deleteAllCookies()
        old.clearHttpCache()
        old.clearAllVisitedLinks()
    except Exception:
        pass

    state = load_state()
    generation = int(state.get("generation") or 0) + 1
    purge = list(state.get("purge") or [])
    if old.storageName() not in purge:
        purge.append(old.storageName())
    new_name = f"{PROFILE_BASE_NAME}-{generation}"
    save_state(profile=new_name, generation=generation, purge=purge, last_url=None)

    _profile = _make_profile(new_name)
    return _profile


def _state_path():
    addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(addon_dir, "user_files", "web_browser.json")


def load_state():
    try:
        with open(_state_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_state(**changes):
    data = load_state()
    data.update(changes)
    try:
        os.makedirs(os.path.dirname(_state_path()), exist_ok=True)
        with open(_state_path(), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def url_from_input(text):
    """Turn what was typed in the address bar into a URL.

    A full http(s) URL is used as is; something shaped like a host
    ("pubmed.gov", "localhost:3000/x") gets https:// in front; anything else
    is searched for.
    """
    text = (text or "").strip()
    if not text:
        return None
    if _SCHEME_RE.match(text) and not _HOST_RE.match(text):
        if text.lower().startswith(("http://", "https://")):
            return QUrl(text)
        return QUrl(SEARCH_URL + quote_plus(text))
    if " " not in text and _HOST_RE.match(text):
        return QUrl("https://" + text)
    return QUrl(SEARCH_URL + quote_plus(text))


class _BrowserPage(QWebEnginePage):
    """Keeps every link in this one view.

    target=_blank links and window.open() would otherwise ask for a new
    window, which a page without createWindow() silently drops.
    """

    def createWindow(self, _type):
        return self


class WebBrowserPane(QWidget):
    """Toolbar (back, forward, reload, address, open outside, close) over a view."""

    def __init__(self, parent=None, on_close=None):
        super().__init__(parent)
        self.setObjectName("apBrowserPane")
        self.setMinimumWidth(MIN_WIDTH)
        self._on_close = on_close
        self._loaded_once = False
        self._loading = False

        self.view = QWebEngineView(self)
        self.view.setPage(_BrowserPage(_browser_profile(), self.view))

        self.back_btn = self._button("←", "Back", self.view.back)
        self.forward_btn = self._button("→", "Forward", self.view.forward)
        self.reload_btn = self._button("↻", "Reload", self._reload_or_stop)

        self.address = QLineEdit(self)
        self.address.setObjectName("apBrowserAddress")
        self.address.setPlaceholderText("Search or enter a web address")
        self.address.setClearButtonEnabled(True)
        self.address.returnPressed.connect(self._go_to_typed)

        self.clear_btn = self._button("🗑", "Clear browsing data", self._clear_data)
        self.external_btn = self._button("↗", "Open this page in your browser", self._open_external)
        self.close_btn = self._button("✕", "Close the web browser", self._close)

        bar = QWidget(self)
        bar.setObjectName("apBrowserBar")
        row = QHBoxLayout(bar)
        row.setContentsMargins(8, 6, 8, 6)
        row.setSpacing(4)
        for w in (self.back_btn, self.forward_btn, self.reload_btn):
            row.addWidget(w)
        row.addWidget(self.address, 1)
        row.addWidget(self.clear_btn)
        row.addWidget(self.external_btn)
        row.addWidget(self.close_btn)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(bar)
        layout.addWidget(self.view, 1)

        self.view.urlChanged.connect(self._on_url_changed)
        self.view.loadStarted.connect(self._on_load_started)
        self.view.loadFinished.connect(self._on_load_finished)

        # Cmd+L (Ctrl+L elsewhere) jumps to the address bar, as in a browser.
        # Scoped to the pane so it never steals the shortcut from the editor.
        focus_address = QShortcut(QKeySequence("Ctrl+L"), self)
        focus_address.setContext(Qt.ShortcutContext.WidgetWithChildrenShortcut)
        focus_address.activated.connect(self._focus_address)

        self._update_nav_buttons()
        self.apply_theme({})

    def _button(self, text, tip, slot):
        b = QToolButton(self)
        b.setText(text)
        b.setToolTip(tip)
        b.setAutoRaise(True)
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        b.clicked.connect(slot)
        return b

    # ─── Loading ─────────────────────────────────────

    def ensure_loaded(self):
        """Open the last page visited (or the home page) the first time shown."""
        if self._loaded_once:
            return
        self._loaded_once = True
        last = load_state().get("last_url")
        url = QUrl(last) if isinstance(last, str) and last.startswith(("http://", "https://")) else QUrl(HOME_URL)
        self.view.setUrl(url)

    def _go_to_typed(self):
        url = url_from_input(self.address.text())
        if url is None:
            return
        self._loaded_once = True
        self.view.setUrl(url)
        self.view.setFocus()

    def _reload_or_stop(self):
        if self._loading:
            self.view.stop()
        else:
            self.view.reload()

    def _open_external(self):
        url = self.view.url()
        if url.isValid() and url.scheme() in ("http", "https"):
            from aqt.utils import openLink
            openLink(url.toString())

    def _clear_data(self):
        answer = QMessageBox.question(
            self,
            "Clear browsing data",
            "Sign out of every site in this browser and delete its cookies, "
            "history, cache and saved site data?\n\n"
            "This only affects the browser inside Anki Papers.",
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        old_page = self.view.page()
        self.view.setPage(_BrowserPage(clear_browsing_data(), self.view))
        old_page.deleteLater()
        self.address.clear()
        self._loaded_once = True
        self.view.setUrl(QUrl(HOME_URL))
        self._update_nav_buttons()

    def _close(self):
        if self._on_close:
            self._on_close()

    def _focus_address(self):
        self.address.setFocus()
        self.address.selectAll()

    def _on_url_changed(self, url):
        if not self.address.hasFocus():
            self.address.setText(url.toString())
            self.address.setCursorPosition(0)
        if url.scheme() in ("http", "https"):
            save_state(last_url=url.toString())
        self._update_nav_buttons()

    def _on_load_started(self):
        self._loading = True
        self.reload_btn.setText("✕")
        self.reload_btn.setToolTip("Stop loading")

    def _on_load_finished(self, _ok):
        self._loading = False
        self.reload_btn.setText("↻")
        self.reload_btn.setToolTip("Reload")
        self._update_nav_buttons()

    def _update_nav_buttons(self):
        history = self.view.history()
        self.back_btn.setEnabled(history.canGoBack())
        self.forward_btn.setEnabled(history.canGoForward())

    # ─── Theme ───────────────────────────────────────

    def apply_theme(self, theme):
        """Color the toolbar from the editor's CSS variables (sent by React)."""
        t = theme if isinstance(theme, dict) else {}
        bg = t.get("bg") or "#0b1730"
        field = t.get("field") or "#0f1e3d"
        fg = t.get("fg") or "#e9f1fb"
        muted = t.get("muted") or "#6f86ab"
        border = t.get("border") or "#1c335c"
        hover = t.get("hover") or "rgba(75, 156, 211, 0.12)"
        accent = t.get("accent") or "#4b9cd3"
        self.setStyleSheet(f"""
            #apBrowserBar {{ background: {bg}; border-bottom: 1px solid {border}; }}
            #apBrowserPane QToolButton {{
                color: {fg}; background: transparent; border: none;
                border-radius: 6px; padding: 3px 7px; font-size: 14px;
            }}
            #apBrowserPane QToolButton:hover {{ background: {hover}; }}
            #apBrowserPane QToolButton:disabled {{ color: {muted}; }}
            #apBrowserAddress {{
                color: {fg}; background: {field}; border: 1px solid {border};
                border-radius: 6px; padding: 4px 8px; font-size: 12px;
                selection-background-color: {accent};
            }}
            #apBrowserAddress:focus {{ border-color: {accent}; }}
        """)
