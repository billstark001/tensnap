"""Monitor metadata used by declarative Python bindings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tensnap.utils.object import infer_label_from_id


@dataclass(frozen=True)
class MonitorMetadata:
    """A renderer-visible monitor declaration and its preferred rendering."""

    id: str
    label: str = ""
    render_hint: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": self.id,
            "label": self.label or infer_label_from_id(self.id),
        }
        if self.render_hint is not None:
            result["render_hint"] = self.render_hint
        return result
