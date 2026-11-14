"""
Bridge commands for the Feynman panel (core/feynman.py).

The page records the explanation itself, sends the audio here in base64
chunks (one pycmd message per chunk keeps each message small), then asks for
a transcript and a grade. Both go over the network, so both are background
jobs the page polls with "ai_poll", like the other AI commands.
"""

import base64
import os
import subprocess
import sys
from typing import Any, Dict, List

from aqt import mw

from ..core import ai as AI
from ..core import feynman as FEYN
from .ai_sources import JOBS, KEYS, USAGE, _config, _err

# Who said no, in errors: the two steps can use different providers, and a
# bare "invalid key" doesn't say which one.
_NAMES = {"anthropic": "Claude", "gemini": "Gemini", "deepseek": "DeepSeek", "openai": "OpenAI-compatible"}


def _blame(step: str, provider: str, e: Exception) -> AI.AIError:
    name = _NAMES.get(provider, provider)
    hint = ""
    if "(401)" in str(e) or "(403)" in str(e):
        hint = f" Check the {name} key and model in Settings → AI → Feynman (Test connection)."
    msg = str(e).strip()
    if hint and msg and msg[-1] not in ".!?":
        msg += "."
    return AI.AIError(f"{step} with {name} failed: {msg}{hint}")


def _feynman_ai():
    """(provider, model, base_url) from Settings → AI → Feynman: one model
    both transcribes and grades."""
    cfg = _config()
    provider = cfg.get("feynman_provider") or "gemini"
    if provider not in FEYN.FEYNMAN_PROVIDERS:
        provider = "gemini"
    model = (cfg.get(f"feynman_model_{provider}") or "").strip() or FEYN.DEFAULT_FEYNMAN_MODELS[provider]
    base_url = (cfg.get("feynman_base_url") or "").strip() if provider == "openai" else ""
    return provider, model, base_url


# Longest recording accepted: the page stops at 10 minutes, and 16 kHz mono
# WAV is about 1.9 MB a minute.
MAX_AUDIO_BYTES = 24 * 1024 * 1024


class FeynmanMixin:
    """Methods added to AnkiPapersBridge; see _feynman_dispatch()."""

    def _feynman_dispatch(self) -> Dict[str, Any]:
        self._feynman_uploads: Dict[str, List[bytes]] = {}
        return {
            "feynman_counts": self.feynman_counts,
            "feynman_audio": self.feynman_audio,
            "feynman_transcribe": self.feynman_transcribe,
            "feynman_grade": self.feynman_grade,
            "feynman_mics": self.feynman_mics,
            "feynman_mic_access": self.feynman_mic_access,
            "feynman_open_mic_settings": self.feynman_open_mic_settings,
        }

    def feynman_mic_access(self, args):
        """Whether the system lets Anki use the microphone:
        {"status": "granted" | "denied" | "undetermined" | "asking" | "unknown"}.

        The page can't tell: when macOS says no, the web engine still opens
        the microphone and simply gets silence. With request=true and the
        question never asked, this asks it (the system prompt appears) and
        answers "asking"; the page then checks again until it's settled.
        """
        try:
            from aqt.qt import QMicrophonePermission, Qt
            perm = QMicrophonePermission()
            status = mw.app.checkPermission(perm)
            if status == Qt.PermissionStatus.Granted:
                return {"status": "granted"}
            if status == Qt.PermissionStatus.Denied:
                return {"status": "denied"}
            if args.get("request"):
                mw.app.requestPermission(perm, lambda *_a: None)
                return {"status": "asking"}
            return {"status": "undetermined"}
        except Exception:
            return {"status": "unknown"}

    def feynman_open_mic_settings(self, args):
        """Show the system's microphone privacy list; the switch is the user's to flip."""
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["/usr/bin/open",
                                  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"])
            elif sys.platform == "win32":
                os.startfile("ms-settings:privacy-microphone")  # type: ignore[attr-defined]
            else:
                return {"error": "Open your system's sound or privacy settings to allow the microphone."}
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def feynman_mics(self, args):
        """The Mac's microphones by their full names (core/feynman.py). A job:
        the lookup takes about a second."""
        return {"job": JOBS.start(lambda _d, _c: {"inputs": FEYN.system_inputs()})}

    def feynman_counts(self, args):
        """{counts: {heading line: answers under it}} for the topic menu."""
        try:
            counts = FEYN.answer_counts(args.get("content") or "")
            return {"counts": {str(k): v for k, v in counts.items()}}
        except Exception as e:
            return _err(e)

    def feynman_audio(self, args):
        """One chunk of a recording. seq 0 starts a new upload."""
        try:
            upload = str(args.get("upload") or "")
            if not upload:
                return {"error": "No upload id."}
            if int(args.get("seq") or 0) == 0:
                # Only one recording is ever in flight; drop any abandoned one.
                self._feynman_uploads = {}
            chunks = self._feynman_uploads.setdefault(upload, [])
            chunks.append(base64.b64decode(args.get("data") or ""))
            if sum(len(c) for c in chunks) > MAX_AUDIO_BYTES:
                self._feynman_uploads.pop(upload, None)
                return {"error": "That recording is too long. Keep it under 10 minutes."}
            return {"ok": True}
        except Exception as e:
            return _err(e)

    def feynman_transcribe(self, args):
        upload = str(args.get("upload") or "")
        audio = b"".join(self._feynman_uploads.pop(upload, []))
        mime = args.get("mime") or "audio/wav"
        provider, model, base_url = _feynman_ai()
        key = KEYS.get(provider)

        def work(_delta, _canceled):
            try:
                text = FEYN.transcribe(provider, key, audio, mime, model, base_url)
            except AI.AIError as e:
                raise _blame("Transcribing", provider, e) from None
            if not text.strip():
                raise AI.AIError("No speech was heard in that recording. Check which microphone is chosen under the record button, and play the recording back to hear what it picked up.")
            return {"transcript": text, "provider": provider}

        return {"job": JOBS.start(work)}

    def feynman_grade(self, args):
        try:
            key_data = FEYN.answer_key(args.get("content") or "", int(args.get("line") or 0))
        except Exception as e:
            return _err(e)
        if key_data.get("error"):
            return key_data
        if not key_data["items"]:
            return {"error": "This section has no cards, so there is nothing to grade."}
        transcript = (args.get("transcript") or "").strip()
        if not transcript:
            return {"error": "There's no transcript to grade."}
        # The same provider, key and model that transcribed it.
        provider, model, base_url = _feynman_ai()
        key = KEYS.get(provider)
        user = FEYN.grading_user_prompt(key_data, transcript)
        system = FEYN.grading_system_prompt(_config().get("feynman_grading_rules") or "")

        def work(_delta, canceled):
            try:
                text, usage = AI.complete(provider, key, model, system,
                                          [{"role": "user", "content": user}], base_url=base_url,
                                          canceled=canceled, temperature=0)
            except AI.AIError as e:
                raise _blame("Grading", provider, e) from None
            USAGE.add("feynman", usage)
            result = FEYN.score_reply(key_data, text)
            result["model"] = model
            return result

        return {"job": JOBS.start(work), "total": len(key_data["items"])}
