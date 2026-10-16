"""
Sharing a paper, or a whole folder of them, with the pictures they show.

A share is a .zip:

    manifest.json          what is inside (see build_share)
    papers/<folder>/<title>.md
    media/<picture name>   every media-folder picture the papers use

A paper on its own only stores each picture's name; the files live in the
sender's Anki media folder. Carrying them in the zip, and putting them in the
receiver's media folder on import, is what makes the pictures survive the
trip. The zip holds the papers' text exactly as stored (➵ and all), because
it is meant to be opened by Anki Papers; Markdown export is for everywhere else.

Nothing here touches Anki or the paper store: the bridge (gui/bridge.py)
gathers the papers, asks where to save, writes the media and saves papers.
"""

import json
import os
import re
import time
import zipfile
from typing import Any, Dict, List, Optional, Tuple

from .media_refs import all_media_names, find_media_file, rename_media

FORMAT = "ankipapers-share"
VERSION = 1

_AP_LINK = re.compile(r"\(ap://([^)#\s]+)")


def _safe(name: str, fallback: str = "Untitled") -> str:
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", name or "").strip().strip(".")
    return s[:120] or fallback


def build_share(out_path: str, papers: List[Dict[str, Any]], media_dir: str,
                kind: str = "paper", root_folder: str = "") -> Dict[str, Any]:
    """Write a share zip. `papers` are paper dicts (id, title, content,
    deck_name, tags, folder_path); for a folder share, folder_path is taken
    relative to `root_folder`'s parent so the folder arrives whole.

    Returns {papers, pictures, missing: [names not found in media_dir]}.
    """
    root_parent = root_folder.rsplit("/", 1)[0] if "/" in root_folder else ""
    entries, used_paths = [], set()
    for p in papers:
        folder = p.get("folder_path") or ""
        if kind == "folder":
            rel = folder[len(root_parent) + 1:] if root_parent and folder.startswith(root_parent + "/") else folder
        else:
            rel = ""
        base = "/".join(_safe(seg) for seg in rel.split("/") if seg)
        stem = _safe(p.get("title") or "Untitled")
        path = f"papers/{base + '/' if base else ''}{stem}.md"
        k = 2
        while path in used_paths:
            path = f"papers/{base + '/' if base else ''}{stem} ({k}).md"
            k += 1
        used_paths.add(path)
        entries.append({
            "id": p.get("id"),
            "title": p.get("title") or "Untitled",
            "folder": rel,
            "deck_name": p.get("deck_name") or "Default",
            "tags": list(p.get("tags") or []),
            "file": path,
        })

    names = all_media_names(p.get("content") or "" for p in papers)
    found, missing = [], []
    for n in names:
        (found if find_media_file(media_dir, n) else missing).append(n)

    manifest = {
        "format": FORMAT,
        "version": VERSION,
        "kind": kind,
        "root_folder": root_folder.rsplit("/", 1)[-1] if root_folder else "",
        "created_at": int(time.time()),
        "papers": entries,
        "media": found,
        "missing": missing,
    }
    tmp = out_path + ".part"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for p, e in zip(papers, entries):
            z.writestr(e["file"], p.get("content") or "")
        for n in found:
            # Pictures are already compressed; storing them is faster and no bigger.
            z.write(find_media_file(media_dir, n), f"media/{n}", compress_type=zipfile.ZIP_STORED)
    os.replace(tmp, out_path)
    return {"papers": len(entries), "pictures": len(found), "missing": missing}


def is_share(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as z:
            m = json.loads(z.read("manifest.json").decode("utf-8"))
        return m.get("format") == FORMAT
    except Exception:
        return False


def read_share(path: str) -> Tuple[Dict[str, Any], Dict[str, str], Dict[str, bytes]]:
    """(manifest, {paper file: content}, {picture name: bytes}).

    Only what the manifest lists is read, and a picture name must be a bare
    file name, so a crafted zip cannot write outside the media folder.
    """
    with zipfile.ZipFile(path) as z:
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
        if manifest.get("format") != FORMAT:
            raise ValueError("This .zip is not an Anki Papers share.")
        if int(manifest.get("version") or 0) > VERSION:
            raise ValueError("This share was made by a newer Anki Papers. Update the add-on to open it.")
        members = set(z.namelist())
        texts = {}
        for e in manifest.get("papers") or []:
            f = e.get("file") or ""
            if f in members:
                texts[f] = z.read(f).decode("utf-8")
        media = {}
        for n in manifest.get("media") or []:
            if not n or "/" in n or "\\" in n or n in (".", ".."):
                continue
            member = f"media/{n}"
            if member in members:
                media[n] = z.read(member)
    return manifest, texts, media


def plan_import(manifest: Dict[str, Any], texts: Dict[str, str], existing_ids: set,
                renamed_media: Dict[str, str]) -> List[Dict[str, Any]]:
    """The papers to create: content with pictures renamed where the media
    folder had to, and ids kept when free so links between the shared papers
    still work (an id already in use gets a new one, and links follow it).
    """
    import uuid

    id_map = {}
    for e in manifest.get("papers") or []:
        old = e.get("id") or ""
        id_map[old] = old if old and old not in existing_ids else str(uuid.uuid4())

    def relink(text):
        return _AP_LINK.sub(lambda m: f"(ap://{id_map.get(m.group(1), m.group(1))}", text)

    out = []
    for e in manifest.get("papers") or []:
        content = texts.get(e.get("file") or "")
        if content is None:
            continue
        content = relink(rename_media(content, renamed_media))
        out.append({
            "id": id_map.get(e.get("id") or "") or str(uuid.uuid4()),
            "title": e.get("title") or "Untitled",
            "folder": e.get("folder") or "",
            "deck_name": e.get("deck_name") or "Default",
            "tags": list(e.get("tags") or []),
            "content": content,
        })
    return out
