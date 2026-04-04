"""
WebView window for Anki Papers.

Opens a QWebEngineView that loads the React frontend and connects
it to the Python backend via QWebChannel.
"""

import os
from aqt.qt import (
    QMainWindow,
    QUrl,
    QWidget,
    QVBoxLayout,
    Qt,
)
from aqt import mw

try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWebChannel import QWebChannel
    from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
except ImportError:
    try:
        from PyQt5.QtWebEngineWidgets import QWebEngineView
        from PyQt5.QtWebChannel import QWebChannel
        from PyQt5.QtWebEngineCore import QWebEnginePage
    except ImportError:
        QWebEngineView = None
        QWebChannel = None

from .bridge import AnkiPapersBridge


class AnkiPapersWindow(QMainWindow):
    """Main Anki Papers window using a QWebEngineView for the React UI."""

    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def show_window(cls):
        if QWebEngineView is None:
            from aqt.qt import QMessageBox
            QMessageBox.critical(
                mw,
                "Anki Papers",
                "QWebEngineView is not available.\n"
                "Please update your Anki installation.",
            )
            return None

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
        self.webview = QWebEngineView(self)
        self.setCentralWidget(self.webview)

        # Setup the bridge
        self.bridge = AnkiPapersBridge(self)
        self.channel = QWebChannel(self)
        self.channel.registerObject("bridge", self.bridge)
        self.webview.page().setWebChannel(self.channel)

        # Configure web settings
        settings = self.webview.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

        # Load the React app
        self._load_ui()

    def _load_ui(self):
        """Load the React frontend from the web/ directory."""
        addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        web_dir = os.path.join(addon_dir, "web")
        index_path = os.path.join(web_dir, "index.html")

        if os.path.exists(index_path):
            url = QUrl.fromLocalFile(index_path)
            self.webview.load(url)
        else:
            # Fallback: show error message
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
                """,
                QUrl.fromLocalFile(web_dir + "/"),
            )

    def closeEvent(self, event):
        """Clean up on close."""
        AnkiPapersWindow._instance = None
        super().closeEvent(event)
