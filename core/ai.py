"""
AI provider layer for Anki Papers.

Talks to Claude (Anthropic), Gemini (Google AI Studio) or any OpenAI-compatible
endpoint (OpenAI, OpenRouter, Ollama, LM Studio...) over plain HTTPS with the
standard library -- no SDKs, nothing to install into Anki's Python.

Requests run on a background thread (JobManager) and the web UI polls for the
result, because a pycmd() handler runs on Anki's main thread: a model call
made there would freeze Anki for as long as the model takes to answer.

API keys never go into the add-on's config files (meta.json is committed to
the project's Git repo). On macOS they live in the login Keychain; elsewhere
the caller supplies a fallback store.

This module imports nothing from aqt/anki, so it can be tested standalone.
"""

import json
import os
import re
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

PROVIDERS = ("anthropic", "gemini", "openai")

ANTHROPIC_URL = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"

DEFAULT_MODELS = {
    "anthropic": "claude-opus-5-5",
    "gemini": "",
    "openai": "",
}

KEYCHAIN_SERVICE = "Anki Papers AI"

DEFAULT_CARD_RULES = (
    "One fact per card; keep answers under 8 words.\n"
    "Prefer cloze for numbers, doses, cut-offs and short lists.\n"
    "Keep the source's wording. Don't add facts that aren't in the selected text.\n"
    "Never invent a heading or a tag."
)


class AIError(Exception):
    """A provider call failed in a way worth showing to the user."""


class Canceled(Exception):
    """The job was canceled while the request was streaming."""


# ─── HTTP ─────────────────────────────────────────────────────────────

def _ssl_context() -> ssl.SSLContext:
    # Anki bundles certifi; the Python it ships doesn't always find the
    # system certificate store on its own.
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _error_message(status: int, body: str) -> str:
    detail = ""
    try:
        data = json.loads(body)
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            detail = err.get("message") or err.get("type") or ""
        elif isinstance(err, str):
            detail = err
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            detail = (data[0].get("error") or {}).get("message", "")
    except Exception:
        detail = (body or "").strip()[:300]
    if status in (401, 403):
        return f"The provider rejected the API key ({status}). {detail}".strip()
    if status == 404:
        return f"Not found ({status}): check the model name or address. {detail}".strip()
    if status == 429:
        return f"Rate limit or quota reached ({status}). {detail}".strip()
    return f"The provider returned an error ({status}). {detail}".strip()


def _request(method: str, url: str, headers: Dict[str, str], body: Optional[dict] = None,
             timeout: float = 60.0):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    hdrs = {"User-Agent": "AnkiPapers", **headers}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    ctx = _ssl_context() if url.lower().startswith("https://") else None
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8", errors="replace")
        except Exception:
            text = ""
        raise AIError(_error_message(e.code, text)) from None
    except urllib.error.URLError as e:
        raise AIError(f"Couldn't reach {urllib.parse.urlparse(url).netloc}: {e.reason}") from None
    except TimeoutError:
        raise AIError("The request timed out.") from None


def _get_json(url: str, headers: Dict[str, str], timeout: float = 20.0) -> Any:
    with _request("GET", url, headers, None, timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def _iter_sse(resp, canceled: Callable[[], bool]):
    """Yield the JSON payload of each `data:` line in a server-sent-event stream."""
    for raw in resp:
        if canceled():
            raise Canceled()
        line = raw.decode("utf-8", errors="replace").strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            yield json.loads(payload)
        except ValueError:
            continue


# ─── Providers ────────────────────────────────────────────────────────

def _openai_base(base_url: str) -> str:
    base = (base_url or DEFAULT_OPENAI_BASE).strip().rstrip("/")
    if not re.match(r"^https?://", base):
        base = "http://" + base if base.startswith(("localhost", "127.0.0.1")) else "https://" + base
    return base


def list_models(provider: str, key: str, base_url: str = "") -> List[str]:
    """Model ids the key can use. Doubles as the "Test connection" check."""
    if provider == "anthropic":
        data = _get_json(f"{ANTHROPIC_URL}/models?limit=100",
                         {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION})
        return [m.get("id") for m in data.get("data", []) if m.get("id")]
    if provider == "gemini":
        data = _get_json(f"{GEMINI_URL}/models?pageSize=200", {"x-goog-api-key": key})
        out = []
        for m in data.get("models", []):
            if "generateContent" in (m.get("supportedGenerationMethods") or []):
                out.append((m.get("name") or "").replace("models/", ""))
        return [m for m in out if m]
    if provider == "openai":
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        data = _get_json(f"{_openai_base(base_url)}/models", headers)
        return sorted(m.get("id") for m in data.get("data", []) if m.get("id"))
    raise AIError(f"Unknown provider {provider!r}")


# Room for the answer. On current Claude models thinking is on by default and
# counts against max_tokens, so a small cap can be used up before the answer
# starts; we stream, and only what is generated is billed.
DEFAULT_MAX_TOKENS = {"anthropic": 16000, "gemini": 8192, "openai": 4096}


def complete(provider: str, key: str, model: str, system: str, messages: List[Dict[str, str]],
             base_url: str = "", max_tokens: Optional[int] = None,
             on_delta: Optional[Callable[[str], None]] = None,
             canceled: Callable[[], bool] = lambda: False,
             temperature: Optional[float] = None) -> Tuple[str, Dict[str, int]]:
    """Run one chat completion, streaming text to on_delta as it arrives.

    messages: [{"role": "user"|"assistant", "content": str}, ...]
    Returns (full_text, {"input": n, "output": n}).

    temperature is only sent to Gemini and OpenAI-compatible endpoints, and is
    dropped and the request retried if the model refuses it. Claude never gets
    one: current Claude models reject sampling parameters with a 400.
    """
    if not model:
        raise AIError("Choose a model in Settings → AI first.")
    if max_tokens is None:
        max_tokens = DEFAULT_MAX_TOKENS.get(provider, 4096)
    parts: List[str] = []
    usage = {"input": 0, "output": 0}

    def emit(t: str):
        if t:
            parts.append(t)
            if on_delta:
                on_delta(t)

    if provider == "anthropic":
        if not key:
            raise AIError("Add your Anthropic API key in Settings → AI.")
        body = {"model": model, "max_tokens": max_tokens, "system": system, "stream": True,
                "messages": [{"role": m["role"], "content": m["content"]} for m in messages]}
        stop_reason = None
        with _request("POST", f"{ANTHROPIC_URL}/messages",
                      {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION}, body, 300) as r:
            for ev in _iter_sse(r, canceled):
                t = ev.get("type")
                if t == "message_start":
                    usage["input"] = ((ev.get("message") or {}).get("usage") or {}).get("input_tokens", 0)
                elif t == "content_block_delta":
                    delta = ev.get("delta") or {}
                    # Only the answer; thinking arrives as thinking_delta / signature_delta.
                    if delta.get("type") == "text_delta":
                        emit(delta.get("text", ""))
                elif t == "message_delta":
                    usage["output"] = (ev.get("usage") or {}).get("output_tokens", usage["output"])
                    stop_reason = (ev.get("delta") or {}).get("stop_reason") or stop_reason
                elif t == "error":
                    raise AIError((ev.get("error") or {}).get("message", "The provider returned an error."))
        if stop_reason == "refusal":
            raise AIError("The model declined this request. Try rephrasing it, or choose another model in Settings → AI.")
        if stop_reason == "max_tokens" and not "".join(parts).strip():
            raise AIError("The model ran out of room before answering. Try a shorter selection.")
    elif provider == "gemini":
        if not key:
            raise AIError("Add your Google AI Studio key in Settings → AI.")
        contents = [{"role": "model" if m["role"] == "assistant" else "user",
                     "parts": [{"text": m["content"]}]} for m in messages]
        config = {"maxOutputTokens": max_tokens}
        if temperature is not None:
            config["temperature"] = temperature
        body = {"contents": contents, "systemInstruction": {"parts": [{"text": system}]},
                "generationConfig": config}
        url = f"{GEMINI_URL}/models/{model}:streamGenerateContent?alt=sse"

        def run_gemini(b):
            with _request("POST", url, {"x-goog-api-key": key}, b, 300) as r:
                for ev in _iter_sse(r, canceled):
                    for cand in ev.get("candidates") or []:
                        for part in ((cand.get("content") or {}).get("parts") or []):
                            if not part.get("thought"):
                                emit(part.get("text", ""))
                    um = ev.get("usageMetadata") or {}
                    if um:
                        usage["input"] = um.get("promptTokenCount", usage["input"])
                        usage["output"] = um.get("candidatesTokenCount", usage["output"])

        _with_fallbacks(run_gemini, body, [("temperature", lambda b: b["generationConfig"].pop("temperature", None))])
    elif provider == "openai":
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        body = {"model": model, "stream": True, "max_tokens": max_tokens,
                "stream_options": {"include_usage": True},
                "messages": [{"role": "system", "content": system}] +
                            [{"role": m["role"], "content": m["content"]} for m in messages]}
        if temperature is not None:
            body["temperature"] = temperature

        def run_openai(b):
            with _request("POST", f"{_openai_base(base_url)}/chat/completions", headers, b, 300) as r:
                for ev in _iter_sse(r, canceled):
                    for ch in ev.get("choices") or []:
                        emit((ch.get("delta") or {}).get("content") or "")
                    u = ev.get("usage") or {}
                    if u:
                        usage["input"] = u.get("prompt_tokens", usage["input"])
                        usage["output"] = u.get("completion_tokens", usage["output"])

        def use_completion_tokens(b):
            b["max_completion_tokens"] = b.pop("max_tokens", max_tokens)

        _with_fallbacks(run_openai, body, [
            ("temperature", lambda b: b.pop("temperature", None)),
            ("max_tokens", use_completion_tokens),          # newer OpenAI models
            ("stream_options", lambda b: b.pop("stream_options", None)),  # some local servers
        ])
    else:
        raise AIError(f"Unknown provider {provider!r}")
    return "".join(parts), usage


def _with_fallbacks(run: Callable[[dict], None], body: dict, fixes: List[Tuple[str, Callable[[dict], None]]]) -> None:
    """Send `body`; if the endpoint rejects a parameter by name before any
    text has arrived, adjust that parameter and try again (once per fix)."""
    remaining = list(fixes)
    while True:
        try:
            run(body)
            return
        except AIError as e:
            msg = str(e).lower()
            hit = next((f for f in remaining if f[0] in msg and ("400" in msg or "unsupported" in msg or "not supported" in msg)), None)
            if not hit:
                raise
            remaining.remove(hit)
            hit[1](body)


# ─── Key storage ──────────────────────────────────────────────────────

def keychain_available() -> bool:
    return sys.platform == "darwin" and os.path.exists("/usr/bin/security")


def _security(commands: str) -> Tuple[int, str]:
    """Run `security -i` with commands on stdin, so a key never appears in
    the process list the way it would as a command-line argument."""
    p = subprocess.run(["/usr/bin/security", "-i"], input=commands.encode("utf-8"),
                       capture_output=True, timeout=15)
    return p.returncode, (p.stdout or b"").decode("utf-8", errors="replace")


def _quote(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


class KeyStore:
    """Per-provider API keys. Keychain on macOS; `fallback_get/set` elsewhere."""

    def __init__(self, fallback_get: Callable[[], Dict[str, str]] = None,
                 fallback_set: Callable[[Dict[str, str]], None] = None):
        self._fallback_get = fallback_get
        self._fallback_set = fallback_set

    def where(self) -> str:
        return "keychain" if keychain_available() else "config"

    def get(self, provider: str) -> str:
        if keychain_available():
            try:
                p = subprocess.run(
                    ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
                     "-a", provider, "-w"], capture_output=True, timeout=15)
                if p.returncode == 0:
                    return (p.stdout or b"").decode("utf-8").strip()
            except Exception:
                traceback.print_exc()
            return ""
        if self._fallback_get:
            return (self._fallback_get() or {}).get(provider, "")
        return ""

    def set(self, provider: str, key: str) -> None:
        key = (key or "").strip()
        if not key:
            self.delete(provider)
            return
        if keychain_available():
            code, out = _security(
                f"add-generic-password -U -s {_quote(KEYCHAIN_SERVICE)} -a {_quote(provider)} "
                f"-l {_quote(KEYCHAIN_SERVICE + ' (' + provider + ')')} -w {_quote(key)}\n")
            if code != 0 or self.get(provider) != key:
                raise AIError("Couldn't save the key in the macOS Keychain.")
            return
        if self._fallback_get and self._fallback_set:
            keys = dict(self._fallback_get() or {})
            keys[provider] = key
            self._fallback_set(keys)
            return
        raise AIError("No place to store the key on this system.")

    def delete(self, provider: str) -> None:
        if keychain_available():
            subprocess.run(["/usr/bin/security", "delete-generic-password", "-s", KEYCHAIN_SERVICE,
                            "-a", provider], capture_output=True, timeout=15)
            return
        if self._fallback_get and self._fallback_set:
            keys = dict(self._fallback_get() or {})
            keys.pop(provider, None)
            self._fallback_set(keys)

    @staticmethod
    def hint(key: str) -> str:
        if not key:
            return ""
        return ("•" * 8) + key[-4:] if len(key) > 8 else "•" * len(key)


# ─── Jobs ─────────────────────────────────────────────────────────────

class JobManager:
    """Runs AI work on background threads; the UI polls with poll(job_id)."""

    KEEP_SECONDS = 600

    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def start(self, work: Callable[[Callable[[str], None], Callable[[], bool]], Any]) -> str:
        """work(on_delta, canceled) -> result (JSON-serializable)."""
        self._prune()
        job_id = uuid.uuid4().hex
        job = {"status": "running", "text": "", "result": None, "error": None,
               "cancel": False, "started": time.time()}
        with self._lock:
            self._jobs[job_id] = job

        def on_delta(t: str):
            with self._lock:
                job["text"] += t

        def canceled() -> bool:
            return job["cancel"]

        def run():
            try:
                result = work(on_delta, canceled)
                with self._lock:
                    if job["cancel"]:
                        job["status"] = "canceled"
                    else:
                        job["status"] = "done"
                        job["result"] = result
            except Canceled:
                with self._lock:
                    job["status"] = "canceled"
            except AIError as e:
                with self._lock:
                    job["status"] = "error"
                    job["error"] = str(e)
            except Exception as e:
                traceback.print_exc()
                with self._lock:
                    job["status"] = "error"
                    job["error"] = f"Something went wrong: {e}"
            finally:
                job["finished"] = time.time()

        threading.Thread(target=run, name=f"ankipapers-ai-{job_id[:6]}", daemon=True).start()
        return job_id

    def poll(self, job_id: str) -> Dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return {"status": "missing"}
            return {k: job[k] for k in ("status", "text", "result", "error")}

    def cancel(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job["status"] == "running":
                job["cancel"] = True

    def _prune(self):
        now = time.time()
        with self._lock:
            for jid in [j for j, v in self._jobs.items()
                        if v["status"] != "running" and now - v.get("finished", now) > self.KEEP_SECONDS]:
                del self._jobs[jid]


# ─── Usage ────────────────────────────────────────────────────────────

class UsageLog:
    """Counts requests and tokens per month in <ankipapers dir>/ai_usage.json."""

    def __init__(self, path_fn: Callable[[], str]):
        self._path_fn = path_fn
        self._lock = threading.Lock()

    def _load(self) -> Dict[str, Any]:
        try:
            with open(self._path_fn(), "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def add(self, kind: str, usage: Dict[str, int]) -> None:
        month = time.strftime("%Y-%m")
        with self._lock:
            data = self._load()
            m = data.setdefault(month, {})
            m[kind] = m.get(kind, 0) + 1
            m["input_tokens"] = m.get("input_tokens", 0) + int(usage.get("input") or 0)
            m["output_tokens"] = m.get("output_tokens", 0) + int(usage.get("output") or 0)
            try:
                with open(self._path_fn(), "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=1)
            except Exception:
                traceback.print_exc()

    def this_month(self) -> Dict[str, int]:
        return self._load().get(time.strftime("%Y-%m"), {})


# ─── Card drafting ────────────────────────────────────────────────────

_CLOZE_RE = re.compile(r"\{\{(?:c\d+::)?.+?\}\}")


def _card_kind(line: str, basic_sep: str, rev_sep: str) -> Optional[str]:
    if _CLOZE_RE.search(line):
        return "cloze"
    if rev_sep and rev_sep in line:
        return "reversible"
    if basic_sep and basic_sep in line:
        return "basic"
    return None


def draft_system_prompt(settings: Dict[str, Any]) -> str:
    basic_sep = settings.get("basic_separator") or ">>"
    rev_sep = settings.get("reversible_separator") or "<>"
    types = settings.get("ai_card_types") or {}
    allowed = []
    if types.get("basic", True):
        allowed.append(f"- Basic: `Question {basic_sep} Answer`")
    if types.get("reversible", True):
        allowed.append(f"- Reversible (both directions are worth learning, like a term and its "
                       f"definition): `Term {rev_sep} Definition`")
    if types.get("cloze", True):
        allowed.append("- Cloze: a sentence with the hidden part wrapped as `{{c1::hidden}}`; "
                       "use c2, c3 for further blanks in the same sentence only when each is "
                       "worth testing on its own")
    if not allowed:
        allowed.append(f"- Basic: `Question {basic_sep} Answer`")
    rules = (settings.get("ai_card_rules") or "").strip() or DEFAULT_CARD_RULES
    language = (settings.get("ai_language") or "").strip()
    lang_line = (f"Write the cards in {language}." if language and language.lower() != "same as the source"
                 else "Write the cards in the same language as the source text.")
    return (
        "You turn study notes into Anki flashcards for a markdown note-taking app.\n"
        "Each card is exactly one line, in one of these formats:\n"
        + "\n".join(allowed) + "\n\n"
        "Formatting inside a card: <b>bold</b>, <i>italic</i>, <sub>, <sup> and $maths$ are allowed. "
        "No markdown headings, bullets, numbering or line breaks.\n\n"
        f"Rules from the user:\n{rules}\n\n{lang_line}\n\n"
        'Reply with JSON only, in this shape: {"cards": ["card line", "card line"]}. '
        "Return an empty list if the text has nothing worth a card."
    )


def draft_user_prompt(text: str, heading_path: List[str], existing: List[str] = None,
                      redo_of: str = "") -> str:
    parts = []
    if heading_path:
        parts.append("Section: " + " › ".join(heading_path))
    if existing:
        parts.append("Cards that already exist nearby (don't repeat them):\n" + "\n".join(existing[:40]))
    parts.append("Text:\n" + text.strip())
    if redo_of:
        parts.append("Write ONE different card for the same fact as this draft, phrased another "
                     f"way or as another card type:\n{redo_of}\n"
                     'Reply as {"cards": ["the one card"]}.')
    return "\n\n".join(parts)


def parse_cards(raw: str, settings: Dict[str, Any]) -> List[str]:
    """Pull card lines out of a model reply, keeping only valid one-line cards."""
    basic_sep = settings.get("basic_separator") or ">>"
    rev_sep = settings.get("reversible_separator") or "<>"
    candidates: List[str] = []
    text = (raw or "").strip()
    # Strip a ```json fence if the model added one.
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    obj = None
    for attempt in (text, text[text.find("{"):text.rfind("}") + 1] if "{" in text else ""):
        if not attempt:
            continue
        try:
            obj = json.loads(attempt)
            break
        except ValueError:
            continue
    if isinstance(obj, dict) and isinstance(obj.get("cards"), list):
        candidates = [c for c in obj["cards"] if isinstance(c, str)]
    elif isinstance(obj, list):
        candidates = [c for c in obj if isinstance(c, str)]
    else:
        candidates = text.splitlines()

    out: List[str] = []
    seen = set()
    for c in candidates:
        line = re.sub(r"\s+", " ", c.replace("\n", " ")).strip()
        line = re.sub(r"^(?:[-*•]|\d+[.)])\s+", "", line).strip().strip("`")
        if not line or _card_kind(line, basic_sep, rev_sep) is None:
            continue
        if line.lower() in seen:
            continue
        seen.add(line.lower())
        out.append(line)
    return out


# ─── Chat ─────────────────────────────────────────────────────────────

def chat_system_prompt(settings: Dict[str, Any], context_blocks: List[Dict[str, str]],
                       stick_to_sources: bool) -> str:
    language = (settings.get("ai_language") or "").strip()
    lang_line = (f"Answer in {language}." if language and language.lower() != "same as the source"
                 else "Answer in the language of the question.")
    lines = [
        "You are a study assistant inside Anki Papers, a markdown note-taking app whose notes "
        "become Anki flashcards. Answer clearly and briefly; use short paragraphs, and plain "
        "markdown lists only when they help.",
        lang_line,
        "Cite where facts come from with these markers, exactly as written, right after the "
        "sentence they support: [line N] for a line of the user's open paper, and "
        "[S<id> p. N] or [S<id>] for an attached source (use the source id shown in its header, "
        "and the page number when the source shows one).",
    ]
    if stick_to_sources:
        lines.append(
            "Use only the material below. If it doesn't cover the question, say so in one "
            "sentence, then you may answer from general knowledge, marking those sentences "
            "with (general knowledge).")
    else:
        lines.append("You may use general knowledge; mark sentences that don't come from the "
                     "material below with (general knowledge).")
    for b in context_blocks:
        lines.append(f"\n=== {b['label']} ===\n{b['text']}")
    return "\n".join(lines)


def number_lines(content: str, max_chars: int = 60000) -> str:
    out, total = [], 0
    for i, line in enumerate((content or "").split("\n")):
        line = re.sub(r"\s*<!--ap:[^>]*-->", "", line)
        if not line.strip():
            continue
        row = f"{i + 1}: {line}"
        total += len(row) + 1
        if total > max_chars:
            out.append("[… the rest of the paper is cut for length]")
            break
        out.append(row)
    return "\n".join(out)
