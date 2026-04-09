# Anki Papers

Write notes as **markdown papers** inside Anki and turn lines into **Basic**, **reversible**, and **cloze** cards with simple syntax—then **generate** to sync notes to your collection. One document per topic, folders, block or source editing, import/export.

**Author:** Dr. Ahmed Benarab

## Requirements

- **Anki** version compatible with [`manifest.json`](manifest.json) → `min_point_version` (compare with **Help → About** in Anki; this repo currently targets **231000**).
- **Qt WebEngine** (bundled with standard Anki desktop builds).

## Install (end users)

### Option A — `.ankiaddon` package

1. Build the package (see [Building the add-on package](#building-the-add-on-package)) or use a release artifact from GitHub.
2. In Anki: **Tools → Add-ons → Install from file…** and choose `Ankipapers.ankiaddon`.
3. Restart Anki if prompted.

### Option B — From this repository

1. Clone or download the repo.
2. Copy the **folder** (the one that contains `__init__.py` and `manifest.json`) into your Anki add-ons directory, e.g.:

   - **Windows:** `%APPDATA%\Anki2\addons21\Ankipapers`
   - **macOS:** `~/Library/Application Support/Anki2/addons21/Ankipapers`
   - **Linux:** `~/.local/share/Anki2/addons21/Ankipapers`

3. Ensure the bundled UI exists under `web/` (it is committed in this repo). If you removed it, run a [UI build](#building-the-web-ui) first.
4. Restart Anki.

Open **Anki Papers** from **Tools → 📝 Anki Papers**, the **📝 Papers** toolbar link, or **Ctrl+Shift+P**.

## Building the web UI

The interface is a **Vite + React** app in `web_src/`. Production files are emitted to `web/` (configured in `web_src/vite.config.js`).

```bash
cd web_src
npm install
npm run build
```

After changing React/CSS, run `npm run build` again before packaging or testing in Anki.

## Building the add-on package

Creates `Ankipapers.ankiaddon` (zip) for sharing or “Install from file”.

**Windows (PowerShell):**

```powershell
.\_build.ps1
```

**Windows (double-click):** run `build_ankiaddon.bat`.

The script bundles `__init__.py`, `manifest.json`, `config.json`, `config.md`, `core/`, `gui/`, and `web/`. It does **not** include `web_src/`, `user_files/`, or `node_modules/`.

## Project layout

| Path | Purpose |
|------|--------|
| `__init__.py` | Add-on entry: menu, toolbar, shortcuts |
| `manifest.json` | Anki package metadata |
| `core/` | Papers, storage, parsing, card generation |
| `gui/` | Qt window, `QWebChannel` bridge to the UI |
| `web/` | Built static UI (HTML/JS/CSS) loaded by the webview |
| `web_src/` | React source; build output goes to `web/` |
| `user_files/` | Local cache/fallback files only (gitignored; runtime-created when needed) |
| `_build.ps1` / `build_ankiaddon.bat` | Pack `Ankipapers.ankiaddon` |

## Card syntax (quick reference)

| Kind | Example |
|------|--------|
| Basic | `Question >> Answer` |
| Reversible | `Term <> Definition` |
| Cloze | `Text with {{blank}}` or `{{c1::a}} {{c2::b}}` |

Headings (`#`), lists, blockquotes, `---`, images `![alt](file)`, and inline formatting (`**bold**`, `` `code` ``, etc.) work in the paper content. See the in-app **home** screen cheat sheet for more.

## Settings

**Tools → Add-ons → Anki Papers → Config** (or in-app **Settings**) for default deck, autosave, fonts, theme, and behavior when Anki notes differ from the paper during **Generate**.

## Data and sync behavior

- **Papers and folder structure:** stored in Anki collection config and synced with AnkiWeb.
- **Generated flashcards/notes:** normal Anki collection data, synced as usual.
- **Images:** copied into your collection media folder and synced through Anki media sync.
- **`user_files/`:** used only as local fallback/cache in edge cases (for example when collection access is unavailable).

## Contributing / issues

Use [GitHub Issues](https://github.com/YOUR_USERNAME/YOUR_REPO/issues) for bug reports and feature ideas (replace with your repo URL after publishing).

## License

[MIT](LICENSE) — Copyright (c) 2026 Dr. Ahmed Benarab.
