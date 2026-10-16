"""
Sources for Anki Papers: files and web pages attached to a paper or a folder.

A source is attached either to one paper, or to a folder -- in which case
every paper inside that folder (at any depth) sees it too. A folder source can
be split into chapters (a PDF book's page ranges, or a course's modules), each
matched to one paper; that paper then opens the source at its own chapter.

Where things live:
  * The registry (which sources exist, who they're attached to, the chapter
    map) is stored in the collection config, like the papers themselves.
  * The files are copied into <profile>/ankipapers/sources/ -- on this
    computer only. They are deliberately NOT put in collection.media, which
    would sync a 50 MB textbook to AnkiWeb.
  * Web pages are saved as cleaned-up snapshots under sources/web/<id>/, so
    they read offline and don't change under the cards made from them.

Nothing here imports aqt; the bridge passes in the collection accessors.
"""

import base64
import hashlib
import html
import json
import os
import re
import shutil
import ssl
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

REGISTRY_KEY = "ankipapers.sources.v1"

FILE_KINDS = {
    ".pdf": "pdf", ".docx": "docx", ".pptx": "pptx",
    ".html": "html", ".htm": "html", ".txt": "text", ".md": "text", ".markdown": "text",
}

USER_AGENT = "Mozilla/5.0 (Macintosh) AnkiPapers"
MAX_FETCH_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 3 * 1024 * 1024
LEARN_CATALOG_URL = "https://learn.microsoft.com/api/learn/catalog?locale=en-us"
LEARN_CATALOG_MAX_AGE = 7 * 24 * 3600


class SourceError(Exception):
    pass


# ─── Registry ─────────────────────────────────────────────────────────

class Registry:
    """Load / save the sources registry through caller-supplied accessors."""

    def __init__(self, get_fn: Callable[[str, Any], Any], set_fn: Callable[[str, Any], bool],
                 root_fn: Callable[[], str]):
        self._get = get_fn
        self._set = set_fn
        self._root = root_fn

    # Files
    def dir(self, *parts: str) -> str:
        d = os.path.join(self._root(), "sources", *parts)
        os.makedirs(d, exist_ok=True)
        return d

    def file_path(self, item: Dict[str, Any]) -> str:
        return os.path.join(self.dir(), item.get("file") or "") if item.get("file") else ""

    # Data
    def load(self) -> Dict[str, Any]:
        data = self._get(REGISTRY_KEY, None)
        if not isinstance(data, dict):
            data = {}
        data.setdefault("items", {})
        data.setdefault("papers", {})
        data.setdefault("folders", {})
        return data

    def save(self, data: Dict[str, Any]) -> None:
        if not self._set(REGISTRY_KEY, data):
            raise SourceError("Couldn't save the sources list to the collection.")

    # Items
    def add_file(self, src_path: str, title: str = "") -> Dict[str, Any]:
        ext = os.path.splitext(src_path)[1].lower()
        kind = FILE_KINDS.get(ext)
        if not kind:
            raise SourceError("That file type isn't supported. Use PDF, Word, PowerPoint, HTML or text.")
        if not os.path.isfile(src_path):
            raise SourceError("File not found.")
        h = hashlib.sha1()
        with open(src_path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        digest = h.hexdigest()[:16]
        data = self.load()
        # The same file attached twice is stored and listed once.
        for item in data["items"].values():
            if item.get("sha1") == digest:
                return item
        fname = f"{digest}{ext}"
        dest = os.path.join(self.dir(), fname)
        if not os.path.exists(dest):
            shutil.copy2(src_path, dest)
        item = {
            "id": uuid.uuid4().hex[:12], "kind": kind,
            "title": title or os.path.splitext(os.path.basename(src_path))[0],
            "file": fname, "original_name": os.path.basename(src_path),
            "sha1": digest, "size": os.path.getsize(dest), "added_at": time.time(),
        }
        data["items"][item["id"]] = item
        self.save(data)
        return item

    def add_web(self, url: str, title: str, structure: Dict[str, Any] = None,
                keep: str = "snapshot") -> Dict[str, Any]:
        data = self.load()
        item = {"id": uuid.uuid4().hex[:12], "kind": "web", "title": title or url, "url": url,
                "keep": keep if keep in ("snapshot", "live") else "snapshot",
                "web_kind": (structure or {}).get("kind", "page"), "added_at": time.time()}
        data["items"][item["id"]] = item
        self.save(data)
        return item

    def get(self, source_id: str) -> Optional[Dict[str, Any]]:
        return self.load()["items"].get(source_id)

    # Attachments
    def attach_to_paper(self, paper_id: str, source_id: str) -> None:
        data = self.load()
        ids = data["papers"].setdefault(paper_id, [])
        if source_id not in ids:
            ids.append(source_id)
        self.save(data)

    def detach_from_paper(self, paper_id: str, source_id: str) -> None:
        data = self.load()
        ids = [s for s in data["papers"].get(paper_id, []) if s != source_id]
        if ids:
            data["papers"][paper_id] = ids
        else:
            data["papers"].pop(paper_id, None)
        self._gc(data)
        self.save(data)

    def attach_to_folder(self, folder: str, source_id: str, chapters: List[Dict[str, Any]],
                         options: Dict[str, Any]) -> Dict[str, Any]:
        data = self.load()
        entries = [e for e in data["folders"].get(folder, []) if e.get("source_id") != source_id]
        entry = {
            "source_id": source_id,
            "chapters": [_clean_chapter(c) for c in (chapters or [])],
            "page_offset": int(options.get("page_offset") or 0),
            "units": options.get("units") or "units",
            "unmatched": options.get("unmatched") or "link",
        }
        if options.get("group_folders"):
            entry["group_folders"] = {str(g): str(f) for g, f in options["group_folders"].items() if f is not None}
        entries.append(entry)
        data["folders"][folder] = entries
        self.save(data)
        return entry

    def detach_from_folder(self, folder: str, source_id: str) -> None:
        data = self.load()
        entries = [e for e in data["folders"].get(folder, []) if e.get("source_id") != source_id]
        if entries:
            data["folders"][folder] = entries
        else:
            data["folders"].pop(folder, None)
        self._gc(data)
        self.save(data)

    def set_chapter_paper(self, folder: str, source_id: str, key: str, paper_id: Optional[str]) -> None:
        data = self.load()
        for e in data["folders"].get(folder, []):
            if e.get("source_id") != source_id:
                continue
            for c in e.get("chapters", []):
                if c.get("key") == key:
                    c["paper_id"] = paper_id
        self.save(data)

    def _gc(self, data: Dict[str, Any]) -> None:
        """Forget sources nothing is attached to any more, and delete their files."""
        used = set()
        for ids in data["papers"].values():
            used.update(ids)
        for entries in data["folders"].values():
            used.update(e.get("source_id") for e in entries)
        for sid in [s for s in data["items"] if s not in used]:
            item = data["items"].pop(sid)
            still_shared = any(i.get("file") == item.get("file") for i in data["items"].values())
            try:
                if item.get("file") and not still_shared:
                    p = os.path.join(self.dir(), item["file"])
                    if os.path.isfile(p):
                        os.remove(p)
                web_dir = os.path.join(self._root(), "sources", "web", sid)
                if os.path.isdir(web_dir):
                    shutil.rmtree(web_dir, ignore_errors=True)
            except Exception:
                traceback.print_exc()

    # Keeping folder paths and paper ids current
    def rename_folder(self, old: str, new: str) -> None:
        data = self.load()
        before = json.dumps(data["folders"], sort_keys=True)
        moved = lambda p: new + p[len(old):] if (p == old or p.startswith(old + "/")) else p
        changed = {}
        for path, entries in data["folders"].items():
            for e in entries:
                gf = e.get("group_folders")
                if gf:
                    e["group_folders"] = {g: (moved(f) if f else f) for g, f in gf.items()}
            changed[moved(path)] = entries
        if json.dumps(changed, sort_keys=True) != before:
            data["folders"] = changed
            self.save(data)

    def delete_folder(self, path: str) -> None:
        data = self.load()
        keep = {p: e for p, e in data["folders"].items() if p != path and not p.startswith(path + "/")}
        gone = lambda f: bool(f) and (f == path or f.startswith(path + "/"))
        dropped_override = False
        for entries in keep.values():
            for e in entries:
                gf = e.get("group_folders") or {}
                for g in [g for g, f in gf.items() if gone(f)]:
                    del gf[g]
                    dropped_override = True
        if len(keep) != len(data["folders"]) or dropped_override:
            data["folders"] = keep
            self._gc(data)
            self.save(data)

    def forget_paper(self, paper_id: str) -> None:
        data = self.load()
        changed = data["papers"].pop(paper_id, None) is not None
        for entries in data["folders"].values():
            for e in entries:
                for c in e.get("chapters", []):
                    if c.get("paper_id") == paper_id:
                        c["paper_id"] = None
                        changed = True
        if changed:
            self._gc(data)
            self.save(data)

    def link_new_paper(self, paper_id: str, title: str, folder_path: str,
                       ctx: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """A paper was just created, renamed or moved: connect it to a waiting
        chapter with a matching title. In a learning path's sub-folder, that
        path's chapters are tried first."""
        data = self.load()
        for entries in data["folders"].values():
            for e in entries:
                if any(c.get("paper_id") == paper_id for c in e.get("chapters", [])):
                    return None  # already a chapter somewhere
        best = None
        for folder in _ancestors(folder_path):
            for e in data["folders"].get(folder, []):
                if e.get("unmatched", "link") == "skip":
                    continue
                gmap = group_folder_map(folder, e, ctx) if ctx else {}
                for c in e.get("chapters", []):
                    if c.get("paper_id") or c.get("skip"):
                        continue
                    score = title_similarity(title, c.get("title", ""))
                    home = gmap.get(c.get("group") or "")
                    if home and (folder_path == home or folder_path.startswith(home + "/")):
                        score += 0.05  # same learning path wins a near tie
                    if score >= 0.6 and (best is None or score > best[0]):
                        best = (score, folder, e, c)
            if best:
                break
        if not best:
            return None
        best[3]["paper_id"] = paper_id
        self.save(data)
        return {"folder": best[1], "source_id": best[2]["source_id"], "chapter": best[3]}

    # What a paper sees
    def for_paper(self, paper_id: str, folder_path: str) -> List[Dict[str, Any]]:
        data = self.load()
        out = []
        for sid in data["papers"].get(paper_id, []):
            item = data["items"].get(sid)
            if item:
                out.append({"source": self._public(item), "scope": "paper"})
        for folder in _ancestors(folder_path):
            for e in data["folders"].get(folder, []):
                item = data["items"].get(e.get("source_id"))
                if not item:
                    continue
                chapters = e.get("chapters", [])
                mine = next((c for c in chapters if c.get("paper_id") == paper_id), None)
                out.append({
                    "source": self._public(item), "scope": "folder", "folder": folder,
                    "chapter": mine, "chapter_index": chapters.index(mine) if mine else None,
                    "chapter_count": len([c for c in chapters if not c.get("skip")]),
                    "page_offset": e.get("page_offset", 0), "units": e.get("units", "units"),
                })
        return out

    def for_folder(self, folder: str) -> List[Dict[str, Any]]:
        data = self.load()
        out = []
        for e in data["folders"].get(folder, []):
            item = data["items"].get(e.get("source_id"))
            if item:
                out.append({**e, "source": self._public(item)})
        return out

    def folders_summary(self, ctx: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """For the sidebar.

        folders: {folder path: {kinds, chapters, sources: [{id, title, kind}]}} for
                 folders that have sources attached.
        waiting: {folder path: [chapter, ...]} -- chapters still waiting for a
                 paper, listed under the folder their paper belongs in: the
                 learning path's sub-folder when there is one, else the folder
                 the source is attached to. In course order.
        """
        data = self.load()
        folders, waiting = {}, {}
        for folder, entries in data["folders"].items():
            kinds, srcs = [], []
            for e in entries:
                item = data["items"].get(e.get("source_id"))
                if not item:
                    continue
                kinds.append(item.get("kind"))
                srcs.append({"id": item["id"], "title": item.get("title"), "kind": item.get("kind")})
                if e.get("unmatched", "link") == "skip":
                    continue
                gmap = group_folder_map(folder, e, ctx)
                for n, c in enumerate(e.get("chapters", [])):
                    if c.get("paper_id") or c.get("skip"):
                        continue
                    home = gmap.get(c.get("group") or "") or folder
                    waiting.setdefault(home, []).append({
                        "source_id": item["id"], "key": c.get("key"), "title": c.get("title"),
                        "group": c.get("group"), "folder": folder, "order": n,
                    })
            if kinds:
                folders[folder] = {"kinds": kinds, "sources": srcs,
                                   "chapters": sum(len(e.get("chapters", [])) for e in entries)}
        return {"folders": folders, "waiting": waiting}

    def group_folders(self, folder: str, source_id: str, ctx: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
        for e in self.load()["folders"].get(folder, []):
            if e.get("source_id") == source_id:
                return group_folder_map(folder, e, ctx)
        return {}

    def set_group_folder(self, folder: str, source_id: str, group: str, target: Optional[str]) -> None:
        """Pin a learning path to a sub-folder ("" = the source's own folder; None = automatic)."""
        data = self.load()
        for e in data["folders"].get(folder, []):
            if e.get("source_id") == source_id:
                gf = e.setdefault("group_folders", {})
                if target is None:
                    gf.pop(group, None)
                else:
                    gf[group] = target
        self.save(data)

    def chapter_neighbors(self, folder: str, source_id: str, key: str) -> Dict[str, Any]:
        data = self.load()
        for e in data["folders"].get(folder, []):
            if e.get("source_id") != source_id:
                continue
            chs = [c for c in e.get("chapters", []) if not c.get("skip")]
            idx = next((i for i, c in enumerate(chs) if c.get("key") == key), None)
            if idx is None:
                return {}
            return {"prev": chs[idx - 1] if idx > 0 else None,
                    "next": chs[idx + 1] if idx + 1 < len(chs) else None,
                    "index": idx, "count": len(chs)}
        return {}

    def _public(self, item: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: item.get(k) for k in ("id", "kind", "title", "url", "original_name", "size", "keep", "web_kind")}
        out["available"] = item.get("kind") == "web" or os.path.isfile(self.file_path(item))
        return out


def _clean_chapter(c: Dict[str, Any]) -> Dict[str, Any]:
    out = {"key": str(c.get("key") or uuid.uuid4().hex[:8]), "title": str(c.get("title") or "").strip(),
           "paper_id": c.get("paper_id") or None, "skip": bool(c.get("skip"))}
    for k in ("group", "url"):
        if c.get(k):
            out[k] = str(c[k])
    for k in ("start", "end"):
        if c.get(k) is not None:
            try:
                out[k] = int(c[k])
            except (TypeError, ValueError):
                pass
    return out


def _child_of(folder: str, path: str) -> Optional[str]:
    """The direct sub-folder of `folder` that `path` is in (or is), else None."""
    if not path or not path.startswith(folder + "/"):
        return None
    return folder + "/" + path[len(folder) + 1:].split("/")[0]


def name_in_title(name: str, title: str) -> float:
    """How much of a short folder name is found in a long title (0..1):
    "AI Concepts" is all there in "AI concepts for developers and technology
    professionals"; "1. AI Apps & Agents" in "Get started with AI applications
    and agents on Azure"."""
    a, b = set(_tokens(name)), set(_tokens(title))
    if not a or not b:
        return 0.0
    return len(a & b) / len(a)


def group_folder_map(folder: str, entry: Dict[str, Any], ctx: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Which sub-folder of `folder` holds each learning path (group) of a source.

    In order of preference: a choice made in the attach dialog; the sub-folder
    where most of the group's papers already are; a sub-folder whose name
    matches the group's title. A group with none of these lives in `folder`
    itself (and isn't in the result).
    """
    ctx = ctx or {}
    all_folders = ctx.get("folders") or []
    paper_folders = ctx.get("paper_folders") or {}
    children = [f for f in all_folders if f.startswith(folder + "/") and "/" not in f[len(folder) + 1:]]
    chapters = entry.get("chapters", [])
    groups = []
    for c in chapters:
        g = c.get("group") or ""
        if g and g not in groups:
            groups.append(g)
    if not groups:
        return {}
    pinned = entry.get("group_folders") or {}
    out, taken = {}, set()
    for g in groups:
        if g in pinned:
            f = pinned[g]
            if f and (f in all_folders or not all_folders):
                out[g] = f
                taken.add(f)
            elif f == "":
                taken.add(None)
    # Where the group's papers already are.
    for g in groups:
        if g in pinned:
            continue
        votes: Dict[str, int] = {}
        for c in chapters:
            if (c.get("group") or "") != g or not c.get("paper_id"):
                continue
            child = _child_of(folder, paper_folders.get(c["paper_id"], ""))
            if child:
                votes[child] = votes.get(child, 0) + 1
        if votes:
            best = max(votes.items(), key=lambda kv: kv[1])[0]
            if best not in taken:
                out[g] = best
                taken.add(best)
    # By name, best pairs first.
    pairs = []
    for g in groups:
        if g in out or g in pinned:
            continue
        for ch in children:
            if ch in taken:
                continue
            score = name_in_title(ch.rsplit("/", 1)[-1], g)
            if score >= 0.66:
                pairs.append((score, g, ch))
    for score, g, ch in sorted(pairs, reverse=True):
        if g in out or ch in taken:
            continue
        out[g] = ch
        taken.add(ch)
    return out


def _ancestors(folder_path: str) -> List[str]:
    """'A/B/C' -> ['A/B/C', 'A/B', 'A'] (nearest first)."""
    parts = [p for p in (folder_path or "").split("/") if p]
    return ["/".join(parts[:i]) for i in range(len(parts), 0, -1)]


# ─── Title matching ───────────────────────────────────────────────────

_STOP = {"to", "the", "a", "an", "of", "in", "on", "for", "and", "with", "w", "your", "into", "at", "by"}
_EXPAND = {
    "intro": ["introduction"], "nlp": ["natural", "language", "processing"],
    "rag": ["retrieval", "augmented", "generation"], "ml": ["machine", "learning"],
    "cv": ["computer", "vision"], "genai": ["generative", "ai"], "gen": ["generative"],
    "ecg": ["electrocardiography"], "ekg": ["electrocardiography"], "hf": ["heart", "failure"],
    "mgmt": ["management"], "dx": ["diagnosis"], "tx": ["treatment"], "pt": ["patient"],
    "apps": ["applications"], "app": ["application"], "info": ["information"],
}


def _tokens(s: str) -> List[str]:
    s = html.unescape(s or "").lower().replace("&", " and ")
    s = re.sub(r"^\s*(?:chapter|ch\.?|module|unit|part|lecture|week)\s*\d+[a-z]?\b", " ", s)
    s = re.sub(r"^\s*\d+[a-z]?\s*[·.:)\-–—]\s*", " ", s)
    s = re.sub(r"[^\w\s-]", " ", s).replace("-", " ")
    out = []
    for t in s.split():
        if t in _STOP or t.isdigit():
            continue
        for w in _EXPAND.get(t, [t]):
            # "Variable" and "Variables", "Concept" and "Concepts" are the same word here.
            out.append(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w)
    return out


def title_similarity(a: str, b: str) -> float:
    ta, tb = set(_tokens(a)), set(_tokens(b))
    if not ta or not tb:
        return 0.0
    return 2 * len(ta & tb) / (len(ta) + len(tb))


def match_chapters(chapters: List[Dict[str, Any]], papers: List[Dict[str, Any]],
                   threshold: float = 0.6) -> Dict[str, str]:
    """chapter key -> paper id, best pairs first, each paper used once."""
    pairs = []
    for c in chapters:
        for p in papers:
            s = title_similarity(c.get("title", ""), p.get("title", ""))
            if s >= threshold:
                pairs.append((s, c["key"], p["id"]))
    pairs.sort(reverse=True)
    used_c, used_p, out = set(), set(), {}
    for s, ck, pid in pairs:
        if ck in used_c or pid in used_p:
            continue
        out[ck] = pid
        used_c.add(ck)
        used_p.add(pid)
    return out


# ─── Reader view: Word, PowerPoint, HTML, text ────────────────────────

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
         ".bmp": "image/bmp", ".svg": "image/svg+xml", ".webp": "image/webp"}


def _esc(s: str) -> str:
    return html.escape(s or "", quote=True)


def _rels(z: zipfile.ZipFile, rels_path: str) -> Dict[str, str]:
    try:
        root = ET.fromstring(z.read(rels_path))
    except (KeyError, ET.ParseError):
        return {}
    base = os.path.dirname(os.path.dirname(rels_path))
    out = {}
    for rel in root.iter(f"{PKG_REL}Relationship"):
        target = rel.get("Target") or ""
        if rel.get("TargetMode") == "External":
            continue
        out[rel.get("Id")] = os.path.normpath(os.path.join(base, target)).replace("\\", "/").lstrip("/")
    return out


def _img_data_uri(z: zipfile.ZipFile, path: str) -> str:
    mime = _MIME.get(os.path.splitext(path)[1].lower())
    if not mime:
        return ""
    try:
        info = z.getinfo(path)
        if info.file_size > MAX_IMAGE_BYTES:
            return ""
        return f"data:{mime};base64," + base64.b64encode(z.read(path)).decode("ascii")
    except KeyError:
        return ""


def _docx_runs(p, rels, z) -> Tuple[str, str]:
    """(html, text) of one Word paragraph."""
    out_h, out_t = [], []
    for node in p.iter():
        if node.tag == f"{W}r":
            rpr = node.find(f"{W}rPr")
            bold = rpr is not None and rpr.find(f"{W}b") is not None and rpr.find(f"{W}b").get(f"{W}val") not in ("0", "false")
            ital = rpr is not None and rpr.find(f"{W}i") is not None and rpr.find(f"{W}i").get(f"{W}val") not in ("0", "false")
            va = rpr.find(f"{W}vertAlign") if rpr is not None else None
            for ch in node:
                if ch.tag == f"{W}t":
                    t = ch.text or ""
                    out_t.append(t)
                    h = _esc(t)
                    if va is not None and va.get(f"{W}val") in ("subscript", "superscript"):
                        tag = "sub" if va.get(f"{W}val") == "subscript" else "sup"
                        h = f"<{tag}>{h}</{tag}>"
                    if bold:
                        h = f"<b>{h}</b>"
                    if ital:
                        h = f"<i>{h}</i>"
                    out_h.append(h)
                elif ch.tag == f"{W}tab":
                    out_h.append(" ")
                    out_t.append(" ")
                elif ch.tag in (f"{W}br", f"{W}cr"):
                    out_h.append("<br>")
                    out_t.append("\n")
        elif node.tag == f"{A}blip":
            rid = node.get(f"{R}embed")
            if rid and rid in rels:
                uri = _img_data_uri(z, rels[rid])
                if uri:
                    out_h.append(f'<img src="{uri}" alt="">')
    return "".join(out_h), "".join(out_t)


def docx_pages(path: str) -> List[Dict[str, str]]:
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
        rels = _rels(z, "word/_rels/document.xml.rels")
        body = root.find(f"{W}body")
        parts_h, parts_t, in_list = [], [], False
        for el in list(body if body is not None else []):
            if el.tag == f"{W}p":
                ppr = el.find(f"{W}pPr")
                style = ""
                is_item = False
                if ppr is not None:
                    ps = ppr.find(f"{W}pStyle")
                    style = (ps.get(f"{W}val") if ps is not None else "") or ""
                    is_item = ppr.find(f"{W}numPr") is not None or style.lower().startswith("list")
                h, t = _docx_runs(el, rels, z)
                if not h.strip():
                    continue
                m = re.match(r"(?i)heading\s*(\d)|title", style)
                if is_item and not m:
                    if not in_list:
                        parts_h.append("<ul>")
                        in_list = True
                    parts_h.append(f"<li>{h}</li>")
                    parts_t.append("• " + t)
                    continue
                if in_list:
                    parts_h.append("</ul>")
                    in_list = False
                if m:
                    level = min(4, int(m.group(1)) + 1) if m.group(1) else 1
                    parts_h.append(f"<h{level}>{h}</h{level}>")
                else:
                    parts_h.append(f"<p>{h}</p>")
                parts_t.append(t)
            elif el.tag == f"{W}tbl":
                if in_list:
                    parts_h.append("</ul>")
                    in_list = False
                rows = []
                for tr in el.iter(f"{W}tr"):
                    cells = []
                    for tc in tr.iter(f"{W}tc"):
                        cell = " ".join(_docx_runs(p, rels, z)[0] for p in tc.iter(f"{W}p"))
                        cells.append(f"<td>{cell}</td>")
                        parts_t.append(" ".join(_docx_runs(p, rels, z)[1] for p in tc.iter(f"{W}p")))
                    rows.append("<tr>" + "".join(cells) + "</tr>")
                parts_h.append("<table>" + "".join(rows) + "</table>")
        if in_list:
            parts_h.append("</ul>")
    return [{"title": "", "html": "\n".join(parts_h), "text": "\n".join(parts_t)}]


def _pptx_text_body(tx) -> Tuple[List[Tuple[int, str, str]], str]:
    paras = []
    for p in tx.iter(f"{A}p"):
        ppr = p.find(f"{A}pPr")
        lvl = int(ppr.get("lvl") or 0) if ppr is not None else 0
        hs, ts = [], []
        for r in p:
            if r.tag in (f"{A}r", f"{A}fld"):
                t = "".join(x.text or "" for x in r.iter(f"{A}t"))
                rpr = r.find(f"{A}rPr")
                h = _esc(t)
                if rpr is not None and rpr.get("b") == "1":
                    h = f"<b>{h}</b>"
                if rpr is not None and rpr.get("i") == "1":
                    h = f"<i>{h}</i>"
                hs.append(h)
                ts.append(t)
            elif r.tag == f"{A}br":
                hs.append("<br>")
                ts.append(" ")
        if "".join(ts).strip():
            paras.append((lvl, "".join(hs), "".join(ts)))
    return paras, "\n".join(t for _, _, t in paras)


def pptx_pages(path: str) -> List[Dict[str, str]]:
    pages = []
    with zipfile.ZipFile(path) as z:
        pres = ET.fromstring(z.read("ppt/presentation.xml"))
        prels = _rels(z, "ppt/_rels/presentation.xml.rels")
        lst = pres.find(f"{P}sldIdLst")
        slide_paths = [prels.get(s.get(f"{R}id")) for s in (lst if lst is not None else [])]
        for n, sp in enumerate([p for p in slide_paths if p], start=1):
            try:
                root = ET.fromstring(z.read(sp))
            except (KeyError, ET.ParseError):
                continue
            rels_path = os.path.join(os.path.dirname(sp), "_rels", os.path.basename(sp) + ".rels")
            srels = _rels(z, rels_path)
            title, body_h, body_t = "", [], []
            for shape in root.iter(f"{P}sp"):
                ph = shape.find(f"{P}nvSpPr/{P}nvPr/{P}ph")
                tx = shape.find(f"{P}txBody")
                if tx is None:
                    continue
                paras, text = _pptx_text_body(tx)
                if ph is not None and ph.get("type") in ("title", "ctrTitle") and not title:
                    title = text.replace("\n", " ").strip()
                    continue
                if ph is not None and ph.get("type") in ("sldNum", "dt", "ftr"):
                    continue
                if paras:
                    body_h.append("<ul>" + "".join(
                        f'<li style="margin-left:{lvl * 18}px">{h}</li>' for lvl, h, _ in paras) + "</ul>")
                    body_t.append(text)
            for pic in root.iter(f"{P}pic"):
                blip = pic.find(f".//{A}blip")
                rid = blip.get(f"{R}embed") if blip is not None else None
                if rid and rid in srels:
                    uri = _img_data_uri(z, srels[rid])
                    if uri:
                        body_h.append(f'<img src="{uri}" alt="">')
            notes = ""
            for rid, target in srels.items():
                if "notesSlide" in target:
                    try:
                        nroot = ET.fromstring(z.read(target))
                        texts = []
                        for shape in nroot.iter(f"{P}sp"):
                            ph = shape.find(f"{P}nvSpPr/{P}nvPr/{P}ph")
                            if ph is not None and ph.get("type") in ("sldImg", "sldNum", "hdr", "ftr", "dt"):
                                continue
                            tx = shape.find(f"{P}txBody")
                            if tx is not None:
                                texts.append(_pptx_text_body(tx)[1])
                        notes = "\n".join(t for t in texts if t.strip())
                    except (KeyError, ET.ParseError):
                        pass
            h = (f"<h2>{_esc(title)}</h2>" if title else "") + "".join(body_h)
            if notes:
                h += '<div class="rd-notes"><b>Speaker notes:</b> ' + _esc(notes).replace("\n", "<br>") + "</div>"
            pages.append({"title": title or f"Slide {n}", "html": h,
                          "text": "\n".join(x for x in [title, *body_t, notes] if x)})
    return pages


def text_pages(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    out = []
    for block in re.split(r"\n\s*\n", raw):
        b = block.strip()
        if not b:
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", b)
        if m and "\n" not in b:
            lvl = min(4, len(m.group(1)) + 1)
            out.append(f"<h{lvl}>{_esc(m.group(2))}</h{lvl}>")
        else:
            out.append("<p>" + _esc(b).replace("\n", "<br>") + "</p>")
    return [{"title": "", "html": "\n".join(out), "text": raw}]


# HTML -> clean reader HTML

_DROP = {"script", "style", "nav", "header", "footer", "form", "button", "svg", "noscript", "iframe",
         "aside", "select", "template", "input", "textarea", "label", "dialog", "object", "embed",
         "canvas", "video", "audio", "map"}
_KEEP = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "pre", "code", "blockquote",
         "table", "thead", "tbody", "tr", "th", "td", "strong", "b", "em", "i", "u", "sub", "sup",
         "br", "hr", "img", "a", "dl", "dt", "dd", "figure", "figcaption", "kbd", "mark"}
_VOID = {"br", "hr", "img", "input", "meta", "link", "source", "area", "col", "wbr", "base", "param", "track"}
_BLOCK = {"p", "div", "section", "article", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre",
          "blockquote", "table", "ul", "ol", "dd", "dt", "figure", "br"}


class _Cleaner(HTMLParser):
    def __init__(self, base_url: str, root_pred: Callable[[str, Dict[str, str]], bool]):
        super().__init__(convert_charrefs=True)
        self.base = base_url
        self.root_pred = root_pred
        self.depth_in_root = 0     # >0 while inside the chosen content root
        self.drop_depth = 0        # >0 while inside an element we drop
        self.out: List[str] = []
        self.text: List[str] = []
        self.title = ""
        self._in_title = False
        self.found_root = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        if self.depth_in_root == 0:
            if not self.found_root and self.root_pred(tag, a):
                self.found_root = True
                if tag not in _VOID:
                    self.depth_in_root = 1
            return
        if tag not in _VOID:
            self.depth_in_root += 1
        hidden = ("hidden" in a or a.get("aria-hidden") == "true"
                  or "visually-hidden" in a.get("class", "") or a.get("role") == "navigation")
        if self.drop_depth or tag in _DROP or hidden:
            if tag not in _VOID:
                self.drop_depth += 1
            return
        if tag in _BLOCK:
            self.text.append("\n")
        if tag not in _KEEP:
            return
        if tag == "img":
            src = a.get("src") or a.get("data-src") or ""
            if src and not src.startswith("data:"):
                src = urllib.parse.urljoin(self.base, src)
            if src.startswith(("http://", "https://", "data:image/")):
                self.out.append(f'<img src="{_esc(src)}" alt="{_esc(a.get("alt", ""))}">')
            return
        if tag == "a":
            href = urllib.parse.urljoin(self.base, a.get("href", "")) if a.get("href") else ""
            if href.startswith(("http://", "https://")):
                self.out.append(f'<span class="rd-link" data-href="{_esc(href)}">')
            else:
                self.out.append("<span>")
            return
        self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if self.depth_in_root == 0 or tag in _VOID:
            return
        self.depth_in_root -= 1
        if self.drop_depth:
            self.drop_depth -= 1
            return
        if tag in _BLOCK:
            self.text.append("\n")
        if tag == "a":
            self.out.append("</span>")
        elif tag in _KEEP:
            self.out.append(f"</{tag}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self.depth_in_root and not self.drop_depth:
            self.out.append(_esc(data))
            self.text.append(data)


def _content_root(html_text: str) -> Callable[[str, Dict[str, str]], bool]:
    """Pick the element that holds the page's real content."""
    low = html_text.lower()
    if 'id="unit-inner-section"' in low:
        return lambda t, a: a.get("id") == "unit-inner-section"
    if "<article" in low:
        return lambda t, a: t == "article"
    if "<main" in low:
        return lambda t, a: t == "main"
    if 'role="main"' in low:
        return lambda t, a: a.get("role") == "main"
    return lambda t, a: t == "body"


def clean_html(html_text: str, base_url: str = "") -> Dict[str, str]:
    c = _Cleaner(base_url, _content_root(html_text))
    try:
        c.feed(html_text)
        c.close()
    except Exception:
        traceback.print_exc()
    body = "".join(c.out)
    body = re.sub(r"<(p|li|h\d|td|span)>\s*</\1>", "", body)
    body = re.sub(r"(\s*\n\s*){2,}", "\n", body)
    text = re.sub(r"[ \t]+", " ", "".join(c.text))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return {"title": html.unescape(c.title).strip(), "html": body, "text": text}


def html_file_pages(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        doc = clean_html(f.read())
    return [{"title": doc["title"], "html": doc["html"], "text": doc["text"]}]


def file_pages(item: Dict[str, Any], path: str) -> List[Dict[str, str]]:
    kind = item.get("kind")
    if kind == "docx":
        return docx_pages(path)
    if kind == "pptx":
        return pptx_pages(path)
    if kind == "html":
        return html_file_pages(path)
    if kind == "text":
        return text_pages(path)
    raise SourceError("This source is shown in the PDF viewer.")


# ─── Web ──────────────────────────────────────────────────────────────

def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def normalize_url(raw: str) -> str:
    u = (raw or "").strip()
    if not u:
        raise SourceError("Enter an address.")
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u.lstrip("/")
    p = urllib.parse.urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise SourceError("That doesn't look like a web address.")
    # Drop tracking parameters Learn adds to its links.
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not k.lower().startswith(("wt.", "utm_"))]
    return urllib.parse.urlunparse(p._replace(query=urllib.parse.urlencode(q), fragment=""))


def fetch(url: str, timeout: float = 25.0, max_bytes: int = MAX_FETCH_BYTES) -> Tuple[str, str]:
    """(text, final_url). Raises SourceError with a readable message."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
            data = r.read(max_bytes + 1)
            charset = r.headers.get_content_charset() or "utf-8"
            return data[:max_bytes].decode(charset, errors="replace"), r.geturl()
    except urllib.error.HTTPError as e:
        raise SourceError(f"The page returned an error ({e.code}).") from None
    except urllib.error.URLError as e:
        raise SourceError(f"Couldn't reach {urllib.parse.urlparse(url).netloc}: {e.reason}") from None
    except TimeoutError:
        raise SourceError("The page took too long to load.") from None


_LEARN_RE = re.compile(r"learn\.microsoft\.com/(?:[a-z]{2}-[a-z]{2}/)?training/(courses|paths|modules)/([^/?#]+)", re.I)


class LearnCatalog:
    """Microsoft Learn's public catalog API, cached on disk for a week."""

    def __init__(self, cache_dir_fn: Callable[[], str]):
        self._dir = cache_dir_fn
        self._data = None

    def data(self) -> Dict[str, Any]:
        if self._data is not None:
            return self._data
        path = os.path.join(self._dir(), "learn_catalog.json")
        if os.path.isfile(path) and time.time() - os.path.getmtime(path) < LEARN_CATALOG_MAX_AGE:
            with open(path, "r", encoding="utf-8") as f:
                self._data = json.load(f)
                return self._data
        raw, _ = fetch(LEARN_CATALOG_URL, timeout=90, max_bytes=80 * 1024 * 1024)
        full = json.loads(raw)
        slim = {
            "courses": [{k: c.get(k) for k in ("uid", "title", "url", "course_number", "study_guide")}
                        for c in full.get("courses", [])],
            "learningPaths": [{k: p.get(k) for k in ("uid", "title", "url", "modules")}
                              for p in full.get("learningPaths", [])],
            "modules": [{k: m.get(k) for k in ("uid", "title", "url", "units")} for m in full.get("modules", [])],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(slim, f)
        self._data = slim
        return slim


def _learn_url(u: str) -> str:
    return normalize_url((u or "").split("?")[0])


def _slug_of(url: str) -> str:
    return url.rstrip("/").rsplit("/", 1)[-1].lower()


def inspect_web(url: str, catalog: LearnCatalog) -> Dict[str, Any]:
    """Work out a web source's chapters.

    Returns {"title", "kind", "url", "groups": [{"title", "chapters": [{"key", "title", "url"}]}]}.
    """
    url = normalize_url(url)
    m = _LEARN_RE.search(url)
    if m:
        try:
            return _inspect_learn(url, m.group(1).lower(), m.group(2).lower(), catalog)
        except SourceError:
            raise
        except Exception:
            traceback.print_exc()  # fall through to reading the page itself
    text, final = fetch(url)
    doc = clean_html(text, final)
    base = urllib.parse.urlparse(final)
    links, seen = [], set()
    for mm in re.finditer(r'<span class="rd-link" data-href="([^"]+)">(.*?)</span>', doc["html"], re.S):
        href = html.unescape(mm.group(1)).split("#")[0]
        title = re.sub(r"<[^>]+>", "", html.unescape(mm.group(2))).strip()
        hp = urllib.parse.urlparse(href)
        if hp.netloc != base.netloc or not title or len(title) > 160:
            continue
        if href.rstrip("/") == final.rstrip("/") or href in seen:
            continue
        seen.add(href)
        links.append({"key": hashlib.sha1(href.encode()).hexdigest()[:10], "title": title, "url": href})
    if not links:
        links = [{"key": "page", "title": doc["title"] or final, "url": final}]
    return {"title": doc["title"] or final, "kind": "page", "url": final,
            "groups": [{"title": "", "chapters": links[:300]}]}


def _inspect_learn(url: str, kind: str, slug: str, catalog: LearnCatalog) -> Dict[str, Any]:
    cat = catalog.data()
    mods = {m["uid"]: m for m in cat["modules"]}

    def module_chapter(uid: str, group: str = "") -> Optional[Dict[str, Any]]:
        mm = mods.get(uid)
        if not mm:
            return None
        ch = {"key": uid, "title": mm["title"], "url": _learn_url(mm["url"])}
        if group:
            ch["group"] = group
        return ch

    if kind == "courses":
        course = next((c for c in cat["courses"] if _slug_of(_learn_url(c.get("url") or "")) == slug
                       or (c.get("uid") or "").lower() == f"course.{slug}"), None)
        if not course:
            raise SourceError("Microsoft Learn doesn't list that course.")
        paths = {p["uid"]: p for p in cat["learningPaths"]}
        groups = []
        for sg in course.get("study_guide") or []:
            p = paths.get(sg.get("uid"))
            if not p:
                continue
            chs = [c for c in (module_chapter(u, p["title"]) for u in p.get("modules") or []) if c]
            groups.append({"title": p["title"], "chapters": chs})
        title = course.get("title") or slug
        if course.get("course_number"):
            title = f"{course['course_number']}: {title}"
        return {"title": title, "kind": "learn-course", "url": url, "groups": groups}
    if kind == "paths":
        p = next((p for p in cat["learningPaths"] if _slug_of(_learn_url(p.get("url") or "")) == slug), None)
        if not p:
            raise SourceError("Microsoft Learn doesn't list that learning path.")
        chs = [c for c in (module_chapter(u) for u in p.get("modules") or []) if c]
        return {"title": p["title"], "kind": "learn-path", "url": url,
                "groups": [{"title": "", "chapters": chs}]}
    mm = next((m for m in cat["modules"] if _slug_of(_learn_url(m.get("url") or "")) == slug), None)
    if not mm:
        raise SourceError("Microsoft Learn doesn't list that module.")
    return {"title": mm["title"], "kind": "learn-module", "url": url,
            "groups": [{"title": "", "chapters": [module_chapter(mm["uid"])]}]}


class WebSnapshots:
    """Cleaned copies of web pages, one JSON file per page, per source."""

    def __init__(self, root_fn: Callable[[], str]):
        self._root = root_fn

    def _path(self, source_id: str, url: str) -> str:
        d = os.path.join(self._root(), "sources", "web", source_id)
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, hashlib.sha1(url.encode("utf-8")).hexdigest()[:20] + ".json")

    def page(self, source_id: str, url: str, refresh: bool = False, live: bool = False) -> Dict[str, Any]:
        path = self._path(source_id, url)
        if not refresh and not live and os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        text, final = fetch(url)
        doc = clean_html(text, final)
        snap = {"url": url, "final_url": final, "title": doc["title"], "html": doc["html"],
                "text": doc["text"], "fetched_at": time.time(), "units": _learn_units(text, final)}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snap, f)
        return snap

    def units(self, source_id: str, chapter_url: str, refresh: bool = False) -> List[Dict[str, str]]:
        """A chapter's pages: a Learn module's units, otherwise the chapter page itself."""
        snap = self.page(source_id, chapter_url, refresh=refresh)
        units = snap.get("units") or []
        if units:
            return units
        return [{"title": snap.get("title") or chapter_url, "url": chapter_url}]


def _learn_units(page_html: str, final_url: str) -> List[Dict[str, str]]:
    """Unit links on a Learn module page: relative hrefs one level below the module."""
    if "/training/modules/" not in final_url:
        return []
    base = final_url if final_url.endswith("/") else final_url + "/"
    out, seen = [], set()
    for m in re.finditer(r'<a\b[^>]*href="([^"#?]+)"[^>]*>(.*?)</a>', page_html, re.S | re.I):
        href = m.group(1)
        if "/" in href or href.startswith(("http", "#")) or not re.match(r"^\d+[a-z]?-", href):
            continue
        full = urllib.parse.urljoin(base, href)
        if full in seen:
            continue
        title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if not title:
            continue
        seen.add(full)
        out.append({"title": title, "url": full})
    return out
