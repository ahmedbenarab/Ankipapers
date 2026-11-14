"""
Feynman practice: explain a heading out loud, scored against the paper.

The user picks an H1-H3 heading, explains it into the microphone, and gets a
score for how many of that section's answers they described:

    score = answers described / answers in the section

An answer is the hidden part of one card, so the paper itself is the answer
key and the model only judges each answer against the transcript:

    basic       "front >> back"   1 answer: the back (the front is context)
    reversible  "A <> B"          1 answer: the link between the two sides
    cloze       "{{x}} ... {{y}}" 1 answer per deletion (the rest is context)
    list        parent + "+ " items: 1 answer per item (the parent is context)

A section is the heading line and every line under it up to the next heading
of the same or a higher level, so an H2 includes its H3s. Lines that aren't
cards, ``` code, and image occlusion pictures are not counted. An answer that
is only a picture can't be said out loud, so it isn't counted either.

The app counts the answers and works out the score; the model returns one
verdict per numbered answer and nothing else, so it can't miscount.

After a session, the heading line keeps the date and score in hidden marks:

    ## HFrEF<!--LastFeynmanDate::11_13_2026--><!--LastFeynmanScore::67%-->

(written by the page, web_src/src/feynman.js). They look like question-tag
marks, so core/qbank.py reserves both names: they never become tags.

This module imports nothing from aqt/anki, so it can be tested standalone.
"""

import base64
import json
import re
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    from .parser import extract_cards, parse_document
    from . import ai as AI
except ImportError:  # loaded as a single file by a test
    from parser import extract_cards, parse_document  # type: ignore
    import ai as AI  # type: ignore


DATE_MARK = "LastFeynmanDate"
SCORE_MARK = "LastFeynmanScore"
RESERVED_MARKS = (DATE_MARK.lower(), SCORE_MARK.lower())

VERDICTS = ("covered", "missed", "contradicted")

# A cloze deletion, numbered or not: {{c1::answer::hint}} or {{answer}}.
_CLOZE_RE = re.compile(r"\{\{(c\d+::)?(.+?)\}\}")
_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK_RE = re.compile(r"(?<!!)\[([^\]\[]+)\]\([^)\s]+\)")
_TAG_RE = re.compile(r"<[^>]+>")
_BLANK = "\uE000"


# ─── The answer key ───────────────────────────────────────────────────

def _plain(text: str) -> str:
    """Card text as the model should read it: no markup, pictures as [picture]."""
    s = _IMAGE_RE.sub(" [picture] ", text or "")
    s = _LINK_RE.sub(r"\1", s)
    s = s.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    s = _TAG_RE.sub("", s)
    s = re.sub(r"\*\*|__|~~|`", "", s)
    s = s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip()


def _speakable(text: str) -> bool:
    """False for an answer that is only pictures: nothing to say out loud."""
    return bool(re.sub(r"\[picture\]", "", text).strip())


def _cloze_answers(text: str) -> List[Tuple[str, str]]:
    """(context, answer) for each deletion in a cloze line, in order.

    The context is the line with this deletion blanked and the others shown,
    so each answer is asked about on its own. A hint (c1::answer::hint) is
    not part of the answer. "{{a:b}}" without a number isn't a cloze (the
    parser's rule), so it stays as text.
    """
    spans = []
    for m in _CLOZE_RE.finditer(text):
        numbered, inner = m.group(1), m.group(2)
        if not numbered and ":" in inner:
            continue
        answer = inner.split("::", 1)[0] if numbered else inner
        spans.append((m.start(), m.end(), answer))
    out = []
    for k, (start, end, answer) in enumerate(spans):
        parts, pos = [], 0
        for j, (s, e, a) in enumerate(spans):
            parts.append(text[pos:s])
            parts.append(_BLANK if j == k else a)
            pos = e
        parts.append(text[pos:])
        # Blanked after _plain, which would read "___" as underline markup.
        out.append((_plain("".join(parts)).replace(_BLANK, "___"), _plain(answer)))
    return out


def _all_answers(content: str) -> List[Dict[str, Any]]:
    """Every answer in the paper, in line order, without ids."""
    out: List[Dict[str, Any]] = []
    for card in extract_cards(content or ""):
        kind = card.card_type
        if kind == "basic":
            entries = [(card.line_index, _plain(card.front), _plain(card.back))]
        elif kind == "reversible":
            entries = [(card.line_index, "", f"{_plain(card.front)} <> {_plain(card.back)}")]
        elif kind == "cloze":
            entries = [(card.line_index, c, a) for c, a in _cloze_answers(card.raw_text)]
        elif kind == "list":
            prompt = _plain(card.list_prompt)
            entries = [(it.line_index, prompt, _plain(it.text)) for it in (card.list_items or [])]
        else:
            continue
        for line, context, answer in entries:
            if answer and _speakable(answer):
                out.append({"kind": kind, "line": line, "card_line": card.line_index,
                            "context": context, "answer": answer})
    out.sort(key=lambda a: (a["line"], a["card_line"]))
    return out


def _headings(content: str) -> List[Tuple[int, int, str]]:
    """(line, level, text) for every heading outside ``` blocks."""
    out = []
    for p in parse_document(content or ""):
        if p.line_type == "heading" and p.heading_level:
            text = re.sub(r"^#{1,6}\s+", "", p.raw_text.strip())
            out.append((p.index, p.heading_level, text))
    return out


def section_range(content: str, heading_line: int) -> Optional[Tuple[int, int, int, str]]:
    """(start, end, level, text) of the section a heading opens, end exclusive,
    or None when heading_line isn't a heading."""
    heads = _headings(content)
    for k, (line, level, text) in enumerate(heads):
        if line != heading_line:
            continue
        end = len((content or "").split("\n"))
        for line2, level2, _ in heads[k + 1:]:
            if level2 <= level:
                end = line2
                break
        return line, end, level, _plain(_strip_marks(text))
    return None


def _strip_marks(text: str) -> str:
    """A heading's text without its hidden marks or [[tags]]."""
    return re.sub(r"\[\[[^\]]*\]\]", "", re.sub(r"<!--.*?-->", "", text or ""))


def answer_key(content: str, heading_line: int) -> Dict[str, Any]:
    """The numbered answers under a heading.

    {"heading", "level", "start", "end", "items": [{id, kind, line, context, answer}]}
    or {"error"} when the line isn't a heading.
    """
    rng = section_range(content, heading_line)
    if rng is None:
        return {"error": "That heading isn't in the paper any more."}
    start, end, level, text = rng
    items = [a for a in _all_answers(content) if start <= a["line"] < end and start <= a["card_line"] < end]
    for n, a in enumerate(items, 1):
        a["id"] = n
    return {"heading": text, "level": level, "start": start, "end": end, "items": items}


def answer_counts(content: str) -> Dict[int, int]:
    """{heading line: answers in its section} for every H1-H3 heading."""
    answers = _all_answers(content)
    lines = len((content or "").split("\n"))
    heads = _headings(content)
    counts = {}
    for k, (line, level, _text) in enumerate(heads):
        if level > 3:
            continue
        end = lines
        for line2, level2, _ in heads[k + 1:]:
            if level2 <= level:
                end = line2
                break
        counts[line] = sum(1 for a in answers if line <= a["line"] < end and line <= a["card_line"] < end)
    return counts


# ─── The grading prompt ───────────────────────────────────────────────

DEFAULT_GRADING_RULES = """You are grading a spoken explanation against the student's own notes.

The student chose one section of their notes and explained it out loud. A speech-to-text service transcribed what they said. Below the transcript is the answer key: every answer hidden by a flashcard in that section, numbered. Your only job is to decide, for each numbered answer, whether the transcript describes it accurately.

THE NOTES ARE THE ONLY SOURCE OF TRUTH
- Grade only against what is written in the answer key. Do not use your own knowledge to add to it, correct it, or question it.
- If an answer looks medically or factually wrong to you, grade against it as written anyway. The accuracy of the notes is the student's responsibility.
- Give no credit for anything the student says that is not in the answer key, even if it is true. Do not penalize it either; ignore it.
- Judge only what the transcript says. Do not assume the student meant something they did not say.

WHAT ONE ANSWER IS
Each numbered item is the hidden part of one flashcard:
- Basic card (front >> back): the back is the answer; the front is context.
- Reversible card (A <> B): the answer is the link between A and B. The student must connect the two; naming only one side is not enough.
- Cloze: each deletion is its own answer; the rest of the sentence is context. In the key, ___ marks the deletion being graded.
- List: each item is its own answer; the list's title line is context.
Context tells you what an answer is about. The student need not repeat the context word for word, but the answer must be tied to the right context: a value said about a different topic does not count.

WHEN AN ANSWER IS DESCRIBED ACCURATELY
- The meaning matches the written answer. Paraphrase is fine, and so are synonyms, abbreviations, and spelled-out forms of the same term ("beta blocker" = "β-blocker", "forty percent" = "40%").
- A different term is not the same term. Naming an example of a category does not describe the category, and naming the category does not describe the example, unless the answer key itself links them.
- Numbers, units, thresholds, the direction of a comparison (≥ / ≤, increases / decreases), and left / right must match what is written.
- If an answer has several parts, every part must be said. There is no partial credit.
- Speech-to-text makes mistakes. A word that plainly sounds like the written term counts as that term ("hydro lazine" = "hydralazine"). Do not stretch this to different words.
- Order does not matter, and neither do hesitations, filler, or self-corrections (the student's final version counts).
- [picture] stands for an image in the notes. It can't be said out loud; grade the words around it.

VERDICTS
- "covered": the transcript describes this answer accurately.
- "missed": the answer is not said, or only part of it is said.
- "contradicted": the transcript states something that conflicts with the written answer.

THE SCORE
The score is the number of covered answers divided by the total number of answers in the key. The app computes it from your verdicts, so do not output a score or percentage."""

# Added after the rules, edited or not (Settings → AI → Feynman → Grading
# prompt): the reply has to be in this shape for score_reply to read it.
GRADING_OUTPUT = """OUTPUT
Reply with JSON only, one entry per answer, in the key's order, no others:
{"items": [{"id": 1, "verdict": "covered" | "missed" | "contradicted", "heard": "the transcript words you matched, or empty", "note": "for missed or contradicted only, at most 15 words"}]}"""


def grading_system_prompt(rules: str = "") -> str:
    """The rules (the user's own from Settings, or the default) and then the
    reply format, which isn't editable."""
    return ((rules or "").strip() or DEFAULT_GRADING_RULES) + "\n\n" + GRADING_OUTPUT


GRADING_SYSTEM_PROMPT = grading_system_prompt()

_KIND_LABEL = {"basic": "basic", "reversible": "reversible", "cloze": "cloze", "list": "list"}


def grading_user_prompt(key: Dict[str, Any], transcript: str) -> str:
    items = key.get("items") or []
    level = int(key.get("level") or 1)
    lines = [
        f"Section: {'#' * level} {key.get('heading', '')} (with everything under it, including smaller headings)",
        "",
        f"Answer key ({len(items)} {'answer' if len(items) == 1 else 'answers'}):",
    ]
    for it in items:
        label = f"[{_KIND_LABEL.get(it['kind'], it['kind'])}]"
        if it["kind"] == "reversible":
            lines.append(f"{it['id']}. {label} {it['answer']}")
        elif it.get("context"):
            lines.append(f"{it['id']}. {label} Context: {it['context']}  |  Answer: {it['answer']}")
        else:
            lines.append(f"{it['id']}. {label} Answer: {it['answer']}")
    lines += ["", "Transcript:", '"""', (transcript or "").strip(), '"""']
    return "\n".join(lines)


def _json_object(raw: str) -> Optional[dict]:
    """The JSON object in a model reply, with or without ``` fences around it."""
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def score_reply(key: Dict[str, Any], raw: str) -> Dict[str, Any]:
    """Merge the model's verdicts into the key and count the score.

    An answer the model left out, or gave a verdict that isn't one of the
    three, counts as missed: only a clear "covered" earns the point.
    """
    data = _json_object(raw)
    if data is None:
        raise AI.AIError("The model's reply wasn't in the expected format. Try again.")
    by_id: Dict[int, dict] = {}
    for v in data.get("items") or []:
        if not isinstance(v, dict):
            continue
        try:
            by_id.setdefault(int(v.get("id")), v)
        except (TypeError, ValueError):
            continue
    items = []
    for it in key.get("items") or []:
        v = by_id.get(it["id"]) or {}
        verdict = str(v.get("verdict") or "").strip().lower()
        if verdict not in VERDICTS:
            verdict = "missed"
        items.append({
            **it,
            "verdict": verdict,
            "heard": str(v.get("heard") or "").strip(),
            "note": str(v.get("note") or "").strip() if verdict != "covered" else "",
        })
    total = len(items)
    covered = sum(1 for it in items if it["verdict"] == "covered")
    return {"items": items, "covered": covered, "total": total, "score": percent(covered, total)}


def percent(covered: int, total: int) -> int:
    """Whole-number percentage, halves rounded up (2 of 3 is 67)."""
    if total <= 0:
        return 0
    return int(covered * 100 / total + 0.5)


# ─── Transcription ────────────────────────────────────────────────────
#
# One model does both jobs, transcribing and then grading (Settings → AI →
# Feynman → Model): Gemini hears audio as part of an ordinary request, and on
# an OpenAI-compatible server an audio chat model (gpt-audio-1.5) does the
# same through chat completions. Speech-to-text-only models (gpt-4o-transcribe,
# Whisper) can't grade, so they aren't used.

FEYNMAN_PROVIDERS = ("gemini", "openai")
DEFAULT_FEYNMAN_MODELS = {"gemini": "gemini-3.8-flash", "openai": "gpt-audio-1.5"}
# Audio goes inline: Gemini takes up to about 20 MB per request, base64 included.
INLINE_AUDIO_LIMIT = 14 * 1024 * 1024

NO_SPEECH = "[no speech]"
TRANSCRIBE_PROMPT = (
    "Transcribe this recording word for word. Output only the transcript: no "
    "headings, no timestamps, no speaker labels, no commentary. Keep medical "
    "and technical terms, numbers and units as spoken. Write only words you can "
    "actually hear; never guess or fill in. If the recording is silent, or is only "
    f"noise or unclear sound, output exactly {NO_SPEECH}"
)


def _openai_transcribe(key: str, model: str, audio: bytes, mime: str, base_url: str = "") -> str:
    """An audio chat model hears the recording in a chat completion (an
    input_audio part). base_url empty means OpenAI itself."""
    url = AI._openai_base(base_url) + "/chat/completions"
    fmt = "mp3" if "mp3" in mime or "mpeg" in mime else "wav"
    body = {"model": model, "messages": [{"role": "user", "content": [
        {"type": "text", "text": TRANSCRIBE_PROMPT},
        {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": fmt}},
    ]}]}
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        with AI._request("POST", url, headers, body, 300) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
    except AI.AIError as e:
        if "(400)" in str(e) and re.search(r"audio|modalit|content type|input_audio", str(e), re.I):
            raise AI.AIError(f"{e} The model “{model}” can't hear audio. Choose an audio chat model "
                             f"such as {DEFAULT_FEYNMAN_MODELS['openai']}.") from None
        raise
    out = []
    for ch in data.get("choices") or []:
        content = (ch.get("message") or {}).get("content")
        if isinstance(content, str):
            out.append(content)
        elif isinstance(content, list):
            out.extend(str(p.get("text") or "") for p in content if isinstance(p, dict))
    return "".join(out).strip()


def _gemini_transcribe(key: str, model: str, audio: bytes, mime: str) -> str:
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": TRANSCRIBE_PROMPT},
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(audio).decode("ascii")}},
        ]}],
        "generationConfig": {"temperature": 0},
    }
    url = f"{AI.GEMINI_URL}/models/{model}:generateContent"
    with AI._request("POST", url, {"x-goog-api-key": key}, body, 300) as r:
        data = json.loads(r.read().decode("utf-8", errors="replace"))
    parts = []
    for cand in data.get("candidates") or []:
        for part in ((cand.get("content") or {}).get("parts") or []):
            if not part.get("thought"):
                parts.append(part.get("text") or "")
    return "".join(parts).strip()


def needs_key(provider: str, base_url: str = "") -> bool:
    """A local OpenAI-compatible server (localhost) may run without a key."""
    return not (provider == "openai" and re.search(r"localhost|127\.0\.0\.1", base_url or ""))


def transcribe(provider: str, key: str, audio: bytes, mime: str = "audio/wav", model: str = "",
               base_url: str = "") -> str:
    """Speech to text with the Feynman model. Claude and DeepSeek can't hear
    audio, so Settings → AI → Feynman offers Gemini and OpenAI-compatible.
    base_url is for OpenAI-compatible only; empty means OpenAI."""
    if provider not in FEYNMAN_PROVIDERS:
        raise AI.AIError("Choose Gemini or OpenAI-compatible in Settings → AI → Feynman.")
    if not key and needs_key(provider, base_url):
        name = "OpenAI-compatible" if provider == "openai" else "Google AI Studio"
        raise AI.AIError(f"Add your {name} key in Settings → AI → Feynman.")
    if not audio:
        raise AI.AIError("The recording was empty.")
    if len(audio) > INLINE_AUDIO_LIMIT:
        raise AI.AIError("That recording is too long to send in one go. Keep it under about 7 minutes.")
    model = model or DEFAULT_FEYNMAN_MODELS[provider]

    def once():
        if provider == "openai":
            return _openai_transcribe(key, model, audio, mime, base_url)
        return _gemini_transcribe(key, model, audio, mime)

    text = _retry_busy(once)
    if text.strip().lower().strip(".") in (NO_SPEECH, NO_SPEECH.strip("[]")):
        return ""
    return text


# Waits before trying again when the provider says it's overloaded (503):
# those spikes usually pass within seconds. Anything else fails at once.
RETRY_WAITS = (2.0, 5.0)


def _retry_busy(fn: Callable[[], str], sleep: Callable[[float], None] = time.sleep) -> str:
    for wait in RETRY_WAITS + (None,):
        try:
            return fn()
        except AI.AIError as e:
            if wait is None or "(503)" not in str(e):
                raise
            sleep(wait)
    raise AssertionError("unreachable")


# ─── Microphone names ─────────────────────────────────────────────────

def system_inputs() -> List[Dict[str, Any]]:
    """The Mac's audio inputs by their real names: [{"name", "default"}].

    The web engine hides part of some names (any AirPods, whatever the model
    or owner, are just "AirPods" to a page), so the panel's microphone menu
    looks the full name up here. Empty off macOS or if the lookup fails; the
    menu then shows the names the page was given.
    """
    if sys.platform != "darwin":
        return []
    try:
        p = subprocess.run(["/usr/sbin/system_profiler", "SPAudioDataType", "-json"],
                           capture_output=True, timeout=15)
        return parse_system_inputs(p.stdout.decode("utf-8", errors="replace"))
    except Exception:
        return []


def parse_system_inputs(raw: str) -> List[Dict[str, Any]]:
    try:
        items = json.loads(raw)["SPAudioDataType"][0]["_items"]
    except Exception:
        return []
    return [{"name": str(it["_name"]), "default": bool(it.get("coreaudio_default_audio_input_device"))}
            for it in items if isinstance(it, dict) and it.get("coreaudio_device_input") and it.get("_name")]
