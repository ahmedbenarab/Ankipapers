"""Add-on-owned local HTTP server for the PDF preview panel (Stage 3, D3).

Why this exists: once Anki Papers' own window is served over http:// (the
migration this refactor is about), Chromium forbids that http:// page from
framing / XHR-loading file:/// URLs, so `web/pdf_viewer.html` (pdf.js) can no
longer read a user's PDF straight off disk. Anki's own media server only
serves the add-on's `web/` folder and the collection's media folder, and
copying arbitrary PDFs into collection.media would sync them to AnkiWeb. So
the add-on runs a tiny stdlib HTTP server of its own, on 127.0.0.1, and
serves both the viewer HTML and the registered PDF bytes from the same
origin (no CORS to worry about).

This module must import with NO `aqt`/Anki imports whatsoever — the caller
(`gui/bridge.py`) passes in the path to the viewer HTML rather than this
module reaching into Anki's add-on-path helpers itself. That keeps the
module testable standalone (see <scratchpad>/check_pdf_server.py) and keeps
Anki's own event loop out of this file entirely.
"""

import http.server
import os
import re
import secrets
import threading

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")

_CHUNK_SIZE = 64 * 1024


class _Handler(http.server.BaseHTTPRequestHandler):
    """Serves exactly two routes: GET /viewer and GET|HEAD /pdf/<token>."""

    server_version = "AnkiPapersPdfServer/1"

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        # Silenced: this would otherwise spam every request onto stderr,
        # which ends up in Anki's log.
        pass

    def do_GET(self):
        self._route(send_body=True)

    def do_HEAD(self):
        self._route(send_body=False)

    def _route(self, send_body):
        path = self.path.split("?", 1)[0]
        if path == "/viewer":
            self._serve_viewer(send_body)
            return
        if path.startswith("/pdf/"):
            token = path[len("/pdf/"):]
            if _TOKEN_RE.match(token or ""):
                self._serve_pdf(token, send_body)
                return
        self.send_error(404)

    def _serve_viewer(self, send_body):
        viewer_path = self.server.ankipapers_viewer_html_path
        try:
            with open(viewer_path, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if send_body:
            self.wfile.write(data)

    def _serve_pdf(self, token, send_body):
        registry = self.server.ankipapers_registry
        path = registry.get(token)
        if not path or not os.path.isfile(path):
            self.send_error(404)
            return

        try:
            size = os.path.getsize(path)
        except OSError:
            self.send_error(404)
            return

        start, end = 0, size - 1
        status = 200
        range_header = self.headers.get("Range")
        if range_header:
            parsed = self._parse_range(range_header, size)
            if parsed is None:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.end_headers()
                return
            start, end = parsed
            status = 206

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()

        if not send_body:
            return

        try:
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(_CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            # Client (pdf.js) aborted a range request mid-stream; nothing to do.
            pass

    @staticmethod
    def _parse_range(header, size):
        """Parse a single-range 'Range' header.

        Supports 'bytes=a-b', open-ended 'bytes=a-', and suffix 'bytes=-n'.
        Returns (start, end) inclusive, or None if the range is malformed or
        unsatisfiable for the given size.
        """
        m = _RANGE_RE.match((header or "").strip())
        if not m:
            return None
        start_s, end_s = m.group(1), m.group(2)
        if start_s == "" and end_s == "":
            return None
        if size <= 0:
            return None
        if start_s == "":
            # Suffix range: last n bytes.
            n = int(end_s)
            if n <= 0:
                return None
            start = max(0, size - n)
            end = size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s != "" else size - 1
        if start >= size or start > end:
            return None
        if end > size - 1:
            end = size - 1
        return start, end


class PdfServer:
    """Singleton wrapper around a `ThreadingHTTPServer` bound to 127.0.0.1:0.

    Started lazily via `PdfServer.instance(viewer_html_path)`. Registered
    PDFs live only in an in-memory {token: path} map for the lifetime of the
    server (i.e. the Anki process) — nothing is ever written to disk by this
    module, and nothing is served except `/viewer` and explicitly
    `register()`ed files under `/pdf/<token>`.
    """

    _instance = None
    _create_lock = threading.Lock()

    def __init__(self, viewer_html_path):
        self.viewer_html_path = viewer_html_path
        self._registry = {}
        self._registry_lock = threading.Lock()

        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._httpd.daemon_threads = True
        # Attach state the request handler needs; kept off the class so a
        # (hypothetical) second server instance never shares state.
        self._httpd.ankipapers_viewer_html_path = viewer_html_path
        self._httpd.ankipapers_registry = self._registry

        self.port = self._httpd.server_address[1]

        self._thread = threading.Thread(
            target=self._httpd.serve_forever, name="AnkiPapersPdfServer", daemon=True
        )
        self._thread.start()

    @classmethod
    def instance(cls, viewer_html_path=None):
        """Return the singleton `PdfServer`, creating and starting it on
        first call. `viewer_html_path` is required the first time; later
        calls (with or without an argument) return the already-running
        singleton unchanged.
        """
        with cls._create_lock:
            if cls._instance is None:
                if not viewer_html_path:
                    raise ValueError(
                        "PdfServer.instance() requires viewer_html_path on first call"
                    )
                cls._instance = cls(viewer_html_path)
            return cls._instance

    def viewer_url(self):
        return "http://127.0.0.1:%d/viewer" % self.port

    def register(self, path):
        """Register a PDF file for serving; returns its URL, or None if
        `path` is not a real file. Registering the same path twice returns
        the same URL (existing token is reused).
        """
        if not path or not os.path.isfile(path):
            return None
        with self._registry_lock:
            for token, existing_path in self._registry.items():
                if existing_path == path:
                    return "http://127.0.0.1:%d/pdf/%s" % (self.port, token)
            token = secrets.token_urlsafe(24)
            self._registry[token] = path
        return "http://127.0.0.1:%d/pdf/%s" % (self.port, token)
