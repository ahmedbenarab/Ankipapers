"""
Keep Anki's Tools → Check Media from deleting pictures that papers use.

Check Media counts a file as "unused" when no note field mentions it. A
picture that appears only in a paper -- not on any card -- is therefore
listed, and its Delete Unused button would send it to the trash, breaking the
picture in the paper.

Anki calls gui_hooks.media_check_did_finish with the check's result before it
builds that dialog, and the dialog's Delete Unused button trashes exactly
`output.unused`. Removing the papers' pictures from that list here means they
are never shown as unused and can never be deleted from it; the report text
is edited to match and says what was kept.

This guards Check Media in desktop Anki with the add-on installed. Pictures
added since content-based naming (_ap_<hash>, core/media_refs.py) are safe
everywhere, because Anki itself never lists a file whose name starts with an
underscore.
"""

import traceback

from ..core.media_refs import all_media_names, filter_check_media
from ..core.storage import list_papers


def protect_paper_media(output) -> None:
    try:
        unused = list(output.unused)
        if not unused:
            return
        used = all_media_names(p.content for p in list_papers())
        kept, report = filter_check_media(unused, output.report, used)
        if not kept:
            return
        for n in kept:
            output.unused.remove(n)
        output.report = report
    except Exception:
        # A failure here must never break Anki's own media check.
        traceback.print_exc()
