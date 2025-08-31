# tensnap/models/agent.py
"""Agent model for TenSnap simulations"""

from dataclasses import dataclass, field
from typing import Any, Dict, Union, Literal, Optional, Callable, TypedDict


class AgentModelDict(TypedDict):
    """Type definition for AgentModel dictionary representation"""

    id: Union[str, int]
    x: float
    y: float
    heading: float
    color: Optional[str]
    icon: Literal["arrow", "circle", "square", "triangle"]
    size: float
    data: Dict[str, Any]


@dataclass
class AgentModel:
    """Agent model for TenSnap visualization (not simulation logic)"""

    id: Union[str, int]
    x: float = 0
    y: float = 0
    heading: float = 0
    color: Optional[str] = None
    icon: Literal["arrow", "circle", "square", "triangle"] = "circle"
    size: float = 10
    data: Dict[str, Any] = field(default_factory=dict)
    update_func: Optional[Callable[["AgentModel", Any], None]] = field(
        default=None, repr=False
    )
    update_source: Optional[Any] = field(default=None, repr=False)

    def to_dict(self) -> AgentModelDict:
        """Convert to dictionary for serialization"""
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "heading": self.heading,
            "color": self.color,
            "icon": self.icon,
            "size": self.size,
            "data": self.data,
        }

    def update(self, source: Optional[Any] = None) -> None:
        """Update this model from a real agent instance"""
        actual_source = source if source is not None else self.update_source

        if self.update_func and actual_source is not None:
            self.update_func(self, actual_source)
        elif actual_source is not None:
            # Default update logic - try to copy common attributes
            if hasattr(actual_source, "x"):
                self.x = actual_source.x
            if hasattr(actual_source, "y"):
                self.y = actual_source.y
            if hasattr(actual_source, "heading"):
                self.heading = actual_source.heading
            if hasattr(actual_source, "color"):
                self.color = actual_source.color
            if hasattr(actual_source, "size"):
                self.size = actual_source.size
