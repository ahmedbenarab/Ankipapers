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
import time
from typing import List, Dict, Optional, Any

from .paper import Paper

_BLOCK_ID_SUFFIX_RE = re.compile(
    r"\s*<!--ap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-->\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _strip_block_ids(content: str) -> str:
    """Remove all legacy <!--ap:uuid--> markers from content."""
    if not content or "<!--ap:" not in content:
        return content
    return _BLOCK_ID_SUFFIX_RE.sub("", content)


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


def _migrate_legacy_data():
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


# Run migration on import
try:
    _migrate_legacy_data()
except Exception as e:
    print(f"[Anki Papers] Migration skipped: {e}")


def save_paper(paper: Paper) -> str:
    """Save a paper to disk. Returns the file path."""
    storage_dir = get_storage_dir()
    file_path = os.path.join(storage_dir, f"{paper.id}.json")

    paper.content = _strip_block_ids(paper.content)
    data = paper.to_dict()

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return file_path


def load_paper(paper_id: str) -> Optional[Paper]:
    """Load a paper from disk by its ID."""
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
    """Delete a paper from disk."""
    storage_dir = get_storage_dir()
    file_path = os.path.join(storage_dir, f"{paper_id}.json")

    if os.path.exists(file_path):
        os.remove(file_path)
        return True
    return False


def list_papers() -> List[Paper]:
    """List all saved papers."""
    storage_dir = get_storage_dir()
    papers = []

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
    file_path = get_folders_file()
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(folders, f, indent=2, ensure_ascii=False)


def load_folder_structure() -> Dict[str, Any]:
    """Load the folder tree structure."""
    file_path = get_folders_file()

    if not os.path.exists(file_path):
        return {"name": "Root", "children": [], "expanded": True}

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, KeyError):
        return {"name": "Root", "children": [], "expanded": True}
