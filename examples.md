# Anki Papers — usage examples

Practical examples you can copy, adapt, or follow step by step.

---

## 1. First session (5 minutes)

1. Open **Anki Papers**: **Tools → Anki Papers**, toolbar **Papers**, or **Ctrl+Shift+P**.
2. Click **+ Paper** in the sidebar (or create from the welcome screen).
3. Give the paper a title in the header and pick a **deck** if you don’t want the default.
4. In the editor, type something like:

```markdown
# My first paper

What is the powerhouse of the cell? >> Mitochondria
```

5. Press **Ctrl+S** to save (or wait for autosave).
6. Press **Ctrl+G** to **Generate** — Anki creates/updates the note for that card line.

You now have notes + cards living in the same document as your headings and prose.

---

## 2. One paper mixing notes and three card types

Example content for a single paper (block or source view):

```markdown
# Cell energy

Mitochondria produce ATP through oxidative phosphorylation.

## Quick checks

What is the main energy currency of the cell? >> ATP

Glucose <> Primary carbohydrate fuel used in glycolysis

The {{c1::electron transport chain}} happens in the {{c2::inner mitochondrial membrane}}.

- **Bold** and *italic* work in rendered blocks.
- Lists stay notes-only unless you add card syntax on a line.
```

- **`>>`** → **Basic** (front / back).  
- **`<>`** → **Reversible** (both directions).  
- **`{{c1::...}}`** → **Cloze** with numbered blanks.

Generate when you’re ready; change the paper later and Generate again to sync (per your conflict settings).

---

## 3. Folders and sidebar

- **+ Folder** → create a folder (e.g. `Biology`, `Clerkship / Cards`).
- **Drag** a paper or folder onto another folder to nest or reorganize.
- **Drag** onto the root area (below folders) to move a paper to the **library root**.
- **Right-click a folder** → Rename, **Move to root** (if nested), Remove folder.
- **Right-click a paper** → Delete paper.

Use folders the way you’d use notebooks or units—papers are the individual documents inside them.

---

## 4. Search examples (sidebar search pill)

Open the search pill, then try:

| Goal | Example query |
|------|----------------|
| Words must all appear (anywhere in title, body, folder, deck, tags) | `mitochondria ATP` |
| Exact phrase | `"oxidative phosphorylation"` |
| Only in title | `title:cell` |
| Only in a folder path | `folder:Biology` |
| Deck filter | `deck:Medicine` |
| Tag filter | `tag:exam` |
| Exclude a word | `glycolysis -fermentation` |
| Either branch | `citric OR krebs` |

Folder values with spaces: `folder:"Cell Bio"`.

---

## 5. Block editor: multi-select + context menu

1. **Ctrl+Click** (Windows/Linux) or **⌘+Click** (macOS) several blocks to select them.
2. **Shift+Click** another block to extend a range from your last anchor.
3. **Right-click** one of the selected blocks:
   - **Copy blocks** — all selected lines to the clipboard.
   - **Duplicate below** — inserts copies in order after the last selected line.
   - **Merge into one block** — joins selected lines into a single line (space-separated).
   - **Delete blocks** — removes all selected lines.
4. **Escape** clears the multi-selection (when the menu is closed).

**Edit block** stays single-block only when multiple are selected.

---

## 6. Images

In markdown:

```markdown
![Diagram of mitochondrion](myimage.png)
```

Optional width in the alt text:

```markdown
![Mitochondrion diagram|400](myimage.png)
```

Use the editor / bridge actions to **pick** or **paste** an image into the collection media folder when available.

---

## 7. Import an existing `.md` file

1. From the welcome screen or header actions, use **Import Markdown** (where exposed in your build).
2. Choose a `.md` file — it becomes a **new paper**; then adjust deck/title and **Generate** as needed.

---

## 8. Keyboard shortcuts (reference)

| Action | Shortcut |
|--------|-----------|
| Save | **Ctrl+S** |
| Generate cards | **Ctrl+G** |
| Open settings | **Ctrl+,** |
| Block ↔ Source | **Ctrl+Shift+V** |
| Bold (in focused block) | **Ctrl+B** |
| Open Anki Papers | **Ctrl+Shift+P** |

---

## 9. Settings worth touching early

Open **Settings** (**Ctrl+,**):

- **Default deck** for new cards.  
- **Editor theme** (light/dark).  
- **Autosave** interval.  
- **Anki edit conflict** — what happens if you edited the note in Anki but the paper line “matches” the old version (ask / preserve / overwrite / abort).

---

These examples match how **Anki Papers** is intended to be used: write and structure in one place, then **Generate** to keep Anki in sync with your paper.
