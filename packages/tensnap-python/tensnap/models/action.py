"""Action metadata models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tensnap.utils.object import infer_label_from_id


@dataclass
class ActionMetadata:
    """Metadata for a standalone TenSnap action."""

    id: str
    label: str = ""
    continuous: bool = False
    allow_runtime_change: bool = True

    def __post_init__(self) -> None:
        if not self.label:
            self.label = infer_label_from_id(self.id)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "continuous": self.continuous,
            "allowRuntimeChange": self.allow_runtime_change,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ActionMetadata:
        allow = data.get("allowRuntimeChange", data.get("allow_runtime_change", True))
        return cls(
            id=data["id"],
            label=data.get("label", ""),
            continuous=data.get("continuous", False),
            allow_runtime_change=allow,
        )
