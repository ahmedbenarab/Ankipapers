# Pomodium — Persistent Storage Implementation

## Overview

This document describes how Pomodium now stores its data using **persistent storage** that survives addon updates. Following the Review Heatmap pattern, data is stored across **three separate storages** based on what type of data it is and where it should sync.

### Why This Matters

When Anki updates an add-on (or you reinstall it), it **only replaces files inside the add-on folder**:

```
addons21\678094152\
    __init__.py         ← replaced
    config.py           ← replaced
    config.json         ← replaced (factory defaults)
    meta.json           ← may be replaced
    stats.json          ← REPLACED (DATA LOST!)
    ...
```

**Before this update:** All your settings, deadlines, todo lists, and statistics were stored in `config.json` and `stats.json` inside the addon folder — **lost on every update**.

**After this update:** Your data lives in **separate database files** that the update process never touches:
- `collection.anki2` → Synced data (deadlines, todo list, statistics)
- `prefs.db` → Profile-specific data (UI preferences)

---

## The Three Config Storages

### 1. `synced` — Anki Collection Database

| Property | Value |
|---|---|
| **File** | `collection.anki2` |
| **Full path** | `%APPDATA%\Anki2\<ProfileName>\collection.anki2` |
| **Scope** | Per Anki profile |
| **Syncs with AnkiWeb?** | ✅ Yes |

**What's stored here:**

```python
"synced": {
    # Core timer settings (follow you across devices)
    "work_duration": 25,
    "short_break_duration": 5,
    "long_break_duration": 15,
    "sessions_before_long_break": 4,
    "stop_sound_effects": False,
    
    # Daily tracking (syncs across devices)
    "daily_pomodoro_count": 0,
    "daily_study_seconds": 0,
    "daily_break_seconds": 0,
    "last_pomodoro_date": "2026-03-30",
    
    # User data (syncs across devices)
    "todo_list": ["task 1", "task 2"],
    "deadlines_list": [...],
    "main_deadline_id": "uuid-here",
    "main_deadline_position": "top",
    
    # Statistics (syncs across devices)
    "stats": {
        "2026-03-28": {"pomos": 17, "study": 11220, "break": 3900},
        "2026-03-27": {"pomos": 5, "study": 7500, "break": 300}
    },
    
    "version": "1.0.0",
}
```

**Your deadlines, todo list, and statistics follow you across devices** because they sync with your collection.

---

### 2. `profile` — Anki Profile Database

| Property | Value |
|---|---|
| **File** | `prefs.db` |
| **Full path** | `%APPDATA%\Anki2\prefs.db` |
| **Scope** | Per Anki profile |
| **Syncs with AnkiWeb?** | ❌ No — local only |

**What's stored here:**

```python
"profile": {
    # UI preferences (machine-specific, don't sync)
    "hide_during_review": True,
    "show_in_toolbar": True,
    "show_in_deck_browser": True,
    "show_stats_section": False,
    "widget_corner": "bottom_left",
    "auto_avoid_amboss_overlap": True,
    "auto_start_on_review": True,
    
    # Other settings
    "compact_mode": False,
    "card_goal": 0,
    "auto_pause_idle": False,
    "idle_threshold_minutes": 2,
    
    # Keyboard shortcuts
    "shortcut_toggle": "Ctrl+Shift+P",
    "shortcut_reset": "Ctrl+Shift+R",
    
    "version": "1.0.0",
}
```

**UI/display preferences are machine-specific** and stay local to each computer.

---

### 3. `local` — Add-on Folder (`meta.json`)

| Property | Value |
|---|---|
| **File** | `meta.json` (inside the add-on folder) |
| **Full path** | `%APPDATA%\Anki2\addons21\678094152\meta.json` |
| **Scope** | All profiles on this machine |
| **Syncs with AnkiWeb?** | ❌ No |

This is managed directly by **Anki's add-on manager**. The `config.json` file in the addon folder now holds only **factory defaults** — your actual settings are stored in the databases above.

---

## Why Settings Are NOT Lost on Update

This is the most important property of this design.

When Anki updates an add-on (or you reinstall it), it **only replaces files inside the add-on folder**:

```
Add-on Update
     │
     ▼
addons21\678094152\  ← only this folder is replaced
     │
     │   Your data lives HERE (untouched by updates):
     │
     ├── collection.anki2   →  synced config (deadlines, todo, stats...)
     └── prefs.db           →  profile config (UI preferences, shortcuts...)
```

> **Bottom line:** You can safely update or reinstall this add-on without any risk of losing your personal configuration, deadlines, or statistics.

---

## Migration from Legacy Storage

### What Changed

| Before | After |
|---|---|
| Settings in `src/config.json` | Settings in `collection.anki2` + `prefs.db` |
| Statistics in `src/stats.json` | Statistics in `collection.anki2` |
| Data **LOST** on update | Data **SURVIVES** update |

### Automatic Migration

When you first run the updated addon:

1. **`config.load_config()`** detects if synced storage is empty
2. If empty and `config.json` contains data → **migration runs automatically**
3. Data is split:
   - Timer settings, deadlines, todo list → **synced storage**
   - UI preferences, shortcuts → **profile storage**
4. Statistics are migrated when `stats.py` first accesses them

### Files Changed

1. **`src/storage.py`** (NEW) — Storage manager with three storage backends
2. **`src/config.py`** — Now uses `storage.py` for all reads/writes
3. **`src/stats.py`** — Now stores statistics in synced storage
4. **`__init__.py`** — Triggers migration on profile open

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                    POMODIUM STORAGE ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SYNCED (collection.anki2)    → Syncs with AnkiWeb                   │
│  ├── Timer settings (work/break duration)                           │
│  ├── Deadlines & Todo list                                          │
│  ├── Daily stats (pomos, study time)                                │
│  └── Historical statistics                                          │
│                                                                      │
│  PROFILE (prefs.db)           → Local only                          │
│  ├── UI preferences (widget position, show/hide)                   │
│  ├── Keyboard shortcuts                                             │
│  └── Display settings                                               │
│                                                                      │
│  LOCAL (meta.json)            → Factory defaults only               │
│  └── Default values for new installs                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

> **Result:** Update-safe, sync-friendly, and your data is always preserved.
