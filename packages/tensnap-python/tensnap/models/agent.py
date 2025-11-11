# tensnap/models/agent.py
"""Agent model for TenSnap simulations"""

from dataclasses import dataclass, field
from typing import (
    Any,
    Dict,
    Union,
    Literal,
    Optional,
    Callable,
    TypedDict,
    NotRequired,
    TYPE_CHECKING,
)


from tensnap.utils.attr import make_dict_accessor

if TYPE_CHECKING:
    import networkx as nx


class AgentModelDict(TypedDict):
    """Type definition for AgentModel dictionary representation"""

    id: Union[str, int]
    color: NotRequired[str]
    icon: NotRequired[str]
    size: NotRequired[float]
    data: NotRequired[Dict[str, Any]]


class UniformAgentModelDict(AgentModelDict):
    """Type definition for Uniform Agent Model dictionary representation"""

    pass


class GridAgentModelDict(AgentModelDict):
    """Type definition for Grid Agent Model dictionary representation"""

    x: float
    y: float
    heading: float


class GraphAgentModelDict(AgentModelDict):
    """Type definition for Graph Agent Model dictionary representation"""

    x: NotRequired[float]
    y: NotRequired[float]


# TypedDicts for accessor parameters
class UniformAgentAccessorDict(TypedDict, total=False):
    """Type definition for uniform agent accessor parameters"""
    id: str
    color: Union[str, bool, None]
    icon: Union[str, bool, None]
    size: Union[str, bool, None]
    data: Union[str, bool, None]


class GridAgentAccessorDict(UniformAgentAccessorDict):
    """Type definition for grid agent accessor parameters"""
    x: str
    y: str
    heading: Union[str, bool, None]


class GraphAgentAccessorDict(TypedDict, total=False):
    """Type definition for graph agent accessor parameters"""
    id: str
    x: Union[str, bool, None]
    y: Union[str, bool, None]
    color: Union[str, bool, None]
    icon: Union[str, bool, None]
    size: Union[str, bool, None]
    data: Union[str, bool, None]


def _a(
    map_fields: Dict[str, str],
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
):

    if color is not None and color is not False:
        map_fields["color"] = "color" if color is True else color
    if icon is not None and icon is not False:
        map_fields["icon"] = "icon" if icon is True else icon
    if size is not None and size is not False:
        map_fields["size"] = "size" if size is True else size
    if data is not None and data is not False:
        map_fields["data"] = "data" if data is True else data


def make_uniform_agent_accessor(
    id: str = "id",
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], UniformAgentModelDict]:
    """Create a function that accesses fields from an AgentModel"""
    map_fields: Dict[str, str] = {}
    map_fields["id"] = id
    _a(map_fields, color, icon, size, data)
    return make_dict_accessor([], map_fields, {})  # type: ignore


def make_grid_agent_accessor(
    id: str = "id",
    x: str = "x",
    y: str = "y",
    heading: str | bool | None = None,
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], GridAgentModelDict]:
    """Create a function that accesses fields from an AgentModel"""
    map_fields: Dict[str, str] = {}
    map_fields["id"] = id
    map_fields["x"] = x
    map_fields["y"] = y
    if heading is not None and heading is not False:
        map_fields["heading"] = "heading" if heading is True else heading
    _a(map_fields, color, icon, size, data)
    return make_dict_accessor([], map_fields, {})  # type: ignore


def make_graph_agent_accessor(
    id: str = "id",
    x: str | bool | None = None,
    y: str | bool | None = None,
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], GraphAgentModelDict]:
    """Create a function that accesses fields from an AgentModel"""
    map_fields: Dict[str, str] = {}
    map_fields["id"] = id
    if x is not None and x is not False:
        map_fields["x"] = "x" if x is True else x
    if y is not None and y is not False:
        map_fields["y"] = "y" if y is True else y
    _a(map_fields, color, icon, size, data)
    return make_dict_accessor([], map_fields, {})  # type: ignore


def make_graph_agent_accessor_nx(
    x: str | bool | None = None,
    y: str | bool | None = None,
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
    auto_collect_data: bool = True,
) -> Callable[[str | int, Dict[str, Any]], GraphAgentModelDict]:
    """Create a function that accesses fields from an AgentModel in a NetworkX graph"""
    map_fields: Dict[str, str] = {}
    if x is not None and x is not False:
        map_fields["x"] = "x" if x is True else x
    if y is not None and y is not False:
        map_fields["y"] = "y" if y is True else y
    _a(map_fields, color, icon, size, data)

    def f(node_id, node_data) -> GraphAgentModelDict:
        obj = {"id": node_id}
        for field, mapped_field in map_fields.items():
            if mapped_field in node_data:
                obj[field] = node_data[mapped_field]
        if auto_collect_data:
            obj["data"] = {
                k: v for k, v in node_data.items() if k not in map_fields.values()
            }
        return obj  # type: ignore

    return f
