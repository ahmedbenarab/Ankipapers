"""
WebView window for Anki Papers.

Opens an aqt.webview.AnkiWebView that loads the React frontend over Anki's
media server (http://127.0.0.1:<port>/_addons/<pkg>/web/index.html) and
connects it to the Python backend via AnkiWebView's own pycmd() bridge.
"""

import os
from aqt.qt import (
    QMainWindow,
    QSplitter,
    QUrl,
    QWidget,
    QVBoxLayout,
    Qt,
    QTimer,
    QWebEngineSettings,
)
from aqt import mw
from aqt.webview import AnkiWebView

from .bridge import AnkiPapersBridge
from . import web_browser


class AnkiPapersWebView(AnkiWebView):
    """AnkiWebView subclass that does not let Escape close this window.

    AnkiWebView's default onEsc() walks up parents and closes the first
    QDialog/QMainWindow it finds — inside Anki Papers, Escape is used to
    dismiss pop-ups within the editor, so closing the whole window on Escape
    would be a regression.
    """

    def onEsc(self):
        pass


class AnkiPapersWindow(QMainWindow):
    """Main Anki Papers window using an AnkiWebView for the React UI."""

    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def show_window(cls):
        win = cls.instance()
        win.show()
        win.raise_()
        win.activateWindow()
        return win

    def __init__(self):
        super().__init__(mw)
        self.setWindowTitle("Anki Papers")
        self.setMinimumSize(1000, 650)
        self.resize(1200, 750)

        # Create the web view
        self.webview = AnkiPapersWebView(self, title="Anki Papers")

        # The editor and the web browser share the window side by side. The
        # browser pane is built on first use (see set_web_browser_open).
        self.splitter = QSplitter(Qt.Orientation.Horizontal, self)
        self.splitter.setChildrenCollapsible(False)
        self.splitter.setHandleWidth(1)
        self.splitter.addWidget(self.webview)
        self.splitter.splitterMoved.connect(self._on_splitter_moved)
        self.setCentralWidget(self.splitter)
        self.browser_pane = None

        # Setup the bridge
        self.bridge = AnkiPapersBridge(window=self)
        self.webview.set_bridge_command(self.bridge.handle, self)

        # Tell us when the page's render process dies. Without this a crashed
        # renderer just leaves a blank white window with no explanation and no
        # way back — see _on_render_process_gone below.
        try:
            self.webview.page().renderProcessTerminated.connect(
                self._on_render_process_gone
            )
        except Exception:
            # Older Qt bindings may not expose the signal; a missing crash
            # handler must never stop the window from opening.
            pass

        # Configure web settings
        settings = self.webview.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

        # Re-allow external navigation once our own page has finished loading
        # (see the set_open_links_externally(False)/(True) dance in _load_ui).
        self.webview.loadFinished.connect(self._on_page_load_finished)

        # Load the React app
        self._load_ui()

    # ─── Web browser pane ────────────────────────────

    def web_browser_open(self):
        return self.browser_pane is not None and self.browser_pane.isVisible()

    def set_web_browser_open(self, open_, theme=None):
        """Show or hide the docked browser; returns whether it is now open."""
        if open_ and self.browser_pane is None:
            self.browser_pane = web_browser.WebBrowserPane(
                self.splitter, on_close=self._close_web_browser_from_pane
            )
            self.splitter.addWidget(self.browser_pane)
            self.splitter.setStretchFactor(0, 1)
            self.splitter.setStretchFactor(1, 0)
            self.browser_pane.hide()
        if self.browser_pane is None:
            return False
        if theme:
            self.browser_pane.apply_theme(theme)
            border = theme.get("border") or "#1c335c"
            self.splitter.setStyleSheet(f"QSplitter::handle {{ background: {border}; }}")
        if open_ and not self.browser_pane.isVisible():
            self.browser_pane.show()
            self._size_web_browser()
            self.browser_pane.ensure_loaded()
        elif not open_ and self.browser_pane.isVisible():
            self._remember_web_browser_width()
            self.browser_pane.hide()
        return self.browser_pane.isVisible()

    def _size_web_browser(self):
        total = sum(self.splitter.sizes()) or self.width()
        width = web_browser.load_state().get("width")
        if not isinstance(width, int):
            width = web_browser.DEFAULT_WIDTH
        # Leave the editor at least half the window whatever was saved.
        width = max(web_browser.MIN_WIDTH, min(width, total // 2))
        self.splitter.setSizes([max(total - width, 1), width])

    def _remember_web_browser_width(self):
        if self.web_browser_open():
            web_browser.save_state(width=self.splitter.sizes()[1])

    def _on_splitter_moved(self, _pos, _index):
        self._remember_web_browser_width()

    def _close_web_browser_from_pane(self):
        """The pane's own close button: hide it and tell the toolbar."""
        self.set_web_browser_open(False)
        try:
            self.webview.eval(
                "window.ankiPapersSetWebBrowserOpen && window.ankiPapersSetWebBrowserOpen(false)"
            )
        except Exception:
            pass

    def _on_page_load_finished(self, ok):
        self.webview.set_open_links_externally(True)
        self._allow_drops()

    def _allow_drops(self):
        # AnkiWebView ignores every drop unless allow_drops is set, and
        # load_url() resets it to False -- which silently broke dragging
        # papers and folders in the sidebar (the drag starts, the drop never
        # reaches the page). The page itself stops dropped files from
        # navigating the window (see main.jsx).
        try:
            self.webview.allow_drops = True
        except Exception:
            pass

    def _load_ui(self):
        """Load the React frontend, served by Anki's media server from web/."""
        addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        web_dir = os.path.join(addon_dir, "web")
        index_path = os.path.join(web_dir, "index.html")

        if os.path.exists(index_path):
            package = mw.addonManager.addonFromModule(__name__)
            url = QUrl(f"{mw.serverURL()}_addons/{package}/web/index.html")
            # Without this, AnkiWebPage.acceptNavigationRequest pushes this
            # very load_url() out to the system browser instead of navigating
            # the webview (see fact 4 in the migration brief).
            self.webview.set_open_links_externally(False)
            self.webview.load_url(url)
            self._allow_drops()
        else:
            # Fallback: show error message. AnkiWebView.setHtml() takes no
            # base URL (unlike QWebEngineView.setHtml()).
            self.webview.setHtml(
                f"""
                <html>
                <body style="background:#0b0b14;color:#e8e8f0;font-family:Inter,sans-serif;
                             display:flex;align-items:center;justify-content:center;height:100vh;
                             flex-direction:column;gap:16px">
                    <div style="font-size:48px">📝</div>
                    <h1 style="color:#6c5ce7">Anki Papers</h1>
                    <p style="color:#636380">
                        Web UI not found. Please build the React app first.
                    </p>
                    <p style="color:#636380;font-size:12px">
                        Expected: {index_path}
                    </p>
                    <code style="color:#e17055;background:#1a1a2e;padding:8px 16px;border-radius:6px">
                        cd web_src && npm run build
                    </code>
                </body>
                </html>
                """
            )

    # ─── Render process crashes ──────────────────────
    # The React UI runs in a separate Chromium process. If that process dies,
    # QWebEngineView does not tell the user anything — it just shows an empty
    # white window, forever, and Anki carries on as though nothing happened.
    # This turns that silent failure into something readable and recoverable.

    _RENDER_EXIT_REASONS = {
        0: "the page shut down normally",
        1: "the page exited unexpectedly",
        2: "the page crashed",
        3: "the page was killed, usually because the system ran short of memory",
    }

    _reload_attempts = 0

    def _on_render_process_gone(self, status, exit_code):
        # Closing the window navigates to about:blank on purpose, which ends
        # the render process normally. That is not a crash.
        if self._shutting_down:
            return
        try:
            status_value = int(status)
        except (TypeError, ValueError):
            status_value = -1
        if status_value == 0:
            return

        reason = self._RENDER_EXIT_REASONS.get(status_value, "the page stopped unexpectedly")
        print(f"[Anki Papers] render process gone: {reason} (exit code {exit_code})")

        from aqt.qt import QMessageBox

        self._reload_attempts += 1
        if self._reload_attempts > 3:
            QMessageBox.critical(
                self,
                "Anki Papers",
                f"The Anki Papers window keeps failing — {reason}.\n\n"
                "Close this window and reopen it from the Tools menu. If it "
                "happens again, restarting Anki will clear it.",
            )
            return

        # Anki 2.1.50+ ships PyQt6 (scoped enums); older builds use PyQt5.
        try:
            reload_button = QMessageBox.StandardButton.Reload
            close_button = QMessageBox.StandardButton.Close
        except AttributeError:
            reload_button = QMessageBox.Reload
            close_button = QMessageBox.Close

        answer = QMessageBox.warning(
            self,
            "Anki Papers",
            f"The Anki Papers window stopped because {reason}.\n\n"
            "Your papers are safe on disk up to the last save. Anything typed "
            "since then could not be recovered.\n\nReload the window?",
            reload_button | close_button,
            reload_button,
        )
        if answer == reload_button:
            # Rebuild the page from scratch. reload() on a dead render process
            # is unreliable, so load the file again instead.
            QTimer.singleShot(0, self._load_ui)
        else:
            self.close()

    # ─── Shutdown ────────────────────────────────────
    # Closing the window used to only clear the singleton. The QWebEngineView
    # was never torn down and the window stayed alive as a child of `mw`, so
    # the React app kept running after the window disappeared — including its
    # autosave timer, which held the document as it looked at close time and
    # kept writing that stale snapshot back to storage. Every open/close cycle
    # left another one of these behind, so a hidden, forgotten window could
    # silently overwrite work done in the current one.
    #
    # Now closing does two things, in order:
    #   1. waits for the page to finish writing (nothing recent is lost), then
    #   2. navigates the page to about:blank and deletes it, so no JavaScript
    #      — and no autosave timer — can outlive the window.
    #
    # Step 1 used to call window.ankiPapersFlush() and treat the callback as
    # "the save is done". It never was. runJavaScript() converts the script's
    # return value to a plain value, and the flush was an async function, so
    # what came back was a Promise — which converts to "finished, no result"
    # immediately. The callback therefore fired while the save had barely
    # started, the window closed, _teardown_webview() cut the bridge, and the
    # in-flight write was dropped. Save-then-Generate-then-close lost work for
    # exactly this reason: nothing ever waited for either operation.
    #
    # A Promise cannot be awaited from here, so the window asks instead of
    # waiting. It polls window.ankiPapersCloseState(), which returns a plain
    # string every time it is called ('saving', 'generating' or 'done'), and
    # closes only on 'done'. If the page is still busy after a few seconds it
    # says so and lets the user decide, rather than closing behind their back.

    _shutting_down = False

    # How the close sequence is paced.
    _CLOSE_POLL_MS = 120      # how often to ask the page where it is up to
    _CLOSE_PROMPT_MS = 5000   # how long to wait quietly before asking the user
    _LEGACY_GRACE_MS = 1500   # allowance for a web/ build with no status to give

    _close_timer = None
    _close_prompt_timer = None
    _close_box = None
    _closing_done = False
    _close_state = "saving"

    def closeEvent(self, event):
        # Second pass (once the page reports 'done'): tear everything down.
        if self._shutting_down:
            self._stop_close_timers()
            self._teardown_webview()
            AnkiPapersWindow._instance = None
            super().closeEvent(event)
            return

        # First pass: hold the window open until the page has finished writing.
        self._shutting_down = True
        self._closing_done = False
        self._close_state = "saving"
        event.ignore()
        self._begin_close()

    # The script is deliberately synchronous end to end: it must hand back a
    # string on this call, not a promise of one later.
    _CLOSE_STATE_JS = (
        "(function(){ try {"
        "  if (typeof window.ankiPapersCloseState === 'function') {"
        "    var s = window.ankiPapersCloseState();"
        "    return (typeof s === 'string') ? s : 'done';"
        "  }"
        "  if (typeof window.ankiPapersFlush === 'function') {"
        "    window.ankiPapersFlush();"
        "    return 'legacy';"
        "  }"
        "  return 'done';"
        "} catch (e) { return 'done'; } })()"
    )

    def _begin_close(self):
        """Wait for any save or card generation to finish, then close."""
        self._close_timer = QTimer(self)
        self._close_timer.setInterval(self._CLOSE_POLL_MS)
        self._close_timer.timeout.connect(self._ask_page_for_state)
        self._close_timer.start()

        # On its own timer on purpose. If the page has stopped answering
        # altogether — a wedged script, a dead render process — no reply ever
        # arrives, and this is what stops the window hanging there forever.
        self._close_prompt_timer = QTimer(self)
        self._close_prompt_timer.setSingleShot(True)
        self._close_prompt_timer.timeout.connect(self._prompt_still_busy)
        self._close_prompt_timer.start(self._CLOSE_PROMPT_MS)

        self._ask_page_for_state()

    def _ask_page_for_state(self):
        if self._closing_done:
            return
        try:
            self.webview.page().runJavaScript(
                self._CLOSE_STATE_JS, self._on_close_state
            )
        except Exception:
            # No page left to ask; there is nothing in flight to protect.
            self._finish_close()

    def _on_close_state(self, state):
        if self._closing_done:
            return
        if not isinstance(state, str):
            state = "done"

        if state == "done":
            self._finish_close()
            return

        if state == "legacy":
            # An older web/ build: it has no status to report, but its flush
            # has now been started. Give that a fixed moment instead of
            # closing instantly, which is what used to lose the work.
            self._close_state = "saving"
            if self._close_timer is not None:
                self._close_timer.stop()
            QTimer.singleShot(self._LEGACY_GRACE_MS, self._finish_close)
            return

        # Still working. Remember what for, so the dialog can say so.
        self._close_state = state

    def _prompt_still_busy(self):
        """Several seconds in and still not finished — hand the choice over."""
        if self._closing_done:
            return

        from aqt.qt import QMessageBox

        what = (
            "writing cards to Anki"
            if self._close_state == "generating"
            else "saving your document"
        )
        try:
            accept_role = QMessageBox.ButtonRole.AcceptRole
            destructive_role = QMessageBox.ButtonRole.DestructiveRole
            warning_icon = QMessageBox.Icon.Warning
        except AttributeError:
            accept_role = QMessageBox.AcceptRole
            destructive_role = QMessageBox.DestructiveRole
            warning_icon = QMessageBox.Warning

        box = QMessageBox(self)
        box.setWindowTitle("Anki Papers")
        box.setIcon(warning_icon)
        box.setText(f"Anki Papers is still {what}.")
        box.setInformativeText(
            "This normally finishes in well under a second, so something is "
            "holding it up.\n\nClosing now would lose the most recent changes."
        )
        keep_waiting = box.addButton("Keep waiting", accept_role)
        close_anyway = box.addButton("Close anyway", destructive_role)
        box.setDefaultButton(keep_waiting)

        # Held on the window so that if the page finishes while this dialog is
        # open, _finish_close() can dismiss it rather than deadlock behind it.
        self._close_box = box
        try:
            box.exec()
        except AttributeError:
            box.exec_()
        self._close_box = None

        if self._closing_done:
            return  # it finished while the dialog was up; the close is handled
        if box.clickedButton() is close_anyway:
            self._finish_close()
            return
        # Keep waiting, and ask again if it is still going in a few seconds.
        if self._close_prompt_timer is not None:
            self._close_prompt_timer.start(self._CLOSE_PROMPT_MS)

    def _finish_close(self):
        """Everything the page had to write is written; close for real."""
        if self._closing_done:
            return
        self._closing_done = True
        self._stop_close_timers()

        if self._close_box is not None:
            # A "still busy" dialog is open and running a nested event loop.
            # Dismiss it and let that unwind before the window goes away.
            box, self._close_box = self._close_box, None
            try:
                box.reject()
            except Exception:
                pass
            QTimer.singleShot(0, self.close)
            return

        self.close()  # re-enters closeEvent with _shutting_down = True

    def _stop_close_timers(self):
        for attr in ("_close_timer", "_close_prompt_timer"):
            timer = getattr(self, attr, None)
            if timer is not None:
                try:
                    timer.stop()
                except Exception:
                    pass
            setattr(self, attr, None)

    def _teardown_webview(self):
        """Stop the page for good so nothing keeps running in the background."""
        try:
            # Navigating away destroys the React app and every timer it owns,
            # before AnkiWebView.cleanup() tears down the page itself.
            #
            # External-link handling was switched back on after our page
            # loaded (see _on_page_load_finished). With it on, AnkiWebPage
            # treats this about:blank navigation as an outside link and, since
            # "about" is not an allowed URL scheme, pops Anki's "open this
            # scheme?" warning on every close. Switch it off first so the
            # navigation stays inside the webview.
            self.webview.set_open_links_externally(False)
            self.webview.setUrl(QUrl("about:blank"))
        except Exception:
            pass
        try:
            self.webview.cleanup()
        except Exception:
            pass
        try:
            self.webview.deleteLater()
        except Exception:
            pass
        self.deleteLater()
