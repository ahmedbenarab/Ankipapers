"""
Paper data model for Anki Papers.

A Paper represents a single document containing notes and flashcard definitions.
"""

import uuid
import time
from typing import List, Optional, Dict, Any


class CardReference:
    """Tracks the relationship between a line in a paper and an Anki note."""

    def __init__(
        self,
        line_index: int,
        card_type: str,
        anki_note_id: Optional[int] = None,
        content_hash: str = "",
        synced: bool = False,
        block_id: Optional[str] = None,
    ):
        self.line_index = line_index
        self.card_type = card_type  # "basic" or "cloze"
        self.anki_note_id = anki_note_id
        self.content_hash = content_hash
        self.synced = synced
        self.block_id = block_id

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "line_index": self.line_index,
            "card_type": self.card_type,
            "anki_note_id": self.anki_note_id,
            "content_hash": self.content_hash,
            "synced": self.synced,
        }
        if self.block_id:
            d["block_id"] = self.block_id
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CardReference":
        return cls(
            line_index=data.get("line_index", 0),
            card_type=data.get("card_type", "basic"),
            anki_note_id=data.get("anki_note_id"),
            content_hash=data.get("content_hash", ""),
            synced=data.get("synced", False),
            block_id=data.get("block_id"),
        )


class Paper:
    """
    Represents a single document / paper.

    Attributes:
        id: Unique identifier for this paper
        title: Display title
        content: The raw text content
        deck_name: Target Anki deck
        folder_path: Hierarchical folder path (e.g., "Biology/Cell Biology")
        card_refs: List of card references linking lines to Anki notes
        created_at: Creation timestamp
        modified_at: Last modification timestamp
        tags: Additional Anki tags to apply to generated cards
    """

    def __init__(
        self,
        title: str = "Untitled Paper",
        content: str = "",
        deck_name: str = "Default",
        folder_path: str = "",
        paper_id: Optional[str] = None,
    ):
        self.id = paper_id or str(uuid.uuid4())
        self.title = title
        self.content = content
        self.deck_name = deck_name
        self.folder_path = folder_path
        self.card_refs: List[CardReference] = []
        self.created_at = time.time()
        self.modified_at = time.time()
        self.tags: List[str] = []

    @property
    def full_path(self) -> str:
        if self.folder_path:
            return f"{self.folder_path}/{self.title}"
        return self.title

    @property
    def card_count(self) -> int:
        return len(self.card_refs)

    @property
    def synced_count(self) -> int:
        return sum(1 for ref in self.card_refs if ref.synced)

    def update_content(self, new_content: str):
        self.content = new_content
        self.modified_at = time.time()

    def add_card_ref(self, ref: CardReference):
        self.card_refs.append(ref)

    def clear_card_refs(self):
        self.card_refs.clear()

    def get_card_ref_for_line(self, line_index: int) -> Optional[CardReference]:
        for ref in self.card_refs:
            if ref.line_index == line_index:
                return ref
        return None

    def get_card_ref_for_block_id(self, block_id: str) -> Optional[CardReference]:
        for ref in self.card_refs:
            if ref.block_id and ref.block_id == block_id:
                return ref
        return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "deck_name": self.deck_name,
            "folder_path": self.folder_path,
            "card_refs": [ref.to_dict() for ref in self.card_refs],
            "created_at": self.created_at,
            "modified_at": self.modified_at,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Paper":
        paper = cls(
            title=data.get("title", "Untitled Paper"),
            content=data.get("content", ""),
            deck_name=data.get("deck_name", "Default"),
            folder_path=data.get("folder_path", ""),
            paper_id=data.get("id"),
        )
        paper.card_refs = [
            CardReference.from_dict(ref_data)
            for ref_data in data.get("card_refs", [])
        ]
        paper.created_at = data.get("created_at", time.time())
        paper.modified_at = data.get("modified_at", time.time())
        paper.tags = data.get("tags", [])
        return paper
