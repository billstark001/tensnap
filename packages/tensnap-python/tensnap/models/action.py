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
    # Kept as an API-only compatibility argument.  v0.3 deliberately removed
    # this field from ActionSchema; parameter editability is independent.
    allow_runtime_change: bool = True
    scope: str | None = None
    kwargs: list[dict[str, Any]] | None = None

    def __post_init__(self) -> None:
        if not self.label:
            self.label = infer_label_from_id(self.id)

    def to_dict(self) -> dict[str, Any]:
        result = {
            "id": self.id,
            "label": self.label,
        }
        if self.continuous:
            result["continuous"] = True
        if self.scope is not None:
            result["scope"] = self.scope
        if self.kwargs:
            result["kwargs"] = self.kwargs
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ActionMetadata:
        allow = data.get("allowRuntimeChange", data.get("allow_runtime_change", True))
        return cls(
            id=data["id"],
            label=data.get("label", ""),
            continuous=data.get("continuous", False),
            allow_runtime_change=allow,
            scope=data.get("scope"),
            kwargs=data.get("kwargs"),
        )
