"""The user's macOS Text Replacements (System Settings > Keyboard > Text
Replacements), for the editor to apply as you type.

Why this exists: macOS only applies text replacements inside apps built on
Apple's own text views. Anki's web engine (Qt WebEngine / Chromium) never asks
macOS for the list, so replacements silently do nothing in Anki Papers. The
editor re-creates the behavior itself, and this module supplies the list.

It uses Apple's documented API, NSSpellChecker.userReplacementsDictionary,
called through the Objective-C runtime with ctypes -- Anki does not bundle
PyObjC. Each objc_msgSend call is cast to its exact signature, which arm64
requires. Anything other than macOS, or any failure, returns an empty list:
the feature then simply does nothing rather than breaking the editor.
"""
import ctypes
import ctypes.util
import sys
from typing import Dict, List

_APPKIT = "/System/Library/Frameworks/AppKit.framework/AppKit"


def get_text_replacements() -> List[Dict[str, str]]:
    """[{"shortcut": ..., "phrase": ...}, ...] -- empty off macOS or on error."""
    if sys.platform != "darwin":
        return []
    try:
        return _read_replacements()
    except Exception:
        return []


def _read_replacements() -> List[Dict[str, str]]:
    objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
    ctypes.cdll.LoadLibrary(_APPKIT)  # makes the NSSpellChecker class available

    objc.objc_getClass.restype = ctypes.c_void_p
    objc.objc_getClass.argtypes = [ctypes.c_char_p]
    objc.sel_registerName.restype = ctypes.c_void_p
    objc.sel_registerName.argtypes = [ctypes.c_char_p]
    objc.objc_autoreleasePoolPush.restype = ctypes.c_void_p
    objc.objc_autoreleasePoolPop.argtypes = [ctypes.c_void_p]

    send = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value
    vp, ul = ctypes.c_void_p, ctypes.c_ulong
    msg_obj = ctypes.CFUNCTYPE(vp, vp, vp)(send)              # -> id
    msg_obj_at = ctypes.CFUNCTYPE(vp, vp, vp, ul)(send)       # -> id, (NSUInteger)
    msg_obj_for = ctypes.CFUNCTYPE(vp, vp, vp, vp)(send)      # -> id, (id)
    msg_count = ctypes.CFUNCTYPE(ul, vp, vp)(send)            # -> NSUInteger
    msg_utf8 = ctypes.CFUNCTYPE(ctypes.c_char_p, vp, vp)(send)  # -> const char*

    def sel(name: str):
        return objc.sel_registerName(name.encode())

    pool = objc.objc_autoreleasePoolPush()
    try:
        cls = objc.objc_getClass(b"NSSpellChecker")
        if not cls:
            return []
        checker = msg_obj(cls, sel("sharedSpellChecker"))
        table = msg_obj(checker, sel("userReplacementsDictionary")) if checker else None
        if not table:
            return []
        keys = msg_obj(table, sel("allKeys"))
        out = []
        for i in range(msg_count(keys, sel("count"))):
            key = msg_obj_at(keys, sel("objectAtIndex:"), i)
            value = msg_obj_for(table, sel("objectForKey:"), key)
            if not key or not value:
                continue
            raw_key = msg_utf8(key, sel("UTF8String"))
            raw_value = msg_utf8(value, sel("UTF8String"))
            if not raw_key or raw_value is None:
                continue
            shortcut = raw_key.decode("utf-8")
            phrase = raw_value.decode("utf-8")
            if shortcut and shortcut != phrase:
                out.append({"shortcut": shortcut, "phrase": phrase})
        return out
    finally:
        objc.objc_autoreleasePoolPop(pool)
