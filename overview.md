# Anki Papers — Add-on overview

**Anki Papers** turns Anki into a **notebook for long-form markdown**: you write one document per topic, organize papers in **folders**, and turn lines into **Basic**, **reversible**, and **cloze** cards with plain-text syntax. When you are ready, **Generate** syncs those definitions into real notes in your collection.

Use this document as a basis for your listing on **AnkiWeb** or other share pages.

---

## Who it is for

- Learners who prefer **writing notes first** and **deriving flashcards** from the same document.
- Anyone who wants **one place** for context (headings, lists, images) and **structured card lines** side by side.
- Users who like **folders**, **search**, and optional **Markdown import/export**.

---

## Main features

- **Papers** — Each paper is a markdown document with a title, optional folder path, and target deck for new cards.
- **Folders** — Nested folder tree in the sidebar; drag papers and folders to reorganize; context menu to rename, remove, or move a folder to the root.
- **Editors** — **Block** view (line/block-oriented) or **Source** view (raw markdown); toggle with **Ctrl+Shift+V**.
- **Card syntax (in the paper)**  
  - Basic: `Question >> Answer`  
  - Reversible: `Term <> Definition`  
  - Cloze: `{{c1::text}}` or simple `{{blank}}` forms  
- **Generate** — Creates or updates Anki notes from the paper (**Ctrl+G**); respects your **Settings** when Anki edits and the paper disagree.
- **Images** — Insert markdown images; pick or paste into the collection media folder where supported.
- **Search** — Command-style search in the sidebar: free words, quoted phrases, `title:`, `folder:`, `deck:`, `tag:`, negation (`-term`), and ` OR ` between alternatives; opens in a small overlay for comfortable typing.
- **Welcome screen** — Quick start, syntax cheat sheet, recent papers, and local find-by-title when no paper is open.
- **Import / export** — Import a `.md` file as a new paper; export paper markdown; export to **PDF** (where the host environment supports it).
- **Browser link** — Jump from a card reference to Anki’s **Browse** with the matching note.
- **Settings** — Default deck, autosave interval, font, editor theme, separators, and conflict policy (**Ctrl+,**).

---

## How to open it

After installation, open **Anki Papers** from:

- **Tools → Anki Papers** (menu), or  
- The **Papers** toolbar button, or  
- **Ctrl+Shift+P**

---

## Requirements

- **Anki** meeting the version in `manifest.json` (currently **min_point_version 231000** — check **Help → About** in Anki).
- A normal **desktop Anki** build with **Qt WebEngine** (standard for official packages).

---

## Tips for new users

1. Create a paper from the sidebar (**+ Paper**) or the welcome screen.  
2. Write markdown freely; add card lines with `>>`, `<>`, or `{{…}}`.  
3. Choose the **deck** in the header when you want cards to land somewhere other than the default.  
4. Press **Ctrl+S** to save and **Ctrl+G** to generate cards into the collection.  
5. Expand **Search syntax** under the sidebar search pill to learn advanced queries.

---

## Privacy and data

Your papers and local add-on data live under Anki’s add-on / profile storage (e.g. `user_files` inside the add-on folder). Nothing is sent to external servers by the add-on itself unless you use actions that open a normal browser link (for example a support page).

---

## Author and support

- **Author:** Ankizium
- **License:** MIT (see `LICENSE` in the package)

If you publish the add-on on AnkiWeb, add your **support thread**, **issue tracker**, or **Ko-fi / donation** link in the listing so users know where to report bugs or ask questions.

---

## Short blurb (copy-paste for “summary” fields)

*Write markdown papers inside Anki, organize them in folders, and turn lines into Basic, reversible, and cloze cards with simple syntax—then generate to sync notes to your collection. Block or source editor, advanced search, import/export, and PDF export.*
