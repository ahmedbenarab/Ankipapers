"""
Storage module for Anki Papers.

Handles saving and loading papers to/from JSON files on disk.
Papers are stored OUTSIDE the add-on folder to survive updates.

Following the Review Heatmap / Pomodium pattern:
- Data lives in the Anki profile folder, NOT the add-on folder.
- When Anki updates the add-on, it replaces the add-on folder only.
- The profile folder is never touched by updates.
"""

import os
import json
import re
from typing import List, Dict, Optional, Any

from .paper import Paper, CardReference

COLLECTION_PAPERS_KEY = "ankipapers.papers.v1"
COLLECTION_FOLDERS_KEY = "ankipapers.folders.v1"
COLLECTION_SOURCE_LINKS_KEY = "ankipapers.source_links.v1"
COLLECTION_MIGRATION_KEY = "ankipapers.migrated_to_collection.v1"

_BLOCK_ID_SUFFIX_RE = re.compile(
    r"\s*<!--ap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-->\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _strip_block_ids(content: str) -> str:
    """Preserve block ids; kept for backward compatibility call sites."""
    return content


def _get_profile_dir() -> str:
    """Get the Anki profile directory (survives add-on updates)."""
    try:
        from aqt import mw
        if mw and mw.pm and mw.pm.profileFolder():
            return mw.pm.profileFolder()
    except Exception:
        pass
    # Fallback: use the add-on's user_files dir
    addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(addon_dir, "user_files")


def get_storage_dir() -> str:
    """Get the storage directory for papers (profile-level, update-safe)."""
    profile_dir = _get_profile_dir()
    storage_dir = os.path.join(profile_dir, "ankipapers", "papers")
    os.makedirs(storage_dir, exist_ok=True)
    return storage_dir


def get_ankipapers_dir() -> str:
    """Get the root ankipapers directory within the profile."""
    profile_dir = _get_profile_dir()
    ap_dir = os.path.join(profile_dir, "ankipapers")
    os.makedirs(ap_dir, exist_ok=True)
    return ap_dir


def get_folders_file() -> str:
    """Get the path to the folders structure file."""
    return os.path.join(get_ankipapers_dir(), "folders.json")


def _migrate_legacy_data_to_profile():
    """Migrate data from the old add-on folder location to the profile folder."""
    addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    old_storage = os.path.join(addon_dir, "user_files", "papers")
    old_folders = os.path.join(addon_dir, "user_files", "folders.json")

    new_storage = get_storage_dir()
    new_folders = get_folders_file()

    # Migrate papers
    if os.path.exists(old_storage):
        for filename in os.listdir(old_storage):
            if filename.endswith(".json"):
                old_path = os.path.join(old_storage, filename)
                new_path = os.path.join(new_storage, filename)
                if not os.path.exists(new_path):
                    import shutil
                    shutil.copy2(old_path, new_path)
                    print(f"[Anki Papers] Migrated paper: {filename}")

    # Migrate folders
    if os.path.exists(old_folders) and not os.path.exists(new_folders):
        import shutil
        shutil.copy2(old_folders, new_folders)
        print("[Anki Papers] Migrated folder structure")


def _get_collection():
    try:
        from aqt import mw
        if mw and mw.col:
            return mw.col
    except Exception:
        pass
    return None


class StorageError(Exception):
    """Raised when a paper could not be persisted, so callers can report it
    instead of silently continuing as if the save had succeeded."""


def _collection_get(key: str, default: Any) -> Any:
    col = _get_collection()
    if not col:
        return default
    try:
        value = col.get_config(key)
        return default if value is None else value
    except Exception:
        return default


def _collection_set(key: str, value: Any) -> bool:
    col = _get_collection()
    if not col:
        return False
    try:
        col.set_config(key, value)
        return True
    except Exception:
        return False


def _collection_get_strict(col, key: str) -> Any:
    """Read a config value, letting failures raise.

    The lenient _collection_get() above returns its default when a read fails.
    That is fine for optional values, but dangerous for the papers map: a
    failed read would look like "no papers yet", and the caller would then
    write back a map containing only the paper being saved — destroying every
    other paper. Reads that feed a read-modify-write must use this instead.
    """
    try:
        value = col.get_config(key)
    except Exception as exc:
        raise StorageError(f"could not read {key} from the collection: {exc}") from exc
    return value


def _load_all_disk_papers() -> Dict[str, Dict[str, Any]]:
    storage_dir = get_storage_dir()
    out: Dict[str, Dict[str, Any]] = {}
    if not os.path.exists(storage_dir):
        return out
    for filename in os.listdir(storage_dir):
        if not filename.endswith(".json"):
            continue
        file_path = os.path.join(storage_dir, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            paper_id = str(data.get("id") or filename[:-5]).strip()
            if paper_id:
                out[paper_id] = data
        except Exception:
            continue
    return out


def _load_disk_folders() -> Dict[str, Any]:
    file_path = get_folders_file()
    if not os.path.exists(file_path):
        return {"name": "Root", "children": [], "expanded": True}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"name": "Root", "children": [], "expanded": True}


def _migrate_to_collection_if_needed() -> None:
    col = _get_collection()
    if not col:
        return
    already_done = bool(_collection_get(COLLECTION_MIGRATION_KEY, False))
    if already_done:
        return

    # If collection already has data, keep it and just mark migration done.
    existing_papers = _collection_get(COLLECTION_PAPERS_KEY, None)
    existing_folders = _collection_get(COLLECTION_FOLDERS_KEY, None)
    if existing_papers is not None or existing_folders is not None:
        _collection_set(COLLECTION_MIGRATION_KEY, True)
        return

    disk_papers = _load_all_disk_papers()
    disk_folders = _load_disk_folders()

    _collection_set(COLLECTION_PAPERS_KEY, disk_papers)
    _collection_set(COLLECTION_FOLDERS_KEY, disk_folders)
    _collection_set(COLLECTION_MIGRATION_KEY, True)
    if disk_papers:
        print(f"[Anki Papers] Migrated {len(disk_papers)} papers to synced collection storage")


# Run migrations on import
try:
    _migrate_legacy_data_to_profile()
    _migrate_to_collection_if_needed()
except Exception as e:
    print(f"[Anki Papers] Migration skipped: {e}")


def save_paper(paper: Paper) -> str:
    """Save a paper. Returns a storage identifier/path.

    Raises StorageError if the collection is available but the paper could not
    be written to it. Previously such a failure silently diverted the paper to
    a disk file — but load_paper()/list_papers() read the collection FIRST and
    only look at disk when the collection has no entry for that id, so those
    "saves" were written somewhere they would never be read back, and the user
    was told the save had succeeded. Failing loudly is what lets the UI say so.
    """
    _migrate_to_collection_if_needed()

    paper.content = _strip_block_ids(paper.content)
    data = paper.to_dict()

    col = _get_collection()
    if col is not None:
        # Strict read: a failed read must not look like "no papers yet", or the
        # write below would replace every other paper with just this one.
        papers_map = _collection_get_strict(col, COLLECTION_PAPERS_KEY)
        if papers_map is None:
            papers_map = {}
        if not isinstance(papers_map, dict):
            raise StorageError(
                f"stored papers are not a dictionary (got {type(papers_map).__name__}); "
                "refusing to overwrite them"
            )
        papers_map[paper.id] = data
        try:
            col.set_config(COLLECTION_PAPERS_KEY, papers_map)
        except Exception as exc:
            raise StorageError(f"could not write to the Anki collection: {exc}") from exc
        # Mirror a copy to disk. The collection above remains the source of
        # truth; this writes files nothing reads yet, so a failure here must
        # never turn a successful save into a failed one.
        mirror_paper_to_disk_quietly(paper)
        return f"collection://{paper.id}"

    # No collection at all (e.g. Anki still starting) — fall back to disk.
    storage_dir = get_storage_dir()
    file_path = os.path.join(storage_dir, f"{paper.id}.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return file_path


def load_paper(paper_id: str) -> Optional[Paper]:
    """Load a paper by its ID, from disk when it is there."""
    _migrate_to_collection_if_needed()

    try:
        root = get_storage_dir()
        md_path = index_papers_on_disk(root).get((paper_id or "").lower())
        if md_path:
            paper = _read_paper_from_files(md_path, root)
            if paper is not None:
                return paper
    except Exception:
        pass   # fall through to the collection copy

    papers_map = _collection_get(COLLECTION_PAPERS_KEY, {})
    if isinstance(papers_map, dict):
        data = papers_map.get(paper_id)
        if isinstance(data, dict):
            try:
                paper = Paper.from_dict(data)
                paper.content = _strip_block_ids(paper.content)
                return paper
            except Exception as e:
                print(f"[Anki Papers] Error loading paper {paper_id}: {e}")

    # Fallback to disk if collection is unavailable
    storage_dir = get_storage_dir()
    file_path = os.path.join(storage_dir, f"{paper_id}.json")

    if not os.path.exists(file_path):
        return None

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        paper = Paper.from_dict(data)
        paper.content = _strip_block_ids(paper.content)
        return paper
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[Anki Papers] Error loading paper {paper_id}: {e}")
        return None


def delete_paper(paper_id: str) -> bool:
    """Delete a paper."""
    _migrate_to_collection_if_needed()
    # Move the files aside first. Deleting in the app must not leave a file
    # behind that would reappear the next time the library is read from disk.
    park_paper_files(paper_id)

    papers_map = _collection_get(COLLECTION_PAPERS_KEY, {})
    if isinstance(papers_map, dict) and paper_id in papers_map:
        papers_map.pop(paper_id, None)
        if _collection_set(COLLECTION_PAPERS_KEY, papers_map):
            return True

    # Fallback to disk
    storage_dir = get_storage_dir()
    file_path = os.path.join(storage_dir, f"{paper_id}.json")

    if os.path.exists(file_path):
        os.remove(file_path)
        return True
    return False


def list_papers() -> List[Paper]:
    """List all saved papers.

    Phase 2: the files on disk are what the app reads. The collection copy is
    still written on every save and is used whenever disk has nothing to offer
    — so an install that has never pressed "Write files" is unaffected, and a
    single unreadable file costs only that paper, not the library.
    """
    _migrate_to_collection_if_needed()
    papers = []

    from_disk = _papers_from_disk()
    if from_disk:
        # Any paper the collection knows about but disk does not (an unreadable
        # or not-yet-mirrored file) is filled in from the collection.
        fallback = _collection_get(COLLECTION_PAPERS_KEY, {})
        if isinstance(fallback, dict):
            for pid, data in fallback.items():
                if pid in from_disk or not isinstance(data, dict):
                    continue
                try:
                    from_disk[pid] = Paper.from_dict(data)
                except Exception:
                    continue
        return list(from_disk.values())

    papers_map = _collection_get(COLLECTION_PAPERS_KEY, {})
    if isinstance(papers_map, dict):
        for data in papers_map.values():
            if not isinstance(data, dict):
                continue
            try:
                paper = Paper.from_dict(data)
                paper.content = _strip_block_ids(paper.content)
                papers.append(paper)
            except Exception:
                continue
    else:
        storage_dir = get_storage_dir()
        if not os.path.exists(storage_dir):
            return papers
        for filename in os.listdir(storage_dir):
            if filename.endswith(".json"):
                paper_id = filename[:-5]  # Remove .json
                paper = load_paper(paper_id)
                if paper:
                    papers.append(paper)

    # Sort by modification time, newest first
    papers.sort(key=lambda p: p.modified_at, reverse=True)
    return papers


def save_folder_structure(folders: Dict[str, Any]):
    """Save the folder tree structure, and give each folder a directory.

    Only ever creates directories. Removing one is done explicitly by
    delete_folder_structure(), and only when it is empty — so a folder
    operation can never take a document with it.
    """
    _migrate_to_collection_if_needed()
    try:
        materialize_folder_dirs(folders)
    except Exception:
        pass
    if _collection_set(COLLECTION_FOLDERS_KEY, folders):
        return
    # Fallback to disk
    file_path = get_folders_file()
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(folders, f, indent=2, ensure_ascii=False)


def load_folder_structure() -> Dict[str, Any]:
    """Load the folder tree structure.

    Phase 3: what the sidebar shows is the shape of the papers/ directory. The
    stored tree is materialized as directories first, so a folder that only
    ever existed in the collection — an empty one, say — cannot disappear when
    the display switches to disk.
    """
    _migrate_to_collection_if_needed()
    folders = _collection_get(COLLECTION_FOLDERS_KEY, None)

    if papers_are_on_disk():
        try:
            if isinstance(folders, dict):
                materialize_folder_dirs(folders)
            return folder_tree_from_disk()
        except Exception:
            pass   # fall back to the stored tree

    if isinstance(folders, dict):
        return folders
    # Fallback to disk
    file_path = get_folders_file()

    if not os.path.exists(file_path):
        return {"name": "Root", "children": [], "expanded": True}

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, KeyError):
        return {"name": "Root", "children": [], "expanded": True}


def _folder_parent_path(path: str) -> str:
    if not path or "/" not in path:
        return ""
    return path.rsplit("/", 1)[0]


def _find_folder_node(root: Dict[str, Any], path: str) -> Optional[Dict[str, Any]]:
    for c in root.get("children", []):
        if not isinstance(c, dict):
            continue
        if c.get("type") == "folder" and c.get("path") == path:
            return c
        if c.get("type") == "folder":
            found = _find_folder_node(c, path)
            if found is not None:
                return found
    return None


def _children_list_for_parent(root: Dict[str, Any], parent_path: str) -> Optional[List[Any]]:
    if not parent_path:
        return root.setdefault("children", [])
    node = _find_folder_node(root, parent_path)
    if node is None:
        return None
    return node.setdefault("children", [])


def _rewrite_paper_folder_path(fp: str, old_prefix: str, new_prefix: str) -> str:
    if fp == old_prefix:
        return new_prefix
    if fp.startswith(old_prefix + "/"):
        return new_prefix + fp[len(old_prefix) :]
    return fp


def _path_after_cascade_folder_delete(fp: str, deleted: str, parent: str) -> str:
    """Move papers that lived in deleted folder or any descendant into parent."""
    if fp == deleted or fp.startswith(deleted + "/"):
        return parent
    return fp


def _folder_segment_depth(path: str) -> int:
    return len(path.split("/")) if path else 0


def _collect_subtree_folder_paths(node: Dict[str, Any]) -> List[str]:
    out = [node.get("path", "")]
    for c in node.get("children", []):
        if isinstance(c, dict) and c.get("type") == "folder":
            out.extend(_collect_subtree_folder_paths(c))
    return out


def move_folder_structure(
    folder_path: str, new_parent_path: str, max_depth: int = 10
) -> Optional[str]:
    """
    Move a folder under new_parent_path (empty string = root).
    Updates subtree paths and all paper folder_path values.
    Returns None on success, or an error message.
    """
    folder_path = (folder_path or "").strip()
    new_parent_path = (new_parent_path or "").strip()
    if not folder_path:
        return "Invalid folder"

    old_parent = _folder_parent_path(folder_path)
    if old_parent == new_parent_path:
        return None

    if new_parent_path == folder_path or new_parent_path.startswith(folder_path + "/"):
        return "Cannot move a folder into itself"

    folders = load_folder_structure()
    node = _find_folder_node(folders, folder_path)
    if node is None:
        return "Folder not found"

    name = node.get("name") or ""
    if not name:
        return "Invalid folder"

    new_path = f"{new_parent_path}/{name}" if new_parent_path else name
    if new_path == folder_path:
        return None

    dest_children = _children_list_for_parent(folders, new_parent_path)
    if dest_children is None:
        return "Parent folder not found"

    for s in dest_children:
        if not isinstance(s, dict) or s.get("type") != "folder":
            continue
        if s.get("name") == name:
            return "A folder with that name already exists there"

    subtree_paths = _collect_subtree_folder_paths(node)
    for p in subtree_paths:
        if not p:
            continue
        np = _rewrite_paper_folder_path(p, folder_path, new_path)
        if _folder_segment_depth(np) > max_depth:
            return f"Maximum folder depth ({max_depth}) would be exceeded"

    old_siblings = _children_list_for_parent(folders, old_parent)
    if old_siblings is None:
        return "Folder not found"

    idx = None
    for i, c in enumerate(old_siblings):
        if isinstance(c, dict) and c.get("type") == "folder" and c.get("path") == folder_path:
            idx = i
            break
    if idx is None:
        return "Folder not found"

    old_siblings.pop(idx)
    dest_children.append(node)

    _remap_subtree_after_rename(node, folder_path, new_path)
    # Move the directory itself, with everything in it (sub-folders, pictures,
    # files you added in Finder), before the papers are re-saved below.
    move_folder_dir(folder_path, new_path)

    for paper in list_papers():
        fp = paper.folder_path or ""
        np = _rewrite_paper_folder_path(fp, folder_path, new_path)
        if np != fp:
            paper.folder_path = np
            save_paper(paper)   # moves the paper's files into the new directory

    save_folder_structure(folders)   # creates the directory in its new home
    prune_folder_dir(folder_path)    # and clears the old one, if it is empty
    return None


def _remap_subtree_after_rename(node: Dict[str, Any], old_root: str, new_root: str) -> None:
    if node.get("type") != "folder":
        return
    p = node.get("path", "")
    if p == old_root:
        node["path"] = new_root
    elif p.startswith(old_root + "/"):
        node["path"] = new_root + p[len(old_root) :]
    for c in node.get("children", []):
        if isinstance(c, dict):
            _remap_subtree_after_rename(c, old_root, new_root)


def delete_folder_structure(folder_path: str) -> Optional[str]:
    """
    Remove a folder and all nested subfolders under it. Papers in that folder
    or any descendant folder are moved to the removed folder's parent path.
    Returns None on success, or an error message.
    """
    folder_path = (folder_path or "").strip()
    if not folder_path:
        return "Invalid folder"

    parent_path = _folder_parent_path(folder_path)
    folders = load_folder_structure()
    parent_children = _children_list_for_parent(folders, parent_path)
    if parent_children is None:
        return "Parent folder not found"

    idx = None
    for i, c in enumerate(parent_children):
        if isinstance(c, dict) and c.get("type") == "folder" and c.get("path") == folder_path:
            idx = i
            break
    if idx is None:
        return "Folder not found"

    parent_children.pop(idx)

    for paper in list_papers():
        fp = paper.folder_path or ""
        np = _path_after_cascade_folder_delete(fp, folder_path, parent_path)
        if np != fp:
            paper.folder_path = np
            save_paper(paper)   # this moves the paper's files out of the folder

    save_folder_structure(folders)
    # Now that nothing is left inside, remove the directory itself. If anything
    # unexpected remains, the directory stays and the files stay with it.
    prune_folder_dir(folder_path)
    return None


def rename_folder_structure(old_path: str, new_name: str) -> Optional[str]:
    """
    Rename the last segment of old_path. Updates subtree paths and all papers.
    Returns None on success, or an error message.
    """
    old_path = (old_path or "").strip()
    new_name = (new_name or "").strip()
    if not old_path:
        return "Invalid folder"
    if not new_name or "/" in new_name or "\\" in new_name:
        return "Invalid folder name"

    parent_path = _folder_parent_path(old_path)
    new_path = f"{parent_path}/{new_name}" if parent_path else new_name
    if new_path == old_path:
        return None

    folders = load_folder_structure()
    siblings = _children_list_for_parent(folders, parent_path)
    if siblings is None:
        return "Folder not found"

    for s in siblings:
        if not isinstance(s, dict) or s.get("type") != "folder":
            continue
        if s.get("path") != old_path and s.get("name") == new_name:
            return "A folder with that name already exists"

    target = _find_folder_node(folders, old_path)
    if target is None:
        return "Folder not found"

    target["name"] = new_name
    _remap_subtree_after_rename(target, old_path, new_path)
    move_folder_dir(old_path, new_path)   # rename the directory itself, contents and all

    for paper in list_papers():
        fp = paper.folder_path or ""
        np = _rewrite_paper_folder_path(fp, old_path, new_path)
        if np != fp:
            paper.folder_path = np
            save_paper(paper)   # moves the paper's files into the new directory

    save_folder_structure(folders)   # creates the renamed directory
    prune_folder_dir(old_path)       # and clears the old one, if it is empty
    return None


def _source_link_key(paper_id: str, block_id: str) -> str:
    return f"{paper_id}:{block_id}"


def save_source_link(
    paper_id: str,
    block_id: str,
    source_type: str,
    source_uri: str,
    locator: Dict[str, Any],
    captured_text: str,
) -> bool:
    _migrate_to_collection_if_needed()
    m = _collection_get(COLLECTION_SOURCE_LINKS_KEY, {})
    if not isinstance(m, dict):
        m = {}
    k = _source_link_key(paper_id, block_id)
    m[k] = {
        "paper_id": paper_id,
        "block_id": block_id,
        "source_type": source_type,
        "source_uri": source_uri,
        "locator": locator or {},
        "captured_text": captured_text or "",
    }
    return _collection_set(COLLECTION_SOURCE_LINKS_KEY, m)


def load_source_link(paper_id: str, block_id: str) -> Optional[Dict[str, Any]]:
    _migrate_to_collection_if_needed()
    m = _collection_get(COLLECTION_SOURCE_LINKS_KEY, {})
    if not isinstance(m, dict):
        return None
    v = m.get(_source_link_key(paper_id, block_id))
    return v if isinstance(v, dict) else None


# ═══════════════════════════════════════════════════════════════════════════
#  File mirror  (phase 1 — write only; nothing reads these yet)
# ═══════════════════════════════════════════════════════════════════════════
#
# Every paper is written as two files under the profile folder:
#
#   <profile>/ankipapers/papers/Medicine/GI/Gastroenterology.md
#   <profile>/ankipapers/papers/Medicine/GI/Gastroenterology.ap.json
#
# The .md is the document and nothing else, so it stays pleasant to read, diff
# and keep in git. Its first line is a hidden HTML comment naming the paper —
# the same device the editor already uses for card anchors — which is what lets
# a file be renamed or moved without breaking the ap:// links that point at it.
#
# The .ap.json beside it carries what markdown cannot: the deck, the tags, the
# true (unsanitized) title and folder path, and the map from each line to its
# Anki note. That map is what stops Generate from destroying cards, so it has
# to be stored — just not in the middle of the prose.
#
# During this phase the Anki collection is still the only thing read back.
# These files exist to be compared against it.

PAPER_MD_HEADER_RE = re.compile(r"^<!--ap-paper:([0-9a-f-]{36})-->[ \t]*\r?\n?", re.IGNORECASE)

_FILE_FORMAT_VERSION = 1
_MAX_NAME_CHARS = 120
_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def sanitize_path_component(name: str, fallback: str = "Untitled") -> str:
    """A single folder or file name that a filesystem will actually accept.

    Characters a path cannot hold become "-". The true, unaltered title is
    always kept in the .ap.json, so nothing typed is ever lost — only the
    name on disk is adjusted.
    """
    s = (name or "").strip()
    for ch in '/\\:*?"<>|':
        s = s.replace(ch, "-")
    s = "".join(c for c in s if ord(c) >= 32)   # drop control characters
    s = re.sub(r"\s+", " ", s).strip()
    s = s.rstrip(". ")                          # trailing dots/spaces are trouble
    if not s or s in {".", ".."}:
        s = fallback
    if s.split(".")[0].upper() in _WINDOWS_RESERVED:
        s = "_" + s
    if len(s) > _MAX_NAME_CHARS:
        s = s[:_MAX_NAME_CHARS].rstrip(". ")
    return s or fallback


def paper_relative_stem(paper) -> str:
    """Where a paper belongs under papers/, without a file extension."""
    parts = [
        sanitize_path_component(p)
        for p in (getattr(paper, "folder_path", "") or "").split("/")
        if p and p.strip()
    ]
    stem = sanitize_path_component(
        getattr(paper, "title", "") or "", fallback=(paper.id or "Untitled")[:8]
    )
    parts.append(stem)
    return os.path.join(*parts)


def _render_paper_markdown(paper) -> str:
    content = paper.content or ""
    if not content.endswith("\n"):
        content += "\n"
    return f"<!--ap-paper:{paper.id}-->\n{content}"


def _render_paper_meta(paper) -> str:
    refs = []
    for ref in getattr(paper, "card_refs", []) or []:
        try:
            refs.append(ref.to_dict())
        except Exception:
            continue
    meta = {
        "ankipapers_format": _FILE_FORMAT_VERSION,
        "id": paper.id,
        "title": getattr(paper, "title", "") or "",
        "deck_name": getattr(paper, "deck_name", "") or "",
        "folder_path": getattr(paper, "folder_path", "") or "",
        "tags": list(getattr(paper, "tags", []) or []),
        "created_at": getattr(paper, "created_at", None),
        "modified_at": getattr(paper, "modified_at", None),
        "show_chapter_bar": bool(getattr(paper, "show_chapter_bar", False)),
        "card_refs": refs,
    }
    return json.dumps(meta, indent=2, ensure_ascii=False) + "\n"


def _atomic_write(path: str, text: str):
    """Write via a temporary file and rename, so an interrupted save can never
    leave a half-written document behind."""
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _paper_id_in_file(md_path: str):
    """The id recorded in a .md file's first line, or None."""
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            match = PAPER_MD_HEADER_RE.match(f.readline())
        return match.group(1).lower() if match else None
    except Exception:
        return None


def index_papers_on_disk(root: str = None) -> Dict[str, str]:
    """Map each paper id to the .md file currently holding it."""
    root = root or get_storage_dir()
    found: Dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != DELETED_DIR_NAME]
        for name in filenames:
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            pid = _paper_id_in_file(path)
            if pid:
                found[pid] = path
    return found


def _resolve_target(paper, root: str, on_disk: Dict[str, str]):
    """The .md path this paper should occupy, avoiding another paper's file."""
    base = os.path.join(root, paper_relative_stem(paper))
    candidate, suffix = base, 1
    while True:
        md = candidate + ".md"
        existing = _paper_id_in_file(md) if os.path.exists(md) else None
        if existing is None or existing == (paper.id or "").lower():
            return md
        suffix += 1
        candidate = f"{base} ({suffix})"


def write_paper_files(paper, root: str = None, on_disk: Dict[str, str] = None) -> Dict[str, Any]:
    """Write one paper's .md and .ap.json. Returns what happened."""
    root = root or get_storage_dir()
    if on_disk is None:
        on_disk = index_papers_on_disk(root)

    target_md = _resolve_target(paper, root, on_disk)
    target_meta = target_md[:-3] + ".ap.json"

    moved_from = None
    previous = on_disk.get((paper.id or "").lower())
    if previous and os.path.abspath(previous) != os.path.abspath(target_md):
        # The paper was renamed or moved: take its old pair with it rather
        # than leaving a stale duplicate behind.
        moved_from = previous
        for stale in (previous, previous[:-3] + ".ap.json"):
            try:
                if os.path.exists(stale):
                    os.remove(stale)
            except Exception:
                pass

    _atomic_write(target_md, _render_paper_markdown(paper))
    _atomic_write(target_meta, _render_paper_meta(paper))
    on_disk[(paper.id or "").lower()] = target_md

    return {
        "id": paper.id,
        "title": getattr(paper, "title", "") or "",
        "md": target_md,
        "meta": target_meta,
        "moved_from": moved_from,
        "renamed": os.path.basename(target_md)[:-3]
                   != sanitize_path_component(getattr(paper, "title", "") or ""),
        "sanitized": sanitize_path_component(getattr(paper, "title", "") or "")
                     != (getattr(paper, "title", "") or "").strip(),
    }


def mirror_paper_to_disk_quietly(paper):
    """Best-effort mirror used by save_paper(). Never raises."""
    try:
        write_paper_files(paper)
    except Exception:
        try:
            import traceback
            traceback.print_exc()
        except Exception:
            pass


def mirror_all_papers(dry_run: bool = False) -> Dict[str, Any]:
    """Write every paper to disk, or report what writing them would do.

    This is what the "Write all papers to disk" button calls. It only ever
    adds files; the collection is read and left exactly as it was.
    """
    root = get_storage_dir()
    papers = list_papers()
    on_disk = index_papers_on_disk(root)

    report: Dict[str, Any] = {
        "root": root,
        "dry_run": bool(dry_run),
        "paper_count": len(papers),
        "card_ref_count": sum(len(getattr(p, "card_refs", []) or []) for p in papers),
        "written": [],
        "renamed": [],
        "failed": [],
    }

    seen_targets: Dict[str, str] = {}
    for paper in papers:
        try:
            desired = os.path.join(root, paper_relative_stem(paper)) + ".md"
            clash = seen_targets.get(os.path.normcase(os.path.abspath(desired)))
            if dry_run:
                entry = {
                    "id": paper.id,
                    "title": getattr(paper, "title", "") or "",
                    "md": desired,
                    "cards": len(getattr(paper, "card_refs", []) or []),
                    "clashes_with": clash,
                }
                seen_targets[os.path.normcase(os.path.abspath(desired))] = paper.id
                report["written"].append(entry)
                if entry["title"] != sanitize_path_component(entry["title"]) or clash:
                    report["renamed"].append(entry)
                continue

            result = write_paper_files(paper, root=root, on_disk=on_disk)
            result["cards"] = len(getattr(paper, "card_refs", []) or [])
            seen_targets[os.path.normcase(os.path.abspath(result["md"]))] = paper.id
            report["written"].append(result)
            if result["sanitized"] or result["renamed"]:
                report["renamed"].append(result)
        except Exception as exc:
            report["failed"].append({
                "id": getattr(paper, "id", "?"),
                "title": getattr(paper, "title", "") or "",
                "error": str(exc),
            })
    return report


# ═══════════════════════════════════════════════════════════════════════════
#  Reading from disk  (phase 2)
# ═══════════════════════════════════════════════════════════════════════════
#
# The files written in phase 1 now become what the app reads. The collection
# copy keeps being written alongside, so it stays a complete safety net and
# reverting is a one-line change.
#
# Every read falls back to the collection if a file is unreadable, and the
# whole disk path is skipped when no files exist yet — so an install that has
# never pressed "Write files" behaves exactly as it did before.

DELETED_DIR_NAME = "_deleted"


def _read_paper_from_files(md_path: str, root: str = None) -> Optional[Paper]:
    """Rebuild a Paper from its .md and .ap.json. None if it cannot be read.

    Where the file sits is itself information: if the sidecar is missing or
    damaged, the folder and title are recovered from the path rather than lost.
    Without that, a corrupt sidecar would quietly move the paper to the root of
    the tree the next time it was saved."""
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return None

    match = PAPER_MD_HEADER_RE.match(text)
    paper_id = match.group(1) if match else None
    content = PAPER_MD_HEADER_RE.sub("", text, count=1) if match else text

    meta: Dict[str, Any] = {}
    meta_path = md_path[:-3] + ".ap.json"
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            meta = {}   # a damaged sidecar must not cost you the document

    paper_id = paper_id or str(meta.get("id") or "").strip()
    if not paper_id:
        return None

    # Fall back to what the path itself tells us.
    path_title = os.path.basename(md_path)[:-3]
    path_folder = ""
    try:
        rel = os.path.relpath(os.path.dirname(md_path), root or get_storage_dir())
        if rel not in (".", "", os.pardir):
            path_folder = rel.replace(os.sep, "/")
    except Exception:
        path_folder = ""

    paper = Paper(
        title=meta.get("title") or path_title,
        content=content,
        deck_name=meta.get("deck_name") or "Default",
        # Where the file actually sits wins over what the sidecar remembers:
        # folders are directories now, so moving one in Finder must be seen.
        folder_path=path_folder,
        paper_id=paper_id,
    )
    paper.tags = list(meta.get("tags") or [])
    paper.show_chapter_bar = bool(meta.get("show_chapter_bar", False))
    if meta.get("created_at"):
        paper.created_at = meta["created_at"]
    if meta.get("modified_at"):
        paper.modified_at = meta["modified_at"]
    refs = []
    for raw in meta.get("card_refs") or []:
        try:
            refs.append(CardReference.from_dict(raw))
        except Exception:
            continue
    paper.card_refs = refs
    return paper


def _papers_from_disk() -> Dict[str, Paper]:
    """Every paper currently on disk, keyed by id. Empty when none exist."""
    out: Dict[str, Paper] = {}
    try:
        root = get_storage_dir()
    except Exception:
        return out
    for pid, md_path in index_papers_on_disk(root).items():
        paper = _read_paper_from_files(md_path, root)
        if paper is not None:
            out[paper.id] = paper
    return out


def papers_are_on_disk() -> bool:
    """True once the file mirror holds at least one paper."""
    try:
        return bool(index_papers_on_disk(get_storage_dir()))
    except Exception:
        return False


def park_paper_files(paper_id: str) -> Optional[str]:
    """Move a deleted paper's files into papers/_deleted/ rather than removing
    them. Deleting in the app should not be destructive on disk."""
    try:
        root = get_storage_dir()
        md_path = index_papers_on_disk(root).get((paper_id or "").lower())
        if not md_path or not os.path.exists(md_path):
            return None
        parked_dir = os.path.join(root, DELETED_DIR_NAME)
        os.makedirs(parked_dir, exist_ok=True)

        stem = os.path.basename(md_path)[:-3]
        target = os.path.join(parked_dir, stem)
        suffix = 1
        while os.path.exists(target + ".md"):
            suffix += 1
            target = os.path.join(parked_dir, f"{stem} ({suffix})")

        os.replace(md_path, target + ".md")
        meta = md_path[:-3] + ".ap.json"
        if os.path.exists(meta):
            os.replace(meta, target + ".ap.json")
        return target + ".md"
    except Exception:
        try:
            import traceback
            traceback.print_exc()
        except Exception:
            pass
        return None


# ═══════════════════════════════════════════════════════════════════════════
#  Folders as real directories  (phase 3)
# ═══════════════════════════════════════════════════════════════════════════
#
# The folder tree stops being a separate stored thing and becomes the shape of
# the papers/ directory itself. A folder you make in the app is a directory you
# can see in Finder, and a directory you make in Finder is a folder in the app.
#
# The collection copy of the tree keeps being written, so nothing is given up
# yet — but what the app displays now comes from disk.

def folder_dir_path(folder_path: str, root: str = None) -> str:
    """The directory on disk that a folder path refers to."""
    root = root or get_storage_dir()
    parts = [sanitize_path_component(p) for p in (folder_path or "").split("/") if p.strip()]
    return os.path.join(root, *parts) if parts else root


def ensure_folder_dir(folder_path: str, root: str = None) -> str:
    """Create the directory for a folder. Safe to call repeatedly."""
    path = folder_dir_path(folder_path, root)
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass
    return path


def move_folder_dir(old_path: str, new_path: str, root: str = None) -> bool:
    """Move or rename a folder's directory on disk, with everything inside it.

    Moving papers one by one (save_paper) leaves behind whatever isn't a
    paper -- emptied sub-folders, Finder's .DS_Store, files you put there
    yourself -- and the leftover directory then shows up again in the sidebar.
    So the directory moves as a whole first. If the destination already exists
    (two folders being merged), each entry is moved across and anything that
    would overwrite something is left where it was. Never deletes a file.
    """
    root = os.path.abspath(root or get_storage_dir())
    src = os.path.abspath(folder_dir_path(old_path, root))
    dst = os.path.abspath(folder_dir_path(new_path, root))
    inside = lambda p: p != root and p.startswith(root + os.sep)
    if not (inside(src) and inside(dst)) or src == dst or not os.path.isdir(src):
        return False
    if dst.startswith(src + os.sep):
        return False  # into itself
    try:
        same = os.path.exists(dst) and os.path.samefile(src, dst)  # case-only rename on macOS
        if not os.path.exists(dst) or same:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            os.replace(src, dst)
            return True
        _merge_dir(src, dst)
        try:
            os.rmdir(src)  # only if the merge emptied it; its parent is left alone
        except OSError:
            pass
        return True
    except Exception:
        try:
            import traceback
            traceback.print_exc()
        except Exception:
            pass
        return False


def _merge_dir(src: str, dst: str) -> None:
    for name in os.listdir(src):
        s, d = os.path.join(src, name), os.path.join(dst, name)
        if not os.path.exists(d):
            os.replace(s, d)
        elif os.path.isdir(s) and os.path.isdir(d):
            _merge_dir(s, d)
            try:
                os.rmdir(s)
            except OSError:
                pass  # something stayed behind rather than overwrite; keep it
        elif name == ".DS_Store":
            try:
                os.remove(s)  # Finder's view settings; the destination has its own
            except OSError:
                pass


def prune_folder_dir(folder_path: str, root: str = None) -> bool:
    """Remove a folder's directory, and any now-empty parents, but only when
    nothing is left inside. A directory that still holds files is never
    touched — deleting a folder must not take documents with it."""
    root = os.path.abspath(root or get_storage_dir())
    path = os.path.abspath(folder_dir_path(folder_path, root))
    if path == root or not path.startswith(root + os.sep):
        return False
    removed = False
    while path != root and path.startswith(root + os.sep):
        try:
            if not os.path.isdir(path) or os.listdir(path):
                break
            os.rmdir(path)
            removed = True
            path = os.path.dirname(path)
        except Exception:
            break
    return removed


def _collect_tree_folder_paths(node: Dict[str, Any], out: List[str] = None) -> List[str]:
    out = [] if out is None else out
    for child in (node or {}).get("children", []) or []:
        if isinstance(child, dict) and child.get("type") == "folder":
            path = child.get("path") or child.get("name")
            if path:
                out.append(path)
            _collect_tree_folder_paths(child, out)
    return out


def materialize_folder_dirs(tree: Dict[str, Any], root: str = None) -> int:
    """Give every folder in a stored tree a real directory, so that switching
    to a disk-derived tree cannot make an empty folder disappear."""
    made = 0
    for path in _collect_tree_folder_paths(tree or {}):
        target = folder_dir_path(path, root)
        if not os.path.isdir(target):
            ensure_folder_dir(path, root)
            made += 1
    return made


def folder_tree_from_disk(root: str = None) -> Dict[str, Any]:
    """Build the folder tree the sidebar shows from the directories on disk."""
    root = root or get_storage_dir()

    def build(dir_path: str, rel: str, depth: int) -> List[Dict[str, Any]]:
        children: List[Dict[str, Any]] = []
        try:
            names = sorted(os.listdir(dir_path), key=lambda s: s.lower())
        except Exception:
            return children
        for name in names:
            if name == DELETED_DIR_NAME or name.startswith("."):
                continue
            full = os.path.join(dir_path, name)
            if not os.path.isdir(full):
                continue
            path = f"{rel}/{name}" if rel else name
            children.append({
                "type": "folder",
                "name": name,
                "path": path,
                "children": build(full, path, depth + 1),
            })
        return children

    return {"name": "Root", "children": build(root, "", 0), "expanded": True}
