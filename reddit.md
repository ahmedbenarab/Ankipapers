# I got fired from RemNote, so I decided to take revenge and I created an add-on that replicates RemNote's functionalities.

*(Reddit-style post draft — paste into r/Anki or wherever you like.)*

---

**TL;DR:** I built **Anki Papers**, an Anki add-on where you write markdown “papers,” organize them in folders, and turn lines into flashcards with simple syntax—then hit Generate and your collection updates. Below is what it does and why I “made” it.

**For real (this part isn’t the joke):** I first had the idea about **three years ago** and laid it out in [this r/medicalschoolanki post — *Anki Papers: a universal Anki note add-on idea*](https://www.reddit.com/r/medicalschoolanki/comments/1e8wmji/anki_papers_a_universal_anki_note_addon_idea/). From that point on I started **developing Anki Papers** in earnest—turning that write-up into an actual add-on and iterating on it ever since.

---

So anyway, HR said my “documentation hierarchy” was “too nested” and that I “couldn’t keep calling everything a portal.” I said the *real* portal was knowledge itself. They didn’t get it. One thing led to another and I had a lot of free time and a grudge, so I did the rational thing: I opened Anki and started coding until it felt like writing notes and making cards in the same place wasn’t a fantasy anymore.

**Why I “built” it (joke version):**  
Revenge is best served as a MIT-licensed side project. Also I wanted one long document per topic, folders that make sense, and cards that come from the same text I’m already studying—not from a separate mental app.

**What Anki Papers actually does:**

- **Papers** — Think “one doc per topic” in markdown: headings, lists, images, the usual.
- **Folders** — Sidebar tree, drag-and-drop for papers and folders, rename/delete, “move folder to root” from the context menu.
- **Cards from the same file** — Inline syntax: `Question >> Answer` (basic), `Term <> Definition` (reversible), `{{cloze}}` / numbered clozes for—you guessed it—cloze.
- **Block + source editing** — Notion-ish blocks or raw markdown; flip with **Ctrl+Shift+V**.
- **Generate** — **Ctrl+G** syncs those lines to real Anki notes in the deck you picked.
- **Search** — Fancy sidebar search: phrases, `title:`, `folder:`, `deck:`, `tag:`, minus terms, `OR`, in a little popover so it doesn’t eat the tree.
- **Welcome screen** — Logo, cheat sheet for syntax, quick create, recent papers.
- **Import/export** — Markdown in/out, PDF export where the environment allows it.
- **Quality-of-life** — Multi-select blocks with Ctrl/Shift + click, context menu for copy/duplicate/merge/delete, paste images, jump to Browser for linked notes, settings for theme, fonts, autosave, conflicts, etc.

So no, RemNote didn’t “lose” anything—I’m not even claiming feature parity. It’s *inspired by the same itch*: notes and cards in one workflow, inside the tool people already use for spaced repetition (Anki).

If you try it, I hope it saves you time. If you don’t, I hope your portals stay unnested and HR stays off your back.

---

### Disclaimer (read this)

**None of the story about getting fired from RemNote is true.** I was not fired from RemNote. This post title and framing are **a joke** for engagement and fun. RemNote is a separate product and team; don’t harass them, don’t cite this as fact, and don’t send them angry emails on my behalf. **Anki Papers is an independent Anki add-on**; any resemblance to “revenge arcs” is purely fictional. The real reason to use it is that it’s useful—not because of a fake corporate drama.

**What *is* true:** the **~3-year timeline**, the [original Reddit idea post](https://www.reddit.com/r/medicalschoolanki/comments/1e8wmji/anki_papers_a_universal_anki_note_addon_idea/), and that I’ve been **building Anki Papers since then**.

Stay kind, stay spaced, and happy studying.
