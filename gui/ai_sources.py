"""
Bridge commands for AI (draft cards, chat, Settings → AI) and sources
(files and web pages attached to papers and folders).

Mixed into AnkiPapersBridge. Anything that touches the network runs as a
background job (core.ai.JobManager): the command returns {"job": id} at once
and the page polls "ai_poll" until the job is done, so Anki never freezes
while a model answers or a course outline downloads.
"""

import os
import traceback
from typing import Any, Dict, List

from aqt import mw

from ..core import ai as AI
from ..core import sources as SRC
from ..core.paper import Paper
from ..core.storage import (
    _collection_get,
    _collection_set,
    get_ankipapers_dir,
    list_papers,
    load_paper,
    save_paper,
    load_folder_structure,
    save_folder_structure,
)

_ADDON = __name__.split(".")[0]

_FILE_FILTER = "Sources (*.pdf *.docx *.pptx *.html *.htm *.txt *.md);;PDF (*.pdf);;Word (*.docx);;PowerPoint (*.pptx);;All Files (*)"


def _config() -> Dict[str, Any]:
    return mw.addonManager.getConfig(_ADDON) or {}


def _write_config_key(key: str, value: Any) -> None:
    cfg = _config()
    cfg[key] = value
    mw.addonManager.writeConfig(_ADDON, cfg)


JOBS = AI.JobManager()
KEYS = AI.KeyStore(
    fallback_get=lambda: _config().get("ai_keys_local") or {},
    fallback_set=lambda keys: _write_config_key("ai_keys_local", keys),
)
USAGE = AI.UsageLog(lambda: os.path.join(get_ankipapers_dir(), "ai_usage.json"))
REGISTRY = SRC.Registry(_collection_get, _collection_set, get_ankipapers_dir)
CATALOG = SRC.LearnCatalog(lambda: REGISTRY.dir("cache"))
SNAPS = SRC.WebSnapshots(get_ankipapers_dir)


def _ai_settings() -> Dict[str, Any]:
    cfg = _config()
    provider = cfg.get("ai_provider") or "anthropic"
    return {
        **cfg,
        "provider": provider,
        "model": cfg.get(f"ai_model_{provider}") or AI.DEFAULT_MODELS.get(provider, ""),
        "base_url": cfg.get("ai_base_url") or "",
    }


def _err(e: Exception) -> Dict[str, str]:
    if not isinstance(e, (AI.AIError, SRC.SourceError)):
        traceback.print_exc()
    return {"error": str(e)}


class AISourcesMixin:
    """Methods added to AnkiPapersBridge; see _ai_sources_dispatch()."""

    def _ai_sources_dispatch(self) -> Dict[str, Any]:
        return {
            "ai_status": self.ai_status,
            "ai_save_key": self.ai_save_key,
            "ai_delete_key": self.ai_delete_key,
            "ai_test": self.ai_test,
            "ai_draft": self.ai_draft,
            "ai_chat": self.ai_chat,
            "ai_poll": self.ai_poll,
            "ai_cancel": self.ai_cancel,
            "src_for_paper": self.src_for_paper,
            "src_attach_paper_file": self.src_attach_paper_file,
            "src_attach_paper_web": self.src_attach_paper_web,
            "src_detach_paper": self.src_detach_paper,
            "src_pick_file": self.src_pick_file,
            "src_folder_list": self.src_folder_list,
            "src_folder_attach_file": self.src_folder_attach_file,
            "src_folder_attach_book": self.src_folder_attach_book,
            "src_folder_attach_web": self.src_folder_attach_web,
            "src_folder_detach": self.src_folder_detach,
            "src_web_inspect": self.src_web_inspect,
            "src_match": self.src_match,
            "src_set_chapter_paper": self.src_set_chapter_paper,
            "src_create_chapter_paper": self.src_create_chapter_paper,
            "src_folders_summary": self.src_folders_summary,
            "src_group_folders": self.src_group_folders,
            "src_set_group_folder": self.src_set_group_folder,
            "src_subfolders": self.src_subfolders,
            "src_file_url": self.src_file_url,
            "src_path_url": self.src_path_url,
            "src_pages": self.src_pages,
            "src_web_units": self.src_web_units,
            "src_web_page": self.src_web_page,
        }

    # ─── Settings → AI ───────────────────────────────

    def ai_status(self, args):
        try:
            s = _ai_settings()
            keys = {}
            for p in AI.PROVIDERS:
                k = KEYS.get(p)
                keys[p] = {"saved": bool(k), "hint": AI.KeyStore.hint(k)}
            return {
                "provider": s["provider"], "model": s["model"], "base_url": s["base_url"],
                "keys": keys, "key_store": KEYS.where(), "usage": USAGE.this_month(),
                "default_rules": AI.DEFAULT_CARD_RULES,
                "ready": bool(s["model"]) and (keys[s["provider"]]["saved"] or s["provider"] == "openai"),
            }
        except Exception as e:
            return _err(e)

    def ai_save_key(self, args):
        try:
            provider = args.get("provider") or ""
            if provider not in AI.PROVIDERS:
                return {"error": "Unknown provider"}
            KEYS.set(provider, args.get("key") or "")
            return {"ok": True, "hint": AI.KeyStore.hint(KEYS.get(provider)), "where": KEYS.where()}
        except Exception as e:
            return _err(e)

    def ai_delete_key(self, args):
        try:
            KEYS.delete(args.get("provider") or "")
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def ai_test(self, args):
        """Check a key (the one typed, or the saved one) by listing the provider's models."""
        provider = args.get("provider") or "anthropic"
        key = (args.get("key") or "").strip() or KEYS.get(provider)
        base_url = args.get("base_url") or ""

        def work(_delta, _canceled):
            if provider != "openai" and not key:
                raise AI.AIError("Paste a key first.")
            return {"models": AI.list_models(provider, key, base_url)}

        return {"job": JOBS.start(work)}

    def ai_poll(self, args):
        return JOBS.poll(args.get("job") or "")

    def ai_cancel(self, args):
        JOBS.cancel(args.get("job") or "")
        return {"ok": True}

    # ─── Draft cards / chat ──────────────────────────

    def ai_draft(self, args):
        s = _ai_settings()
        provider, model = s["provider"], s["model"]
        key = KEYS.get(provider)
        system = AI.draft_system_prompt(s)
        user = AI.draft_user_prompt(
            args.get("text") or "", args.get("heading_path") or [],
            args.get("existing") or [], args.get("redo_of") or "",
        )

        def work(delta, canceled):
            text, usage = AI.complete(provider, key, model, system, [{"role": "user", "content": user}],
                                      base_url=s["base_url"], on_delta=delta, canceled=canceled,
                                      temperature=0.2)
            USAGE.add("drafts", usage)
            cards = AI.parse_cards(text, s)
            if not cards and text.strip() and '"cards"' not in text:
                raise AI.AIError("The model's reply didn't contain any cards in the expected format.")
            return {"cards": cards, "model": model}

        return {"job": JOBS.start(work), "model": model}

    def ai_chat(self, args):
        s = _ai_settings()
        provider, model = s["provider"], s["model"]
        key = KEYS.get(provider)
        system = AI.chat_system_prompt(s, args.get("context") or [], bool(args.get("stick", True)))
        messages = [m for m in (args.get("messages") or [])
                    if m.get("role") in ("user", "assistant") and (m.get("content") or "").strip()]

        def work(delta, canceled):
            text, usage = AI.complete(provider, key, model, system, messages, base_url=s["base_url"],
                                      on_delta=delta, canceled=canceled, temperature=0.3)
            USAGE.add("chats", usage)
            return {"text": text, "model": model}

        return {"job": JOBS.start(work), "model": model}

    # ─── Sources: a paper's own ──────────────────────

    def src_for_paper(self, args):
        try:
            paper_id = args.get("paper_id") or ""
            paper = load_paper(paper_id)
            folder = (paper.folder_path if paper else args.get("folder_path")) or ""
            out = REGISTRY.for_paper(paper_id, folder)
            titles = {p.id: p.title for p in list_papers()}
            for s in out:
                ch = s.get("chapter")
                if ch:
                    nb = REGISTRY.chapter_neighbors(s["folder"], s["source"]["id"], ch["key"])
                    for side in ("prev", "next"):
                        c = nb.get(side)
                        if c:
                            c["paper_title"] = titles.get(c.get("paper_id"))
                    s["neighbors"] = nb
                if s["scope"] == "folder" and not ch:
                    entry = next((e for e in REGISTRY.for_folder(s["folder"])
                                  if e["source_id"] == s["source"]["id"]), {})
                    s["chapters"] = [{**c, "paper_title": titles.get(c.get("paper_id"))}
                                     for c in entry.get("chapters", []) if not c.get("skip")]
            return {"sources": out}
        except Exception as e:
            return _err(e)

    def _pick(self, caption):
        from .bridge import _ask_open_file
        path, _ = _ask_open_file(None, caption, "", _FILE_FILTER)
        return (path or "").replace("\\", "/")

    def src_attach_paper_file(self, args):
        try:
            path = args.get("path") or self._pick("Attach a file to this paper")
            if not path:
                return {"canceled": True}
            item = REGISTRY.add_file(path)
            REGISTRY.attach_to_paper(args.get("paper_id") or "", item["id"])
            return {"ok": True, "source": REGISTRY._public(item)}
        except Exception as e:
            return _err(e)

    def src_attach_paper_web(self, args):
        paper_id = args.get("paper_id") or ""
        try:
            url = SRC.normalize_url(args.get("url") or "")
        except SRC.SourceError as e:
            return {"error": str(e)}

        def work(_d, _c):
            item = REGISTRY.add_web(url, url)
            snap = SNAPS.page(item["id"], url)
            if snap.get("title"):
                data = REGISTRY.load()
                data["items"][item["id"]]["title"] = snap["title"]
                REGISTRY.save(data)
                item["title"] = snap["title"]
            REGISTRY.attach_to_paper(paper_id, item["id"])
            return {"source": REGISTRY._public(item)}

        return {"job": JOBS.start(work)}

    def src_detach_paper(self, args):
        try:
            REGISTRY.detach_from_paper(args.get("paper_id") or "", args.get("source_id") or "")
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def src_pick_file(self, args):
        try:
            path = self._pick(args.get("caption") or "Choose a file")
            if not path:
                return {"canceled": True}
            out = {"path": path, "name": os.path.basename(path)}
            if path.lower().endswith(".pdf"):
                out["url"] = self._pdf_server().register(path)
            return out
        except Exception as e:
            return _err(e)

    # ─── Sources: folders ────────────────────────────

    def src_folder_list(self, args):
        try:
            return {"sources": REGISTRY.for_folder(args.get("folder") or "")}
        except Exception as e:
            return _err(e)

    def src_folder_attach_file(self, args):
        try:
            path = args.get("path") or self._pick("Attach a file to this folder")
            if not path:
                return {"canceled": True}
            item = REGISTRY.add_file(path)
            REGISTRY.attach_to_folder(args.get("folder") or "", item["id"], [], {})
            return {"ok": True, "source": REGISTRY._public(item)}
        except Exception as e:
            return _err(e)

    def _apply_chapters(self, folder: str, source_id: str, chapters: List[Dict[str, Any]],
                        unmatched: str, group_folders: Dict[str, str] = None,
                        layout: str = "flat") -> Dict[str, Any]:
        """Create the sub-folders and papers the dialog asked for, then store the chapter map.

        group_folders: learning path -> where its papers live. A folder path
        (an existing sub-folder), "" (the folder itself: the path is only a
        heading), or "new:<name>" (make that sub-folder). Paths not listed are
        matched automatically (see core.sources.group_folder_map).
        """
        created, moved = 0, 0
        group_folders = dict(group_folders or {})
        if layout == "subfolders" and not group_folders:  # older callers
            for c in chapters:
                g = (c.get("group") or "").strip()
                if g:
                    group_folders.setdefault(g, "new:" + g)
        pinned, new_paths = {}, set()
        if any(str(v).startswith("new:") for v in group_folders.values()):
            tree = load_folder_structure()
            parent = _find_folder(tree, folder)
            for g, v in group_folders.items():
                if not str(v).startswith("new:"):
                    continue
                name = v[4:].replace("/", "-").strip()[:120] or g[:120]
                path = f"{folder}/{name}"
                if not _find_folder(tree, path):
                    (parent or tree).setdefault("children", []).append(
                        {"type": "folder", "name": name, "path": path, "children": []})
                    new_paths.add(path)
                group_folders[g] = path
            save_folder_structure(tree)
        for g, v in group_folders.items():
            pinned[g] = v
        auto = SRC.group_folder_map(folder, {"chapters": chapters, "group_folders": pinned}, _ctx())
        for c in chapters:
            if c.get("skip"):
                continue
            target = auto.get((c.get("group") or "").strip()) or folder
            pid = c.get("paper_id")
            if pid:
                # Only into a sub-folder made just now, and only from the folder
                # itself: papers you've already filed somewhere stay put.
                p = load_paper(pid)
                if p and target in new_paths and (p.folder_path or "") == folder:
                    p.folder_path = target
                    save_paper(p)
                    moved += 1
            elif c.get("create") or unmatched == "create":
                p = Paper(title=c.get("title") or "Untitled", folder_path=target)
                p.content = f"# {p.title}\n\n"
                p.deck_name = _config().get("default_deck") or "Default"
                save_paper(p)
                c["paper_id"] = p.id
                created += 1
        REGISTRY.attach_to_folder(folder, source_id, chapters, {"unmatched": unmatched, "group_folders": pinned})
        return {"created": created, "moved": moved}

    def src_folder_attach_book(self, args):
        try:
            folder = args.get("folder") or ""
            item = REGISTRY.add_file(args.get("path") or "", title=args.get("title") or "")
            if item["kind"] != "pdf":
                return {"error": "A book has to be a PDF."}
            stats = self._apply_chapters(folder, item["id"], args.get("chapters") or [],
                                         args.get("unmatched") or "link")
            data = REGISTRY.load()
            for e in data["folders"].get(folder, []):
                if e["source_id"] == item["id"]:
                    e["page_offset"] = int(args.get("page_offset") or 0)
            REGISTRY.save(data)
            return {"ok": True, "source": REGISTRY._public(item), **stats}
        except Exception as e:
            return _err(e)

    def src_folder_attach_web(self, args):
        try:
            folder = args.get("folder") or ""
            url = SRC.normalize_url(args.get("url") or "")
            item = REGISTRY.add_web(url, args.get("title") or url, {"kind": args.get("kind")},
                                    keep=args.get("keep") or "snapshot")
            stats = self._apply_chapters(folder, item["id"], args.get("chapters") or [],
                                         args.get("unmatched") or "link", args.get("group_folders") or {},
                                         args.get("layout") or "flat")
            return {"ok": True, "source": REGISTRY._public(item), **stats}
        except Exception as e:
            return _err(e)

    def src_folder_detach(self, args):
        try:
            REGISTRY.detach_from_folder(args.get("folder") or "", args.get("source_id") or "")
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def src_web_inspect(self, args):
        raw = args.get("url") or ""

        def work(_d, _c):
            return SRC.inspect_web(raw, CATALOG)

        return {"job": JOBS.start(work)}

    def src_match(self, args):
        """Suggest which paper (anywhere under the folder) covers each chapter."""
        try:
            folder = args.get("folder") or ""
            papers = [{"id": p.id, "title": p.title} for p in list_papers()
                      if p.folder_path == folder or (p.folder_path or "").startswith(folder + "/")]
            return {"matches": SRC.match_chapters(args.get("chapters") or [], papers), "papers": papers}
        except Exception as e:
            return _err(e)

    def src_set_chapter_paper(self, args):
        try:
            REGISTRY.set_chapter_paper(args.get("folder") or "", args.get("source_id") or "",
                                       args.get("key") or "", args.get("paper_id") or None)
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def src_create_chapter_paper(self, args):
        try:
            folder = args.get("folder") or ""
            sid, key = args.get("source_id") or "", args.get("key") or ""
            entry = next((e for e in REGISTRY.for_folder(folder) if e["source_id"] == sid), None)
            ch = next((c for c in (entry or {}).get("chapters", []) if c.get("key") == key), None)
            if not ch:
                return {"error": "Chapter not found"}
            # Into the learning path's sub-folder when it has one.
            target = REGISTRY.group_folders(folder, sid, _ctx()).get(ch.get("group") or "") or folder
            p = Paper(title=args.get("title") or ch.get("title") or "Untitled", folder_path=target)
            p.content = f"# {p.title}\n\n"
            p.deck_name = _config().get("default_deck") or "Default"
            save_paper(p)
            REGISTRY.set_chapter_paper(folder, sid, key, p.id)
            return p.to_dict()
        except Exception as e:
            return _err(e)

    def src_group_folders(self, args):
        """Learning path -> sub-folder, as currently matched, for a folder's source."""
        try:
            ctx = _ctx()
            folder, sid = args.get("folder") or "", args.get("source_id") or ""
            entry = next((e for e in REGISTRY.for_folder(folder) if e["source_id"] == sid), {})
            groups = []
            for c in entry.get("chapters", []):
                g = c.get("group") or ""
                if g and g not in groups:
                    groups.append(g)
            return {"groups": groups, "map": REGISTRY.group_folders(folder, sid, ctx),
                    "pinned": entry.get("group_folders") or {}, "subfolders": _subfolders(folder, ctx)}
        except Exception as e:
            return _err(e)

    def src_set_group_folder(self, args):
        try:
            target = args.get("target")
            REGISTRY.set_group_folder(args.get("folder") or "", args.get("source_id") or "",
                                      args.get("group") or "", target if target != "auto" else None)
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def src_subfolders(self, args):
        """Direct sub-folders of a folder, and the best learning-path match for each group given."""
        try:
            folder = args.get("folder") or ""
            ctx = _ctx()
            chapters = args.get("chapters") or []
            return {"subfolders": _subfolders(folder, ctx),
                    "map": SRC.group_folder_map(folder, {"chapters": chapters}, ctx)}
        except Exception as e:
            return _err(e)

    def src_folders_summary(self, args):
        try:
            return REGISTRY.folders_summary(_ctx())
        except Exception as e:
            return _err(e)

    # ─── Viewing ─────────────────────────────────────

    def src_file_url(self, args):
        try:
            item = REGISTRY.get(args.get("source_id") or "")
            if not item:
                return {"error": "Source not found"}
            path = REGISTRY.file_path(item)
            if not os.path.isfile(path):
                return {"error": "This file isn't on this computer. Attach it again here to read it."}
            return {"url": self._pdf_server().register(path)}
        except Exception as e:
            return _err(e)

    def src_path_url(self, args):
        """A viewer URL for a PDF that isn't attached yet (the book dialog's preview)."""
        try:
            path = args.get("path") or ""
            if not path.lower().endswith(".pdf") or not os.path.isfile(path):
                return {"error": "PDF not found"}
            return {"url": self._pdf_server().register(path)}
        except Exception as e:
            return _err(e)

    def src_pages(self, args):
        try:
            item = REGISTRY.get(args.get("source_id") or "")
            if not item:
                return {"error": "Source not found"}
            path = REGISTRY.file_path(item)
            if not os.path.isfile(path):
                return {"error": "This file isn't on this computer. Attach it again here to read it."}
            return {"pages": SRC.file_pages(item, path)}
        except Exception as e:
            return _err(e)

    def src_web_units(self, args):
        sid, url, refresh = args.get("source_id") or "", args.get("url") or "", bool(args.get("refresh"))

        def work(_d, _c):
            return {"units": SNAPS.units(sid, url, refresh=refresh)}

        return {"job": JOBS.start(work)}

    def src_web_page(self, args):
        sid, url, refresh = args.get("source_id") or "", args.get("url") or "", bool(args.get("refresh"))
        item = REGISTRY.get(sid) or {}

        def work(_d, _c):
            snap = SNAPS.page(sid, url, refresh=refresh, live=item.get("keep") == "live")
            return {k: snap.get(k) for k in ("url", "title", "html", "text", "fetched_at")}

        return {"job": JOBS.start(work)}

    # ─── Keeping the registry in step with papers and folders ─

    def _sources_after_paper_created(self, paper) -> None:
        try:
            REGISTRY.link_new_paper(paper.id, paper.title, paper.folder_path or "", _ctx())
        except Exception:
            traceback.print_exc()

    def _sources_after_paper_deleted(self, paper_id: str) -> None:
        try:
            REGISTRY.forget_paper(paper_id)
        except Exception:
            traceback.print_exc()

    def _sources_after_folder_moved(self, old: str, new: str) -> None:
        try:
            REGISTRY.rename_folder(old, new)
        except Exception:
            traceback.print_exc()

    def _sources_after_folder_deleted(self, path: str) -> None:
        try:
            REGISTRY.delete_folder(path)
        except Exception:
            traceback.print_exc()


def _all_folder_paths(node: Dict[str, Any], out: List[str] = None) -> List[str]:
    out = [] if out is None else out
    for c in node.get("children", []) or []:
        if c.get("type") == "folder":
            out.append(c.get("path"))
            _all_folder_paths(c, out)
    return out


def _ctx() -> Dict[str, Any]:
    """What the registry needs to place learning paths in sub-folders."""
    return {"folders": _all_folder_paths(load_folder_structure()),
            "paper_folders": {p.id: p.folder_path or "" for p in list_papers()}}


def _subfolders(folder: str, ctx: Dict[str, Any]) -> List[str]:
    return [f for f in ctx["folders"] if f.startswith(folder + "/") and "/" not in f[len(folder) + 1:]]


def _find_folder(node: Dict[str, Any], path: str):
    for c in node.get("children", []) or []:
        if c.get("type") == "folder" and c.get("path") == path:
            return c
        if c.get("type") == "folder":
            hit = _find_folder(c, path)
            if hit:
                return hit
    return None
