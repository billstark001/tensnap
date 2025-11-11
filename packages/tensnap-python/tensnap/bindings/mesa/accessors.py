# tensnap/bindings/mesa/accessors.py
"""Mesa 3-compatible accessor TypedDict definitions"""

from typing import TypedDict


class Mesa3UniformAgentAccessorDict(TypedDict, total=False):
    """Mesa 3 compatible uniform agent accessor parameters"""
    id: str  # Default: "unique_id"
    color: str | bool | None  # Optional agent color attribute
    icon: str | bool | None  # Optional agent icon attribute
    size: str | bool | None  # Optional agent size attribute
    data: str | bool | None  # Optional data dictionary attribute


class Mesa3GridAgentAccessorDict(Mesa3UniformAgentAccessorDict):
    """Mesa 3 compatible grid agent accessor parameters"""
    x: str  # Default: "pos[0]" for extracting x from pos tuple
    y: str  # Default: "pos[1]" for extracting y from pos tuple
    heading: str | bool | None  # Optional heading attribute


class Mesa3GraphAgentAccessorDict(TypedDict, total=False):
    """Mesa 3 compatible graph agent accessor parameters (for node data)"""
    id: str  # Will use node_id from the graph
    x: str | bool | None  # Optional x coordinate
    y: str | bool | None  # Optional y coordinate
    color: str | bool | None  # Optional color attribute
    icon: str | bool | None  # Optional icon attribute
    size: str | bool | None  # Optional size attribute
    data: str | bool | None  # Optional data dictionary attribute


class Mesa3GridEnvironmentAccessorDict(TypedDict, total=False):
    """Mesa 3 compatible grid environment accessor parameters"""
    id: str  # Environment identifier
    width: str  # Default: "grid.width"
    height: str  # Default: "grid.height"
    background: str | bool | None  # Optional background image


# Default Mesa 3 accessor configurations
DEFAULT_MESA3_UNIFORM_AGENT_ACCESSOR: Mesa3UniformAgentAccessorDict = {
    "id": "unique_id",
}

DEFAULT_MESA3_GRID_AGENT_ACCESSOR: Mesa3GridAgentAccessorDict = {
    "id": "unique_id",
    "x": "pos[0]",
    "y": "pos[1]",
}

DEFAULT_MESA3_GRID_ENVIRONMENT_ACCESSOR: Mesa3GridEnvironmentAccessorDict = {
    "id": "grid",
    "width": "grid.width",
    "height": "grid.height",
}
