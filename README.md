<p align="center">
  <img src="AnkiPapers logo.svg" alt="Anki Papers Logo" width="200"/>
</p>

# Anki Papers

Write notes as **markdown papers** inside Anki. Mark the lines worth remembering and press **Add Cards to Anki** — those lines become **Basic**, **reversible**, **cloze** and **list** cards in your collection, and pressing it again later updates the same cards rather than making new ones.

Papers **link to each other**: highlight a phrase, point it at a heading in another document, and follow it with a double-click. A **Links panel** shows what cites the open paper, and a **graph view** shows how the whole library connects.

Your papers are **plain markdown files on your own disk**, in folders that match the ones in the sidebar — readable in any editor, diffable, and yours to back up however you like.

**Author:** Dr. Ahmed Benarab

---

## Contents

- [What's new](#whats-new)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Writing cards](#writing-cards)
- [Organizing a paper](#organizing-a-paper)
- [Context on your cards](#context-on-your-cards)
- [Linking papers](#linking-papers)
- [The hidden anchors](#the-hidden-anchors)
- [Links panel and graph](#links-panel-and-graph)
- [Searching](#searching)
- [Saving and generating](#saving-and-generating)
- [Where your papers live](#where-your-papers-live)
- [Exporting](#exporting)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Settings](#settings)
- [Building](#building)
- [Project layout](#project-layout)
- [Syntax quick reference](#syntax-quick-reference)
- [Developers](#developers)

---

## What's new

**List cards: learn things in order, one item at a time.** Write a line, then indent `+` items under it. The line becomes one list card, and each item is its own Anki card with its own schedule, much like RemNote's list-answer cards. In review the prompt stays on screen: Space shows the next item, you rate it, and the next one comes up until the list is done. See [List cards](#list-cards--items).
- **In order, on one screen.** Whichever item Anki offers, the review starts at the first one that's due and walks down the list. Items that aren't due are skipped but stay visible as context, labelled "not due". The items you've rated show their ratings.
- **Each item is its own card.** Forgetting item 3 doesn't reset items 1 and 2. Reword, reorder, insert or delete items and each one keeps its own review history.
- **Its own capsule.** Each item line shows its own lapses, flag and ⓢ, with an **ITEM** label. The prompt line sums them up: the weakest item, one flag per color with how many items carry it, how many are suspended, N̸ for `[[NH]]`, and **LIST · 5**. Card Type Badges hides the LIST and ITEM labels like the others.
- **Flags on items.** `flag:red` on an item line flags just that item's card. Under a flagged heading or prompt every item gets the flag, and an item's own flag wins.
- **On your phone.** AnkiMobile, AnkiDroid and AnkiWeb don't run add-ons, so there each item comes up as an ordinary card in Anki's own order. Each card still shows the prompt and the items above it, and hides the ones below.

**Tag Shortcuts: your own question tags.** Settings → Cards now has a table of shortcuts, each with the tag it stands for: `uw` → `UWorldABIM`, `ab` → `AMBOSS`, `nb` → `NBME`, whatever your question banks are. Type a shortcut, two colons and an id at the end of a line, then Space: `uw::3252` tags that line's cards and every card under it `UWorldABIM::3252`, the same `::` nesting Anki uses. See [Question tags on headings and lines](#question-tags-on-headings-and-lines).
- **Deeper levels** carry over: `uw::Cardio::3252` gives `UWorldABIM::Cardio::3252`.
- **One-to-one:** no shortcut twice and no tag twice (capitals don't count, as in Anki), and no tag inside another, since `UWorld` and `UWorld::ABIM` could make the same tag. `flag`, `ap`, `nh` and cloze names like `c1` are taken.
- **Rename freely:** change a shortcut's tag and the next Generate moves your cards to the new name instead of leaving the old tags behind.
- **Per paper or folder:** right-click it in the sidebar → **Tag shortcuts…** to give any shortcut its own tag there, say `uw` → `UWorld_Step1` in your Step 1 folder.
- **A shortcut you deleted** tags nothing; Generate names the lines that still use it.
- **Changed:** the comment is now `<!--uw::3252-->` with two colons, and the typing shortcut is `uw::3252`. The old `<!--uw:3252-->` and `uw3252` no longer work: change old lines to the new form **before** your next Generate, or their cards lose those tags.

**Everything about a card in one capsule.** The right edge of each card line now holds a single capsule with everything known about the card, in compartments divided by thin rules: **⚠ 3** for lapses (red for a leech), the card's **flag** in its color, **ⓢ** when it's suspended, **N̸** for `[[NH]]`, and the card **type**. Only what applies is shown, and a setting that's off (Weak-Spot Markers, Suspended Cards, Card Type Badges) leaves its compartment out. Rest the pointer on a compartment for what it means: "This card has 3 lapses.", "This card is flagged blue.", "These cards are suspended." The open-in-Anki button sits just outside.
- **`[[NH]]` no longer shows as text** on the page; it's the N̸ in the capsule. Click into the line to see or edit it.
- **The text wraps before the capsule**, so a long line never runs underneath it, however many compartments it has.
- **The flag shown is Anki's.** Once a card is in Anki the capsule shows the flag it really has there, including one from a heading; a flag you clear in Anki disappears from the capsule. Before the card is in Anki, it shows the flag the paper will give it.

**Flags and question tags on any line.** `flag:blue` and `uw::3252` now work at the end of any line of text, not just headings: a card, a bullet, a sentence. On a card's own line they flag or tag that card.
- **The line beats the heading:** a card with its own `flag:blue` stays blue under a `flag:red` heading. The nearest flag wins, the card's own line first.
- **Question tags add up:** a card is tagged with its own line's ids and every heading's above it.
- **A flagged bullet** flags the cards indented under it, just as a heading does.
- **Cleared in Anki:** clear the flag on every card of a flagged line and the comment comes off that line, as it does for a heading.
- Not on a picture, a bare link, a divider, a table or a ``` fence, where a comment would change what the line is, and not inside a `{{cloze}}`.

**UWorld question tags and flags on headings.**
- **Question tags:** at the end of a heading, type `uw::3252` and press Space or Return. It turns into a hidden `<!--uw::3252-->`, and at Generate every card under the heading (everything indented beneath it, nested headings included) is tagged `UWorldABIM::3252`. Add more the same way (`uw::4410`) or several at once (`uw::3252,4410`). Take an id off the heading and its tag comes off those cards at the next Generate; tags you added yourself in Anki are never touched. Searching `3252` finds the heading. See [Question tags on headings and lines](#question-tags-on-headings-and-lines).
- **Flags:** type `flag:red` at the end of a heading (any Anki flag: red, orange, green, blue, pink, turquoise or purple, or 1–7; `flag:none` takes it off) and Generate flags every card under it. A flag you clear in Anki stays cleared, and once every card under a heading has been cleared there, the heading loses its flag too. See [Flags on headings and lines](#flags-on-headings-and-lines).
- Both stay out of sight: they never show on the page, on cards, in breadcrumbs, the outline or the PDF. Click into the heading to see or edit them.

**`[[…]]` is a card tag only.** Typing `[[` no longer opens a paper picker, and `[[Paper title]]` no longer links to a paper; it stays plain text. `[[tag]]` and `[[NH]]` work as before. To link papers, use right-click → **Create link…**.

**Flags and suspended cards at a glance.**
- **The flag rule:** the line beside the line numbers turns the color of a heading's flag (a dark red, neon orange or neon green, and the rest of Anki's flags) from the heading down through everything under it. Blank lines inside the section keep the color, and a flagged subheading shows its own color within its stretch.
- **A card's own flag:** a card you flagged in Anki yourself, during review say, shows a small flag in that color beside its badge, whenever the heading's rule doesn't already say so.
- **Suspended cards:** a card line whose cards are suspended in Anki fades and gets a ⓢ; hover it for what it means. A heading whose cards are all suspended says **ⓢ All suspended** at its right edge (or "3 of 8 suspended" when only some are).
- **Card counts:** every H1, H2 and H3 shows the number of cards under it at its right edge; hover the number for "This section has 29 cards."
- **Outline:** a dot in each flagged heading's color, left of its name (weak-spot dots stay on the right), and fully suspended topics faded.
- **Settings → Editor:** **Card Counts** and **Suspended Cards** turn those parts off, and **Suspended Card Opacity** sets how faded a suspended line looks (85% to start).
- **Always current:** suspend, unsuspend or unflag something in Anki's Browser, come back to Anki Papers, and the page catches up straight away — no Generate needed.

**Every line shows its own card's state.** The editor now finds each line's Anki note by the line's own hidden card name. Before, it went by the line numbers saved at the last Generate, so after adding or removing a line, the lines below could show their neighbor's suspension, flag or weak-spot marker, and open the neighbor's note in Anki.

**Card type badges can be hidden.** Settings → Editor → **Card Type Badges** takes the Basic, Reversible and Cloze label out of each card's capsule, for a cleaner page. The capsule's other compartments and the open-in-Anki button stay.

**Enter at the start of a card line keeps its indent.** The blank line it leaves above now sits at the line's own indentation instead of jumping to the left margin, level with the H1s, and Tab works on it again. The card's hidden name moves down with its text, so the card stays attached to the right line.

**The guide has a window of its own.** Press the **?** button at the top of the sidebar (beside Home and Settings) to open it: topics down the left, the chosen one on the right, like Settings. It reopens on the topic you read last. The home page keeps a short **Start here** under the greeting with the four ways to mark a line, and an **Open the guide** link.

**Generate Cards is now Add Cards to Anki.** The button that turns your card lines into Anki cards says what it does. It works exactly as before: it saves the paper, then creates, updates and removes that paper's cards. `Ctrl+G` still runs it, and a folder's right-click menu now reads **Add all cards in folder to Anki**.

**Image occlusion from your pictures.**
- **Create Image Occlusion Cards:** hover over a picture in a paper and click **Occlude** in its top-right corner, or right-click it and choose **Create Image Occlusion Cards**. Anki's Add window opens on its built-in **Image Occlusion** note type, with the picture already in the mask editor and the deck set to the paper's deck. Draw your masks and press Add. See [Image occlusion](#image-occlusion).
- **A count on the picture:** once a picture has occlusion cards, a small badge in its lower-right corner shows how many. It updates by itself when you add, edit or delete them in Anki.
- **Click the badge to edit:** it opens those notes in Anki's Browser with the masks showing. Right-click → **Edit Image Occlusion Cards** does the same.

**Draft cards with AI, sources beside your paper, and Ask.**
- **Draft cards:** select some lines (or click into one) and press **Draft cards** on the toolbar, choose it from the right-click menu, or press `Ctrl+Shift+D`. Card lines written in your syntax (`>>`, `<>`, `{{c1::…}}`) appear under the passage as dashed drafts. They aren't saved and Add Cards to Anki skips them until you accept one (✓), which turns it into an ordinary line. Click a draft to edit it (Enter saves and accepts, Escape stops editing), ✗ discards it, ↻ redoes just that card, and Accept all / Discard all / Redraft work on the whole group. The bottom bar counts drafts apart from your cards.
- **Sources:** the paperclip on the toolbar opens the Sources panel. Attach a PDF, Word, PowerPoint, HTML or text file, or a web page, to the open paper; files are copied into your Anki Papers folder and stay with the paper. PowerPoint and Word open in a reader view (slides with their speaker notes), and web pages are saved as a copy you can read offline. Select text in a source to **Add to notes**, **Draft cards** or **Ask**; lines added this way remember where they came from, and **Go to source** (right-click) reopens the page with the passage highlighted.
- **Folder sources (books and courses):** right-click a folder for **Attach a book…** (a PDF), **Attach a web source…** (a Microsoft Learn course or learning path, a docs site, or any page that links to its chapters) or **Attach a file…**. Every paper in the folder sees the folder's sources, labeled "from <folder>". A book or course is split into chapters (from the PDF's bookmarks, or the course's modules), each matched to the paper that covers it; that paper then opens the source at its own chapter. The chapter bar above the paper (previous / next chapter) shows when you turn it on; see below. Name a new paper after a chapter and it links itself; turn on **Settings → Chapters waiting for a paper** to also see the chapters without a paper, faded in the sidebar, and create one with a click. A course's learning paths can stay as headings or become sub-folders.
- **Ask:** the speech-bubble button (or `Ctrl+Shift+A`) opens a chat about the open paper. Chips choose what it reads: this paper, the source open in the Sources panel, the whole chapter, the papers this one links to. Answers cite `line N` and source pages as chips that jump there; "Stick to my sources" makes it say when your material doesn't cover something. Any answer can be inserted as an `&&` supplement or sent to Draft cards. Nothing goes into Anki directly.
- **Settings → AI:** choose Claude, Gemini, DeepSeek, or any OpenAI-compatible endpoint (OpenAI, OpenRouter, or a local model in Ollama or LM Studio), paste your API key and press **Test connection**. On a Mac the key is kept in the macOS Keychain, never in the add-on's settings files. Anki Papers' own Python calls the provider over HTTPS; there's no server in between, and nothing to install. Card rules, the card types it may write, and the language are yours to set. Turn AI features off and every AI button disappears; sources keep working without AI.
- **Folders can be ten levels deep** (it was three).
- **Learning paths in sub-folders:** when a course's learning paths have their own sub-folders (say `AI-901/1. AI Concepts` and `AI-901/2. AI Apps & Agents`), each path is matched to its sub-folder by name or by where its papers already are. With **Settings → Chapters waiting for a paper** turned on, modules that don't have a paper yet show faded inside their own learning path's folder, in course order, and a paper made for one is created there. You can change which folder a path uses when you attach the course, or later from the folder's right-click menu → **Learning paths and sources…**.
- **Books show their whole outline:** **Attach a book…** lists every bookmark in the PDF (parts, the chapters inside them and their sections), indented, with printed page numbers. Choose the paper for each one; papers whose names match are filled in, and anything set to "Not a chapter" is left out.
- **The chapter bar is yours to show:** the line above a chapter paper (which book, which chapter, previous / next) is off by default, keeping the single-toolbar look. Turn it on for one paper with the book button in the toolbar (the choice is saved with the paper), or for every chapter paper with **Settings → Chapter Bar**. While that setting is on, the toolbar button is grayed out.
- **Removing a book or web source:** right-click the folder → **Remove "…"**, or use the bin icon in the Sources panel. Your papers and their cards aren't changed.

**Weak spots and an outline.**
- **Weak-spot markers:** lines whose cards you keep missing in Anki get an amber edge and a "3 lapses" tag; a leech Anki has suspended gets a red one. Rest the pointer on one and its review history opens above the line (times you pressed Again, ease, last review, next due) with **Open in Anki**, and **Unsuspend** for leeches. When a paper has weak spots, a **"⚠ N weak spots"** button appears in the bottom bar: click it to show only those lines and the headings they sit under, click again for the whole paper. It only reads Anki's review history; nothing changes unless you press Unsuspend. Settings → Weak-Spot Markers turns it off.
- **Outline:** the sidebar has a **Papers | Outline** switch. Outline lists the open paper's H1–H3 headings with their card counts and an amber or red dot where there are weak spots; click one to jump there, and the heading you're reading stays highlighted as you scroll. The collapsed sidebar has an outline button too.
- **Search this paper:** on the Outline tab the search box reads **"Search <paper name>…"** and searches only the open paper (including unsaved edits), listing each match as `H1 › H2 › H3 · line N`. The Papers tab still searches everything; each tab keeps its own search.
- Clicking a line still edits it, exactly as before; the weak-spot box closes as soon as you do.

**Every color scheme has a Basic and a Solarized card style.** Pick a color scheme, then Basic or Solarized under Card style: Carolina, Crimson and Black & white each get their own Solarized palette (same monospace layout, the scheme's colors; Black & white draws a real underline), and Original purple keeps the classic Solarized.

**Four color schemes.** Settings → Color scheme picks **Original purple**, **Black & white** (grayscale, keeping the green / amber / pink card-type colors), **Carolina blue** (the default) or **Crimson** (crimson & white, with violet cloze and blue links so neither blends into the red), in both Dark and Light. The Basic card style on your Anki cards follows the scheme, and every card restyles when you save the setting. Source view is now plain black text on a white page in every scheme and theme. The Settings window also fits on short screens now: only its middle scrolls, so the title and Save button are always in reach.

**Carolina blue and #19468D.** A Carolina blue (#4B9CD3) and #19468D colorway in both themes: deep #19468D-tinted navy with Carolina accents in dark mode, and #19468D accents on pale blue-white in light mode. Reversible cards are now amber and document links violet, so neither blends into the blues. The **Basic** card style follows suit — #19468D headings (pale Carolina in night mode), a Carolina bar beside `&&` notes, amber reversible answers and violet links — and reaches every existing card the next time you Generate. The Solarized card style is unchanged.

**A new home page.** A greeting with **New paper** and **Import**; tiles for your papers, your cards (split into basic, reversible, cloze and list) and the paper you last generated; your three most recently edited papers; and a **heatmap of the cards you've made**, six months at a time with arrows to step back through your history one month per click. One square per day (Sunday at the top of each column, Saturday at the bottom); hover a square for that day's count. Above it: your current streak (consecutive days with at least one new card), the average per day in that streak, and the cards and average per day for the month on the right. "Cards" here means lines turned into cards, counted from Anki's own record of when each note was created, so the history reaches back to your very first card. The guide now sits at the bottom as a row of topics that open in place.

**Search finds the exact line.** Sidebar search now lists every matching line as `Document › H1 › H2 › H3 · line N` instead of a text excerpt, and clicking one opens the paper fully unfolded, centered on that line, which flashes briefly so you can spot it. See [Searching](#searching).

**Line numbers.** A gutter down the left of the editor and Source view shows each line's number in the paper. Folded sections leave a gap, so a number always means the same line, and it's the same number search shows. Settings → Line Numbers turns them off.

**One toolbar, Chrome-style tabs.** The title box and the separate header row are gone. Everything now sits in a single toolbar under the tabs: back and forward, the deck picker, then every formatting button, with Editor/Source, import and export, the Links panel and the source panel at the right end. The deck picker stretches to fill the spare room, and on a narrow window the right-hand group wraps onto a second line as one piece. Tabs are shaped like Chrome's: the active tab flows into the toolbar below it. **To rename a paper, right-click its tab and choose Rename**, type the new name, and press Enter (Esc cancels). The rename saves straight away, and links to the paper keep working because they point at the paper, not its name. The bottom of the window is now one bar too: status on the left, the card count in the center, and Save and Generate Cards on the right.

**Bold and italic are saved as `<b>` and `<i>` tags.** `Ctrl+B`, `Ctrl+I` and the toolbar buttons now write `<b>bold</b>` and `<i>italic</i>` — the same tags Anki's own editor uses, and the same way underline, subscript and superscript work — and pressing them again removes the formatting. Older `**bold**` and `*italic*` still display correctly. To bring existing papers in line, **Settings → Bold & italic format → Convert old bold & italic** rewrites them once: it shows how many it found and asks first, saves a backup of every paper to `<profile>/ankipapers/backups/`, and leaves code and maths untouched. Your cards look exactly the same afterwards. Nested formatting such as underlined subscript now also displays correctly in the editor and PDF.

**Generate a whole folder at once.** Right-click a folder in the sidebar and choose **Generate all cards in folder** to make the cards for every paper in that folder and all its subfolders. You confirm once. If some of those cards were edited in Anki and your conflict setting is *Ask*, you get one combined dialog for the whole folder and make one choice for all of it; any other setting is simply followed. A progress bar then names each paper as it's generated — keep Anki Papers open until it finishes; closing waits for the run to complete. A summary at the end totals the created, updated and removed cards, and lists any paper that couldn't be generated and why, while the rest still finish.

**Solarized Styling for your cards.** Settings → Card Style now offers Solarized Styling alongside the built-in Basic look: a monospace, color-coded card where bold, italic, underline and cloze answers each get their own color, and the heading breadcrumb sits quietly above the card in small capitals. It's light when Anki is in light mode and dark in dark mode, with every text color chosen to stay comfortably readable on its background. Saving the setting restyles every Anki Papers card at once, and the style syncs to AnkiWeb and your phone with the cards. Switching back to Basic restores the original look exactly. The design is adapted from Shamim Ahmed's [How to Design Beautiful Anki Cards](https://medshamim.com/med/how-to-design-beautiful-anki-cards) (2018).

**Your macOS Text Replacements work in the editor (Mac only).** The shortcuts you've set up in System Settings → Keyboard → Text Replacements now expand in Anki Papers: type a shortcut, then Space or Return, and it becomes its phrase. Control+Z brings the shortcut back. It needs a whole word, so `,sig` expands but `word,sig` doesn't, and it never fires inside code or math. Edits you make in System Settings are picked up when you return to the window. macOS doesn't do this on its own here, because Anki's web engine never asks macOS for the list. If you also use a text expander such as aText, keep each shortcut in only one of the two so they don't both fire. It's on by default, and Settings can turn it off.

**Underline.** Highlight text and press `Ctrl+U` (the Control key on a Mac too), or use the new underline button between italic and strikethrough. Press it again to remove it. It's saved as an ordinary `<u>` tag, so it shows as a real underline on your Anki cards, in the PDF, and in other markdown apps.

**Subscript and superscript.** Highlight text and press `Ctrl+5` for subscript or `Ctrl+6` for superscript (the Control key on a Mac too), or use the two new toolbar buttons beside strikethrough. They work like Word: press the same one again to remove it, or the other one to swap. With nothing highlighted, you get a placeholder to type over. They are saved as ordinary `<sub>` and `<sup>` tags, so they show up on your Anki cards, in the PDF, and in other markdown apps such as Obsidian. A card whose question ends right against the separator, like `CO<sub>2</sub>>> a gas`, now splits in the right place.

**Tabs.** Every paper you open gets a tab above the editor, so you can keep several papers at hand and switch between them with a click. Following a link to another paper opens it in a tab right next to the one you came from, and the paper you left stays open. Close a tab with its × or a middle-click; cycle with `Ctrl+Tab` and `Ctrl+Shift+Tab`; right-click a tab to rename its paper. Tabs have a fixed width, so five fit across a full-screen window and the strip scrolls sideways beyond that (with the mouse wheel or trackpad). Open tabs are remembered between sessions.

**Unsaved changes at a glance.** A dot on the active tab means the paper has edits that have not yet reached disk. It clears on `Ctrl+S`, on autosave, and whenever you switch papers, since switching always saves first.

**Back and forward.** After following a chain of links, `Ctrl+Alt+←` and `Ctrl+Alt+→` (or the arrows at the left of the toolbar, or a mouse's back and forward buttons) retrace your steps, landing on the same line each time.

**Renaming a heading keeps its links readable.** Links quote the heading they point at. When you rename a heading that other papers link to, saving (or leaving the paper) offers to update every link that still reads the old name. Links whose text you wrote yourself are left alone.

**Papers are files on your disk.** Every paper is now written to `<profile>/ankipapers/papers/` as a `.md` file, in real folders mirroring the sidebar, with a small `.ap.json` beside it. The editor reads those files directly. A copy still goes into the Anki collection and rides along to AnkiWeb as a backup. See [Where your papers live](#where-your-papers-live) — and if you were using Anki Papers before this version, there is a **one-time step** to copy your existing papers out.

**Cards keep their identity when you reword them.** Generate used to recognize a card only by its text being byte-for-byte identical, so editing a line destroyed the old card and built a new one — losing its review history, and in some cases leaving a duplicate behind. Every card line now carries a permanent hidden name, so Generate updates the card you edited instead of replacing it. Existing papers adopt this silently on their next Generate: nothing is created, updated, or deleted.

**PDF export** renders the document as it appears in the editor — indentation, tables, images, and cards as clean question-and-answer blocks — on Letter paper with half-inch margins.

**Closing the window can't lose work.** Anki Papers now waits for an in-flight save or generate to finish before the window closes, and offers to keep waiting if it is taking a while.

**Paste as plain text.** `Ctrl+Shift+V` (`⇧⌘V` on a Mac) pastes the clipboard onto a single line, turning every line break into a space — for paragraphs lifted out of a textbook or PDF, where the breaks are just where the column ended. It rejoins hyphenated words split across a break and leaves real compound hyphens intact. `Ctrl+V` is unchanged and still pastes one block per line. Also on the right-click menu.

**Pictures on cards.** An image indented under a card now rides along with it, with no `&&` prefix needed, and changes to it reach cards that already exist — adding, swapping or removing a picture updates the note in place instead of requiring you to delete and rebuild the card.

**Tables shrink to fit and sit centered**, with S / M / L / Full width caps on hover (40 / 60 / 80 / 100%). Pressing Enter at the end of a table now steps out of it instead of quietly breaking it apart.

**A collapsible sidebar.** `Ctrl+\` folds the folder tree down to an icon rail, or drag its edge to any width you like. Hovering the rail slides the tree out over the editor without reflowing your text, and both the width and the collapsed state persist.

**Expand-all works everywhere, and now has a matching collapse-all.** `Ctrl+Shift+↓` unfolds a whole document on Windows, Linux, and macOS — it was previously `⇧⌘↓` and macOS-only. `Ctrl+Shift+↑` (`⇧⌘↑` on a Mac) is the mirror image: fold everything back to the outline the document opens with.

**Two editing bugs fixed.** Inserting an image on an indented line no longer knocks that line back to the left margin — the image lands at the cursor and the line keeps its place, the same as every other formatting button. Pasting a long block of outside text no longer collapses unrelated sections elsewhere in the document; a paste is an edit, not a new document, so it now leaves your folded and unfolded sections exactly as you left them.

---

## Requirements

- **Anki** compatible with [`manifest.json`](manifest.json) → `min_point_version` (compare with **Help → About**; this repo currently targets **231000**).
- **Qt WebEngine** (bundled with standard Anki desktop builds).

## Install

### Option A — `.ankiaddon` package

1. Build the package (see [Building](#building)) or take a release artifact from GitHub.
2. In Anki: **Tools → Add-ons → Install from file…** and choose `Ankipapers.ankiaddon`.
3. Restart Anki if prompted.

### Option B — From this repository

1. Clone or download the repo.
2. Copy the **folder** (the one containing `__init__.py` and `manifest.json`) into your Anki add-ons directory:
   - **Windows:** `%APPDATA%\Anki2\addons21\Ankipapers`
   - **macOS:** `~/Library/Application Support/Anki2/addons21/Ankipapers`
   - **Linux:** `~/.local/share/Anki2/addons21/Ankipapers`
3. Make sure the built UI exists under `web/` (it is committed here). If you removed it, run a [UI build](#building-the-web-ui) first.
4. Restart Anki.

Open it from **Tools → 📝 Anki Papers**, the **📝 Papers** toolbar link, or **Ctrl+Shift+P**.

---

## Quick start

Make a paper, type this into it, and press **Ctrl+G**:

```markdown
# Iron deficiency anaemia

## Diagnosis
Most useful single test for iron deficiency >> Serum ferritin
Ferritin is an {{acute phase reactant}}, so it rises with inflammation
    && A normal ferritin does not exclude iron deficiency in active
       inflammation. Transferrin saturation helps in that setting.

## Treatment
Oral iron is best absorbed with {{c1::vitamin C}} and worst with {{c2::tea}}
Ferrous sulfate <> 65 mg elemental iron per 325 mg tablet
```

Five cards appear in Anki. Edit any line, press Ctrl+G again, and that same card updates — its review history intact.

---

## Writing cards

Each of these turns **one line into one card**. Mix them freely.

| You write | You get |
|---|---|
| `Question >> Answer` | A basic card. Everything before `>>` is the front, everything after is the back. |
| `Term <> Definition` | Two cards, asked both ways round. Good for vocabulary and names. |
| `Blood loss causes {{anemia}}` | A cloze card: the braced words are hidden, the rest of the sentence stays as the clue. |
| `{{c1::this}} and {{c2::that}}` | Numbered cloze — everything marked `c1` hides on one card, `c2` on another. Same number, hidden together. |

Anything you don't mark stays plain text and never becomes a card.

### List cards (`+` items)

For anything you have to know in order: steps, layers, branches, a differential in a fixed sequence. Write a prompt, then indent `+` items under it:

```
Layers of the epidermis, deep to superficial
    + Stratum basale
    + Stratum spinosum
    + Stratum granulosum
    + Stratum lucidum
    + Stratum corneum
```

The prompt line becomes one **AnkiPapers List** note, and every `+` item one card of it, with its own schedule.

- **Reviewing.** The prompt stays on screen and you go down the list: press Space to show the item, rate it, and the next one comes up, until the list is done. Whichever item Anki offers, the review starts at the first one that's due. Items that aren't due are skipped; every item above the one you're on is shown anyway, as context. Anki's *bury siblings* option is ignored for lists, so rating item 1 doesn't push the rest to tomorrow. Undo steps back one item.
- **Each item is its own card.** An item you rate Again comes back on its own after its learning step, still showing the items above it. Rewording, reordering, inserting or deleting items keeps each item's review history with that item, because each one is matched by its [hidden anchor](#the-hidden-anchors), not its position. A deleted item's card is removed.
- **Under a heading** the `+` lines can sit right below it without an indent: `## Branches of the aortic arch` followed by `+ Brachiocephalic trunk` and so on.
- **A card line can have items too.** `Epidermis >> five layers` with `+` items under it makes the basic card *and* a list card whose prompt is its question side.
- **Other lines under the prompt keep their jobs.** `-` bullets stay notes and `&&` lines are the list's supplement. Lines nested under an item aren't items, and a `+` inside a ``` fence is code.
- **Typing.** Enter at the end of an item starts the next `+` item; Enter on an empty one ends the list.
- **In the editor** each item shows a capsule of its own (lapses, flag, ⓢ, **ITEM**), and the prompt line sums them up: the weakest item, one flag per color with how many items carry it, how many are suspended, N̸ for `[[NH]]`, and **LIST · 5**. Hover an item for its review history, as with any card line. Weak items count in the weak-spot total and the Outline.
- **On AnkiMobile, AnkiDroid and AnkiWeb**, which don't run add-ons, each item comes up as an ordinary card in Anki's own order. Each card still shows the prompt and the items above it, and hides the ones below, so it works there too, just not as one walk down the list.

### `&&` supplements

A line beginning `&& ` is **background reading, not a question**. Indent it under a card and it rides along with that card's answer during review. It never becomes a card of its own.

```markdown
Drug of choice for Wolff-Parkinson-White with AF >> Procainamide
    && AV nodal blockers (adenosine, verapamil, beta blockers, digoxin) can
       accelerate conduction down the accessory pathway and precipitate VF.
```

This is the right home for the paragraph explaining *why* the answer is the answer — the part that makes a fact stick but would ruin the card if it were on the front.

### Pictures on a card

A picture indented under a card travels onto that card, arriving in the same place the `&&` notes do. **It needs no `&&` of its own** — a line holding nothing but an image can only mean "show this with the card above", so Anki Papers treats it that way.

```markdown
Normal velocity of sound in soft tissue >> ~1540 m/s
    && Bone is nearer 3000 m/s and lung nearer 700, which is why
       transitions between them reflect so strongly.
    ![velocity by tissue](velocity-chart.png)
```

Mix images and `&&` lines freely and in whatever order reads best — they reach the card in the order you wrote them, joined by line breaks. Several pictures under one card all come along.

Where the line sits is what decides its meaning. Indented under a card, it belongs to that card. On its own at any other level, it is simply part of the document — so illustrations that are not card material stay out of your reviews.

The picture button on the toolbar inserts an image at the cursor, and pasting an image from the clipboard copies the file into your Anki media folder for you. An `![](…)` you type by hand has to point at a file already in that folder, or the card shows a broken image.

Editing any of this on an existing card just works: add, swap or remove a picture, or reword a `&&` line, press Add Cards to Anki, and the card is updated in place with its review history intact.

### Tables

Ordinary markdown pipe tables, which means they also render properly on GitHub, in Obsidian, and in any other markdown viewer:

```markdown
| Ejection Fraction | Severity |
| --- | --- |
| > 50% | Normal |
| 40 - 49% | Mildly Reduced |
```

A table **shrinks to fit its contents and sits centered**, rather than stretching across the whole column. Hover it for **S / M / L / Full** buttons that cap how wide it may grow — 40%, 60%, 80% and 100% of the text column. The default is L. A table only reaches its cap when the content needs the room; past that the cells wrap.

The setting is recorded on the end of the header row:

```markdown
| Ejection Fraction | Severity |<!--ap-table:m-->
```

It is an HTML comment, so it stays invisible wherever the table is rendered, and Anki Papers hides it in the editor, on cards and in PDF export. It rides on the header row so that it travels with the table when the table is moved, copied or re-indented.

**Pressing Enter inside a table** adds an empty row below the one your cursor is in. **At the very end of the table** it steps out instead, opening a fresh line below at the table's own indentation.

### `[[tag]]` and `[[NH]]`

`[[tag]]` anywhere on a card line puts an Anki tag on that card, written as `AnkiPapers::tag`. Everything you'd normally use tags for — searching, building a filtered deck the week before an exam — works as usual.

`[[NH]]` is short for **no heading**. By default every card shows the headings it came from (see [Context on your cards](#context-on-your-cards)); add `[[NH]]` when that context would give the answer away. On the page it shows as **N̸** in the card's capsule rather than as text. The card is then written with no heading at all, on the question and the answer side alike. Adding or removing `[[NH]]` on a line that already has a card takes effect the next time you press Add Cards to Anki.

```markdown
## Hypertrophic cardiomyopathy
Murmur increases with Valsalva >> Hypertrophic cardiomyopathy [[NH]]
```

Without `[[NH]]`, the card would helpfully announce the answer in its own header.

### Question tags on headings and lines

Tie a heading, or a single card, to the qbank questions it came from, and its cards are tagged with them in Anki.

At the end of a heading (or any line of text), type a shortcut, two colons and the question id, then press **Space** or **Return**:

```markdown
## Hypertrophic cardiomyopathy uw::3252      ← as you type it
## Hypertrophic cardiomyopathy               ← what the page shows afterwards
```

The mark goes into a hidden comment on the heading (`<!--uw::3252-->`), which you see only while you're editing that line. At Generate, `uw` is swapped for its tag from your Tag Shortcuts and the rest is kept, so every card under the heading gets `UWorldABIM::3252`, and `tag:UWorldABIM::3252` in Anki's Browser finds exactly the cards from that question.

**Tag Shortcuts** live in Settings → Cards. Each row is a shortcut and the tag it stands for; it starts with `uw` → `UWorldABIM`. Add a row for each question bank you use:

| Shortcut | Tag | You type | Anki gets |
|---|---|---|---|
| `uw` | `UWorldABIM` | `uw::3252` | `UWorldABIM::3252` |
| `ab` | `AMBOSS` | `ab::L22` | `AMBOSS::L22` |
| `nb` | `NBME` | `nb::Form12::34` | `NBME::Form12::34` |

- **One-to-one:** each shortcut appears once and each tag belongs to one shortcut (capitals don't count, as in Anki). A tag can't sit inside another row's tag either: with `UWorld` and `UWorld::ABIM`, `uw::ABIM::12` and `ab::12` would make the same tag. A shortcut is one word of letters, digits and `_`, starting with a letter; `flag`, `ap`, `nh` and cloze names (`c1`, `c2`, …) are taken. Settings won't save until the table follows these rules, and says which row breaks them.
- **Renaming a tag:** change `UWorldABIM` to `UWorld` and the next Generate moves your cards' tags to the new name instead of leaving the old ones behind.
- **A shortcut that isn't in the table** (say you deleted the `ab` row) tags nothing. Generate says which lines still use it, and tags already on cards from it are left alone.
- **Only typed shortcuts in the table turn into marks**, so `std::vector` in a sentence stays as it is.
- **Which cards:** the ones the heading folds over, that is, every line indented beneath it, including cards under nested headings. A card under two tagged headings gets both sets of tags. A line at the same indent as the heading isn't under it.
- **Several questions:** type `uw::4410` on the same heading to add another, or `uw::3252,4410` at once. They share one comment; each shortcut gets its own (`<!--uw::3252--><!--ab::L22-->`).
- **Removing one:** click into the heading and delete the id from the comment. Its tag comes off those cards at the next Generate. Only tags under your Tag Shortcuts' names are managed; anything else on a note, including tags you added in Anki, is left alone.
- **Cards you already have** are tagged too: adding an id to a heading doesn't change any card's text, so Generate checks every card's question tags on every run.
- **Per paper or folder:** right-click a paper or folder in the sidebar → **Tag shortcuts…** to give a shortcut its own tag there, say `uw` → `UWorld_Step1` for your Step 1 folder. Leave a box empty to use the tag shown faintly in it. The paper's own wins, then the nearest folder's, then Settings, and the table must stay one-to-one there too. Cards move off the tag they had before at the next Generate.
- **Searching** for `3252` finds the heading, so you can look up where you wrote a question down.
- **On a card's own line**, `uw::3252` tags just that card (and anything indented under it). Tags add up: a card on a line tagged 5120, under a heading tagged 3252, gets both.

```markdown
## Hypertrophic cardiomyopathy<!--uw::3252-->
    Murmur louder with Valsalva >> HCM<!--uw::5120-->   ← tagged 5120 and 3252
```

The same works on a bullet or any other line with cards indented under it. It doesn't work on a picture, a bare link, a divider, a table or a ``` fence, where a comment on the end would change what the line is, nor inside a `{{cloze}}` or `` `code` ``.

**From an earlier version:** the comment used to be `<!--uw:3252-->` with one colon, typed as `uw3252`. That form is no longer read. Change those lines to `<!--uw::3252-->` before your next Generate; otherwise their cards lose those tags.

### Flags on headings and lines

Flag every card under a heading, or a single card, with one of Anki's flags. At the end of a heading (or any line of text), type `flag:` and a color, then press **Space** or **Return**:

```markdown
## Aortic stenosis flag:red      ← as you type it
```

| Type | Anki flag |
|---|---|
| `flag:red` or `flag:1` | Red |
| `flag:orange` or `flag:2` | Orange |
| `flag:green` or `flag:3` | Green |
| `flag:blue`, `flag:pink`, `flag:turquoise`, `flag:purple` (or `4`–`7`) | The other four |
| `flag:none` | Takes the flag off the line |

Like the question ids it becomes a hidden comment (`<!--flag:red-->`), and typing a new flag replaces the old one. At Generate every card under the heading gets the flag, including both cards of a reversible line and every card of a cloze. A card holds one flag, so the nearest one wins: the card's own line first, then the headings above it, nearest first.

```markdown
## Aortic stenosis<!--flag:red-->
    Crescendo-decrescendo murmur >> AS                 ← red, from the heading
    Pulsus parvus et tardus <> AS<!--flag:blue-->      ← blue: its own flag wins
```

A flag on a bullet, or any other line with cards indented under it, flags those cards the same way. On a [list](#list-cards--items) prompt it flags every item; on a `+` item line it flags just that item, and an item's own flag beats the prompt's or the heading's. Pictures, bare links, dividers, tables and ``` fences don't take a flag, and the shortcut does nothing inside a `{{cloze}}`.

You flag cards in Anki as well, so Generate follows a few rules to keep the two in step:

- **A new or changed flag in the paper** goes onto the cards.
- **A flag you clear in Anki stays cleared.** Generate only sets a flag when the heading's flag changed since the last Generate.
- **When every card a flagged line covers has been cleared in Anki**, the comment comes off that line too (a heading or a card's own line), and the message after Generate names it. If only some were cleared, the line keeps its flag and the cleared cards stay cleared. A card cleared this way doesn't pick up the heading's flag instead.
- **Taking the flag off a line** clears it from the cards that still show it, or hands them the flag of the heading above. A different flag you set on a card in Anki stays.
- Changing a heading's flag in the paper re-flags all of its cards, including any you had flagged differently in Anki.

In the editor, the line beside the line numbers takes the flag's color from the heading down through everything under it, so a red topic reads red from top to bottom; a card with its own flag shows its own color there. Each card's own capsule, at the right of its line, shows the flag Anki has for it, so a card you flagged or unflagged in Anki on its own is easy to spot. Suspended cards are shown too: the line fades and its capsule gets a ⓢ, and the heading above says "All suspended" when every card under it is (Settings → Editor → Suspended Cards and Suspended Card Opacity; Settings → Editor → Card Counts for the count on each heading).

### Image occlusion

Hide parts of a picture and get asked what's underneath, using Anki's own **Image Occlusion** (built into Anki 23.10 and later; no other add-on needed).

1. **Hover over a picture** in a paper and click **Occlude** in its top-right corner (or right-click it and choose **Create Image Occlusion Cards**). Anki's Add window opens on the Image Occlusion note type, with the picture loaded in the mask editor and the deck set to the paper's deck.
2. **Draw a mask** over each thing to hide, then press **Add**. Each mask (or group of masks) becomes one card.
3. **Back in the paper**, the picture shows a small badge in its lower-right corner with the number of occlusion cards made from it. It updates as soon as you add, edit or delete them in Anki.
4. **Click the badge** to open those notes in Anki's Browser, where the mask editor lets you move, add or remove masks. Right-click → **Edit Image Occlusion Cards** does the same.

Good to know:

- It works on pictures on a line of their own (`![caption](picture.png)`) that are stored in your Anki media folder. A picture inside a sentence, or a web image, doesn't get the menu item.
- If the Add window already holds a note you haven't added, finish or clear it first; Anki Papers won't throw it away.
- The occlusion notes are ordinary Anki notes. Add Cards to Anki never touches them, and deleting the picture's line from the paper leaves them in your collection.
- The badge counts occlusion notes whose Image field shows that picture, so you can make several notes from one picture and they all count.

### Images, formatting, and maths

- `![caption](picture.jpg)` — a picture from your Anki media folder, which also appears on the card. The toolbar's picture button inserts one at the cursor, and pasting an image from the clipboard copies it into your media folder for you.
- `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` `` all work inline, in the editor and on the card.
- `$x^2$` and `$$\int_a^b f(x)\,dx$$` become Anki's MathJax on the generated note.
- Blockquotes and `---` rules render in the editor and print. Tables have [their own section](#tables).

---

## Organizing a paper

Headings and indentation do two jobs at once: they keep the document readable, and they tell each card where it came from.

- `#` through `######` — six heading levels. One subject per `#`, its parts as `##`.
- **Tab / Shift+Tab** indent and outdent a line **together with everything nested under it**. A **blank line moves on its own** — it is not the parent of whatever happens to sit below it, so indenting one never drags that content along.
- Any line with more-indented lines beneath it is a **parent**, and papers open with parents folded, so a long document greets you as an outline. Click the chevron to open one section, or press **`Ctrl+Shift+↓`** to unfold the entire document at once.
- **Drag a block by its handle** to move it and its children.
- **Right-click a block** for edit, duplicate, merge, delete, and **Create link…**.
- **Ctrl+V** (**⌘V** on a Mac) pastes as copied: text with line breaks in it arrives as separate blocks, one per line.
- **Ctrl+Shift+V** (**⇧⌘V** on a Mac) pastes as plain text, flattened onto a single line — every line break becomes a space. Use it for a paragraph lifted out of a textbook or PDF, where the breaks are only where the column ended. It also rejoins words hyphenated across a break (`propa-` + break → `propagation`) while leaving real compound hyphens alone (`ST-` + break → `ST-elevation`), strips soft hyphens, and collapses runs of whitespace. Also on the right-click menu as **Paste as plain text**.

Large papers are fine: a document of ~1,100 lines with several hundred cards stays responsive while typing and while inserting lines.

The **Source** view (`Ctrl+Shift+E`) shows the whole document as plain text when you want to see exactly what you've written.

**Collapsing the sidebar.** `Ctrl+\` folds the folder tree away and gives the width to the document. It collapses to a 48-pixel icon rail rather than disappearing, so Home, Search, New Paper, New Folder and Settings stay one click away, and a dot on the folder icon tells you when a folder filter is active. Rest the pointer on the rail and the tree slides out *over* the editor — your text never reflows just because the cursor crossed the edge.

You can also drag the border between the sidebar and the editor to any width from 180 to 480 pixels; drag it far enough left and it snaps closed. The width and the collapsed state are remembered between sessions.

---

## Context on your cards

A generated card carries a **breadcrumb** of the headings it came from, so a bare fact arrives with the trail that makes it meaningful:

```
Cardiology › Electrophysiology › SVT › Atrial flutter
Ventricular rate in untreated typical flutter >> ~150 (2:1 block)
```

The breadcrumb is built from the heading structure above the line, and it updates when you reorganize the document. Add `[[NH]]` to a line to suppress it on that one card.

The same breadcrumb appears in the **Create link…** search results, so two headings called "Treatment" in different documents stay distinguishable — you see `Gastroenterology › IBD › Ulcerative colitis › Treatment`, not just "Treatment".

---

## Linking papers

### Creating a link

1. Click into a line and **highlight the phrase** you want to turn into a link.
2. **Right-click** it and choose **Create link…**.
3. Search for a target. Results are pre-filtered by the phrase you highlighted and show the full breadcrumb.
4. Pick one. The phrase becomes underlined.

You can link **from** body text or a heading, and **to** any heading at any depth or to a whole document. (`[[Paper title]]` used to link to a paper too; it's now plain text, and `[[…]]` is only for [card tags](#tag-and-nh).)

### Following a link

**Double-click** any word in a linked phrase to jump to its target. The destination line is briefly highlighted when you arrive.

Because double-click opens links, a *single* click on a linked phrase deliberately does not place the cursor there. To edit a line containing a link, click outside the link, or use **Edit block** from the right-click menu.

If a link's target has been deleted, following it says so rather than failing silently.

### How links survive editing

A link stores a hidden, stable anchor on the target line rather than a line number, so it keeps working after you:

- rename or reword the target heading,
- indent, outdent, reorder, or drag it,
- insert or delete lines anywhere above it,
- rename the target paper or move it to another folder,
- even move the heading into a **different** document.

### Links inside flashcards

A link inside a card line renders on the Anki note as styled text — the phrase, never the raw markdown. Links are not clickable inside Anki itself. Adding a link changes the line, so that card counts as edited and will update the next time you press Add Cards to Anki.

---

## The hidden anchors

Open a paper in a text editor and you will see comments like this at the ends of some lines:

```markdown
Most useful single test for iron deficiency >> Serum ferritin<!--ap:9f2c1a84-...-->
```

That is the line's **permanent name**, and it is the mechanism behind two things at once:

- **Links** point at anchors, not at line numbers, which is why they survive every edit listed above.
- **Card generation** matches your document against your collection by anchor, which is why rewording a card updates it instead of destroying it and building a replacement.

Anki Papers writes them for you and hides them everywhere it matters — the editor, generated cards, and PDF export all strip them. Copying or duplicating a block deliberately drops the anchor, so two lines can never claim the same name.

You do not need to think about them. But if you are editing papers outside the app, or reviewing a git diff, it is worth knowing what they are: **leave them attached to their lines.** Delete one and anything pointing at that line loses it, and the card on that line will be treated as new.

The first line of each file carries the same kind of marker for the paper itself (`<!--ap-paper:…-->`), which is what lets you rename or move a file on disk without breaking the links that point into it.

Headings and other lines can carry two more hidden comments, ones you write yourself: `<!--uw::3252-->` for [question tags](#question-tags-on-headings-and-lines) and `<!--flag:red-->` for [flags](#flags-on-headings-and-lines). They sit right after the line's text, before its anchor if it has one.

---

## Links panel and graph

The **link icon** near the right end of the toolbar opens the Links panel for the open paper:

- **Linked from** — every place that cites this paper, showing the citing sentence with the linked phrase highlighted and which heading it points at. Click to jump to that exact line in the citing document.
- **Links out** — what this paper points at, with broken targets flagged.

The panel's **Graph** button opens the link graph:

- **Documents** mode draws one node per connected paper; several links between the same pair merge into one thicker edge.
- **Headers** mode promotes each linked-to heading into its own node, tethered to its document, so you can see which section is actually being cited. Headings nobody links to stay out.

Hover a node to dim everything unrelated, type in **Find…** to highlight matches, drag nodes to rearrange, scroll to zoom, drag the background to pan, and double-click a node to open it. A counter along the bottom tallies links whose destination no longer exists, so you can find and mend them.

Both views are derived from the markdown itself — there is no separate link database that can drift out of sync with your text.

---

## Searching

The sidebar search takes more than plain words:

| Query | Meaning |
|---|---|
| `ferritin anemia` | Papers containing both words |
| `"acute phase reactant"` | An exact phrase |
| `title:cardiology` | Restrict to a field — `title`, `content`, `folder`, `deck`, or `tag` |
| `folder:"Cell Biology"` | Quote a field value containing spaces |
| `-pediatric` | Exclude papers matching this |
| `iron OR b12` | Alternative branches: `a b OR c d` matches `(a AND b)` or `(c AND d)` |

Every result is a place, not an excerpt: one row per matching line, reading `Document › H1 › H2 › H3 · line N` — for example `Endocrinology › Hyperparathyroidism › Workup · line 12`. Heading levels the line doesn't sit under are left out, so a line above the first heading is just `Document · line N`. Click a row to open the paper with every section unfolded, scrolled so that line sits mid-screen and briefly highlighted (in Source view, the cursor lands on it). Following a link, the Links panel, the graph and back/forward unfold only the sections around their target line. A paper that matches only by its title, folder, deck or tags gets a single row with badges saying which. A very common word shows the first 200 rows and says how many there are in all. Hidden anchors and link addresses are never searched; question ids on headings are, so `3252` finds the heading it's on.

---

## Saving and generating

- **Save** (`Ctrl+S`) writes the open paper. While it runs, both toolbar buttons gray out so adding cards can't start mid-save.
- **Add Cards to Anki** (`Ctrl+G`, called Generate Cards before) saves first, then creates, updates, and removes Anki notes for that paper.
- **Autosave** runs on a timer (interval configurable in Settings).
- **Closing the window** waits for any in-flight save or card adding to finish, and asks whether to keep waiting if it is slow.

If a save fails, the app says so rather than reporting success.

### What Add Cards to Anki actually does

For each card line in the document:

- **Unchanged** → left alone entirely.
- **Reworded** → the existing Anki note is updated in place. Its review history, scheduling, and note id are kept.
- **New** → a new note is created.
- **Line deleted from the paper** → its note is removed from Anki.

Cards are matched by their [hidden anchor](#the-hidden-anchors) first, falling back to exact text for papers written before anchors existed. Deletion is scoped to **the cards this paper created** — tracked individually, never by deck membership — so hand-made cards and other papers' cards sharing the same deck are never touched.

Changes that do not touch the card's own line — a reworded `&&` supplement, a picture added or swapped, a renamed heading above the card — are applied too. So are [question tags](#question-tags-on-headings-and-lines) and [flags](#flags-on-headings-and-lines) from its own line and the headings above it; the message after Generate counts the cards whose flag changed. Anki Papers records what each note's supplement and breadcrumb were when it last wrote them, which is how it tells a change you made in the paper from a change you made in Anki's Browser.

### When a card was edited in Anki instead

If you edit one of these notes in Anki's own browser and then press Add Cards to Anki, Anki Papers notices the note no longer matches the paper. Settings decides what happens: **preserve** leaves Anki's version alone, **overwrite** pushes the paper's text back over it, and **abort** stops before anything is added and lists the conflicts before anything changes.

---

## Where your papers live

Every paper is two files under your Anki profile folder:

```
<profile>/ankipapers/papers/Medicine/GI/Gastroenterology.md
<profile>/ankipapers/papers/Medicine/GI/Gastroenterology.ap.json
```

- The **`.md`** is the document and nothing else, so it stays pleasant to read, diff, and keep in git.
- The **`.ap.json`** beside it holds what markdown can't: the deck, tags, the true unaltered title and folder path, and the map from each line to its Anki note. That map is what stops Add Cards to Anki from destroying cards.

Folders in the sidebar are **real directories** on disk. Making, renaming, moving, or deleting a folder in the app does the same on disk.

The profile folder is used rather than the add-on folder because **Anki wipes an add-on's directory when it updates**. Papers kept there would not survive an update; papers in the profile folder do.

**The disk is what you see.** The editor reads these files, so a change you make to a `.md` in another editor shows up in Anki Papers.

**The collection is your backup.** A copy of every paper still goes into the Anki collection, which means it syncs to AnkiWeb with everything else and lands on your other devices. Nothing about the previous behavior was removed — disk storage was added in front of it.

> **A note on sync size.** The collection copy lives in a single collection-config entry, which Anki transmits on every sync and documents as intended for a few kilobytes. A large library will exceed that comfortably. It works, and it is a useful backstop, but if you sync often with a very large library, this is the part to watch.

### If you used Anki Papers before this version

Papers you wrote earlier live only in the collection until you copy them out once:

1. **Settings → Papers on disk**
2. **Preview** — reports how many papers would be written, how many card links they carry, and the exact folder, without changing anything.
3. **Write** — creates the files.

It only **adds** files. Nothing in your collection is modified or removed, so there is nothing to undo. Every save from then on writes itself to disk automatically.

Titles containing characters a filename can't hold (`/ \ : * ? " < > |`) get those characters replaced with `-` in the filename only; the true title is preserved in the `.ap.json` and is what you see in the app. Preview lists any title it adjusted.

### Deleting a paper

Deleting a paper removes its cards from Anki and moves its files into `ankipapers/papers/_deleted/` rather than erasing them, so a deletion you regret is recoverable from disk.

### Backing up

Because papers are ordinary files, any backup you already run covers them: Time Machine, a synced folder, or a private git repo pointed at `<profile>/ankipapers/`. The `.md` files diff cleanly, which makes git genuinely readable here.

---

## Exporting

The right end of the toolbar has three buttons:

- **Import Markdown** — bring an existing `.md` in as a paper.
- **Export Markdown** — write the paper back out as a `.md` file.
- **Export PDF** — render the document as a PDF.

The PDF is drawn by the same renderer as the editor, so what you see is what prints: indentation, tables, images, blockquotes, and inline formatting all carry over. Cards print as clean question-and-answer blocks. Editing marks — `[[tags]]`, `[[NH]]`, question ids, flags and hidden anchors — are stripped, images are embedded directly in the file so it stands alone, and the page is Letter with half-inch margins, always in light mode regardless of your editor theme.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Open Anki Papers (from Anki's main window) |
| `Ctrl+S` | Save the open paper |
| `Ctrl+G` | Add cards to Anki |
| `Ctrl+Shift+E` | Toggle Editor / Source view |
| `Ctrl+Shift+↓` | Unfold every collapsed section in the document |
| `Ctrl+Shift+↑` | Fold every section back up to the document's default outline |
| `Tab` / `Shift+Tab` | Indent / outdent the line and its children |
| `Enter` | Split the line at the cursor; the new line keeps its indentation |
| `Backspace` at line start | Outdent, then merge into the line above |
| `Ctrl+B` / `Ctrl+I` | Bold / italic (`<b>` / `<i>`) — press again to remove |
| `Ctrl+U` | Underline — press again to remove |
| `Ctrl+5` / `Ctrl+6` | Subscript / superscript — press again to remove |
| `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | Undo / redo |
| `Ctrl+V` / `⌘V` on a Mac | Paste as copied — one block per line |
| `Ctrl+Shift+V` / `⇧⌘V` on a Mac | Paste as plain text — flattened onto one line |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | Back / forward through papers you have visited |
| `Ctrl+\` | Collapse / expand the sidebar |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+D` | Draft cards from the selected lines (AI) |
| `Ctrl+Shift+A` | Ask about this paper (AI) |
| `uw::3252` then `Space` or `Enter`, at the end of a line | Tag that line's card and the cards under it `UWorldABIM::3252` at Generate (`uw` being one of your Tag Shortcuts) |
| `flag:red` then `Space` or `Enter`, at the end of a line | Flag that line's card and the cards under it at Generate (`flag:none` removes) |

> The `Ctrl` shortcuts above use the **Control** key on every platform, macOS included. The two pasting shortcuts are the exception: they follow the system paste key, so on a Mac they are `⌘V` and `⇧⌘V`. `Ctrl+Shift+↓` and `Ctrl+Shift+↑` also accept `⇧⌘↓` and `⇧⌘↑` there. On a Mac, `Ctrl+5` and `Ctrl+6` only work while macOS's "Switch to Desktop 5/6" shortcuts are off, which is the default.

---

## Settings

**Tools → Add-ons → Anki Papers → Config**, or in-app **Settings** (`Ctrl+,`):

| Setting | What it does |
|---|---|
| `default_deck` | Deck for new papers |
| `auto_save_interval_seconds` | How often autosave runs |
| `font_family` / `font_size` | Editor typeface |
| `editor_theme` | `dark`, `light`, or `auto` |
| `show_card_indicators` | The Basic / Reversible / Cloze / List / Item label in the capsule at the right of each card line (Settings → Editor → Card Type Badges; on by default) |
| `color_scheme` | `carolina` (default), `purple`, `mono` or `crimson`: colors the app and the Basic card style |
| `show_line_numbers` | Line numbers down the left of the editor and Source view (on by default) |
| `show_chapter_bar` | `false` (default): the chapter bar shows only on papers where the toolbar's book button turned it on; `true`: on every paper that is a chapter of its folder's book or course |
| `show_waiting_chapters` | `false` (default): hidden; `true`: chapters of a folder's book or course without a paper show faded in the sidebar |
| `toolbar_scroll` | `false` (default): the toolbar wraps onto a second line on a narrow window; `true`: one row that scrolls sideways |
| `anki_edit_conflict` | `ask`, `preserve`, `overwrite`, or `abort` when a note was edited in Anki |
| `card_style` | `basic` (built-in) or `solarized` (Solarized Styling), each in the color scheme's own version — restyles every card when changed |
| `text_replacements_enabled` | Mac only: apply your macOS Text Replacements as you type (on by default) |
| `show_heading_card_counts` | How many cards sit under each H1, H2 and H3, at the right edge of the heading (on by default) |
| `show_suspended_cards` | Fade suspended card lines and mark them ⓢ, say "All suspended" on headings, fade those topics in the Outline (on by default) |
| `suspended_card_opacity` | How visible a suspended line stays, 30–100 (85 by default) |
| `tag_shortcuts` | The [Tag Shortcuts](#question-tags-on-headings-and-lines): a list of `{"shortcut": "uw", "tag": "UWorldABIM"}` rows (that one by default), so `uw::3252` gives `UWorldABIM::3252`. Each row also keeps `old`, its earlier tags, so a rename moves cards off them. Edit it in Settings → Cards, which keeps it one-to-one |
| `ai_enabled` | Show the AI features (Draft cards, Ask). On by default |
| `ai_provider` | `anthropic` (Claude), `gemini`, `deepseek`, or `openai` (any OpenAI-compatible endpoint) |
| `ai_model_<provider>` | The model for that provider, e.g. `ai_model_anthropic` |
| `ai_base_url` | OpenAI-compatible endpoint address (empty means OpenAI) |
| `ai_card_types` / `ai_card_rules` / `ai_language` | What Draft cards may write, the rules sent with every draft, and the language of cards and answers |
| API keys | Not in the config: kept in the macOS Keychain (Settings → AI → Save key) |
| Papers on disk | Preview / Write, for the one-time migration above |

---

## Building

### Building the web UI

The interface is a **Vite + React** app in `web_src/`, built into `web/`:

```bash
cd web_src
npm install
npm run build
```

The add-on loads the **built** files in `web/`, so source edits have no effect until you rebuild.

### Building the add-on package

Creates `builds/Ankipapers-<version>.ankiaddon` for sharing or "Install from file", and `builds/Ankipapers-<version>-ankiweb.zip` (the same contents) to upload to AnkiWeb. `<version>` is `human_version` from `manifest.json`, so each release keeps its own files in `builds/`. Rebuild the web UI first if you changed anything in `web_src/`.

```powershell
.\_build.ps1          # Windows PowerShell
```

The script bundles `__init__.py`, `manifest.json`, `config.json`, `config.md`, `LICENSE`, `AnkiPapers logo.png`, `core/`, `gui/`, and `web/` — not `web_src/`, `user_files/`, `tests/`, `meta.json`, or `__pycache__/`. Paths inside the zip use forward slashes so it installs on macOS and Linux too.

---

## Project layout

| Path | Purpose |
|------|--------|
| `__init__.py` | Add-on entry: menu, toolbar, shortcuts |
| `manifest.json` | Anki package metadata |
| `core/paper.py` | The `Paper` and `CardReference` data model |
| `core/parser.py` | Line parsing, card extraction, block anchors |
| `core/storage.py` | Papers on disk, folder tree, collection mirror |
| `core/card_manager.py` | Card generation, note types, markdown → note HTML |
| `core/search_query.py` | The search language |
| `core/qbank.py` | Question tags on headings and lines: reading the marks, which cards they reach, the Tag Shortcuts table and paper/folder overrides |
| `core/flags.py` | Flags on headings and lines, and keeping them in step with flags set in Anki |
| `gui/list_review.py` | Reviewing a list card item by item, in order, on one screen |
| `web_src/src/listCards.js` | Which lines are list prompts and items, and their numbers from Anki |
| `gui/webview.py` | Qt window and close-safety handling |
| `gui/bridge.py` | `QWebChannel` bridge, PDF export, media |
| `web/` | Built static UI loaded by the webview |
| `web_src/` | React source; build output goes to `web/` |
| `web_src/src/docLinks.js` | Link anchors, `ap://` addressing, target search, backlink and graph index |
| `web_src/src/printDocument.js` | The PDF renderer |
| `web_src/src/qbankTags.js` / `cardFlags.js` | The `uw::3252` and `flag:red` shortcuts, hiding their comments, and the Tag Shortcuts checks |
| `web_src/src/components/TagShortcutsDialog.jsx` | A paper's or folder's own tags for the Tag Shortcuts (right-click → Tag shortcuts…) |
| `web_src/src/components/BlockEditor.jsx` | The block editor |
| `web_src/src/components/LinkPicker.jsx` | "Create link…" search dialog |
| `web_src/src/components/LinksPanel.jsx` | Backlinks and outgoing links |
| `web_src/src/components/GraphView.jsx` | Link graph |
| `user_files/` | Local cache/fallback only (gitignored) |
| `tests/` | Python tests — run `python3 -m unittest discover -s tests`. The list-card tests that open a real collection need Anki's own Python (`"$HOME/Library/Application Support/AnkiProgramFiles/.venv/bin/python" -m unittest discover -s tests` on a Mac) and are skipped otherwise |
| `gui/text_replacements.py` | Reads your macOS Text Replacements for the editor |
| `core/ai.py` | AI providers (Claude, Gemini, DeepSeek, OpenAI-compatible), Keychain key storage, background jobs, draft parsing |
| `core/sources.py` | Attached files and web sources, the chapter map, Word/PowerPoint/HTML reader views, web snapshots |
| `gui/ai_sources.py` | Bridge commands for AI and sources |
| `gui/occlusion.py` | Image occlusion: opens Anki's Add window on a picture, counts its cards, opens them in the Browser |
| `core/occlusion.py` | Matches image occlusion notes to a paper's pictures |
| `web_src/src/components/SourcesPanel.jsx` | The Sources panel |
| `web_src/src/components/FolderSourceDialog.jsx` | Attach a book / web source to a folder |
| `web_src/src/components/AskPanel.jsx` | Ask |
| `web_src/src/components/DraftGroup.jsx` | Draft cards in the editor |
| `_build.ps1` / `build_ankiaddon.bat` | Pack `Ankipapers.ankiaddon` |

---

## Syntax quick reference

| Kind | Example |
|------|--------|
| Basic card | `Question >> Answer` |
| Reversible card | `Term <> Definition` |
| Cloze | `Text with {{blank}}` |
| Numbered cloze | `{{c1::first}} … {{c2::second}}` |
| List card | A prompt line, then indented `+ item` lines: one card per item, recalled in order |
| Supplement | `&& Background that rides along with the answer` |
| Tag a card | `[[tag]]` → `AnkiPapers::tag` |
| Suppress the heading breadcrumb | `[[NH]]` |
| Tag cards with a question | `uw::3252` at the end of a heading or card line, then Space → `<!--uw::3252-->` → `UWorldABIM::3252` |
| Flag cards | `flag:red` at the end of a heading or card line, then Space → `<!--flag:red-->`; the card's own flag beats the heading's |
| Heading | `# Topic`, `## Section`, … to six levels |
| Image | `![caption](picture.jpg)` |
| Picture on a card | the same line, indented under the card — no `&&` needed |
| Table | `\| A \| B \|` rows with a `\| --- \| --- \|` separator |
| Table width | `<!--ap-table:s\|m\|l\|full-->` on the header row — set it by hovering the table |
| Maths | `$inline$`, `$$block$$` |
| Bold / italic | `<b>key</b>`, `<i>term</i>` — via the toolbar or `Ctrl+B` / `Ctrl+I` (old `**` / `*` still display) |
| Underline | `<u>key point</u>` — via the toolbar or `Ctrl+U` |
| Subscript / superscript | `H<sub>2</sub>O`, `x<sup>2</sup>` — via the toolbar or `Ctrl+5` / `Ctrl+6` |
| Link to a heading or paper | `[phrase](ap://…)` — via right-click → **Create link…** |
| Hidden line anchor | `<!--ap:uuid-->` — written for you; leave it be |

---

## Developers

- **Dr. Ahmed Benarab** — original author
- **Dr. Trevor Thompson** — document links and the link graph, papers on disk, stable card identity, PDF export, plain-text paste, pictures on cards, question tags and flags on headings, list cards

## Contributing / issues

Use [GitHub Issues](https://github.com/ahmedbenarab/Ankipapers/issues) for bug reports and feature ideas.

## License

[MIT](LICENSE) — Copyright (c) 2026 Dr. Ahmed Benarab.
