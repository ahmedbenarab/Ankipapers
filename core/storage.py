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

from .paper import Paper

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
    """Save a paper. Returns a storage identifier/path."""
    _migrate_to_collection_if_needed()
    file_path = f"collection://{paper.id}"

    paper.content = _strip_block_ids(paper.content)
    data = paper.to_dict()
    papers_map = _collection_get(COLLECTION_PAPERS_KEY, {})
    if not isinstance(papers_map, dict):
        papers_map = {}
    papers_map[paper.id] = data
    if _collection_set(COLLECTION_PAPERS_KEY, papers_map):
        return file_path

    # Fallback to disk if collection is unavailable
    storage_dir = get_storage_dir()
    file_path = os.path.join(storage_dir, f"{paper.id}.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return file_path


def load_paper(paper_id: str) -> Optional[Paper]:
    """Load a paper by its ID."""
    _migrate_to_collection_if_needed()
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
    """List all saved papers."""
    _migrate_to_collection_if_needed()
    papers = []

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
    """Save the folder tree structure."""
    _migrate_to_collection_if_needed()
    if _collection_set(COLLECTION_FOLDERS_KEY, folders):
        return
    # Fallback to disk
    file_path = get_folders_file()
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(folders, f, indent=2, ensure_ascii=False)


def load_folder_structure() -> Dict[str, Any]:
    """Load the folder tree structure."""
    _migrate_to_collection_if_needed()
    folders = _collection_get(COLLECTION_FOLDERS_KEY, None)
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
    folder_path: str, new_parent_path: str, max_depth: int = 3
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

    for paper in list_papers():
        fp = paper.folder_path or ""
        np = _rewrite_paper_folder_path(fp, folder_path, new_path)
        if np != fp:
            paper.folder_path = np
            save_paper(paper)

    save_folder_structure(folders)
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
            save_paper(paper)

    save_folder_structure(folders)
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

    for paper in list_papers():
        fp = paper.folder_path or ""
        np = _rewrite_paper_folder_path(fp, old_path, new_path)
        if np != fp:
            paper.folder_path = np
            save_paper(paper)

    save_folder_structure(folders)
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
