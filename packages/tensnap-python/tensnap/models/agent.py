"""Agent model for TenSnap simulations"""

from collections.abc import Callable
from typing import (
    TYPE_CHECKING,
    Any,
    TypeAlias,
    TypedDict,
    Literal,
    Union,
    cast,
)

from typing_extensions import NotRequired

from tensnap.utils.attr import make_dict_accessor

if TYPE_CHECKING:
    pass


class AgentModelDict(TypedDict):
    """Type definition for AgentModel dictionary representation"""

    id: str | int
    color: NotRequired[str]
    icon: NotRequired[str]
    size: NotRequired[float]
    data: NotRequired[dict[str, Any]]


class UniformAgentModelDict(AgentModelDict):
    """Type definition for Uniform Agent Model dictionary representation"""

    pass


class GenericAgentModelDict(AgentModelDict):
    """Generic agent dictionary with optional spatial fields."""

    x: NotRequired[float]
    y: NotRequired[float]
    heading: NotRequired[float]


class GridAgentModelDict(AgentModelDict):
    """Type definition for Grid Agent Model dictionary representation"""

    x: float
    y: float
    heading: float


class GraphAgentModelDict(AgentModelDict):
    """Type definition for Graph Agent Model dictionary representation"""

    x: NotRequired[float]
    y: NotRequired[float]


AccessorFieldForInit: TypeAlias = str | bool | None
AccessorField: TypeAlias = str

UniformAgentItemFields: TypeAlias = Literal["id", "color", "icon", "size", "data"]

AgentItemFields: TypeAlias = Union[
    UniformAgentItemFields,
    Literal["x", "y", "heading"],
]

EdgeItemFields: TypeAlias = Literal[
    "source", "target", "directed", "style", "width", "color"
]

TrajectoryConfigItemFields: TypeAlias = Literal["id", "length", "width", "color"]


# TypedDicts for accessor parameters
class UniformAgentAccessorDict(TypedDict):
    """Type definition for uniform agent accessor parameters"""

    id: str
    color: NotRequired[str | bool | None]
    icon: NotRequired[str | bool | None]
    size: NotRequired[str | bool | None]
    data: NotRequired[str | bool | None]


class AgentAccessorDict(UniformAgentAccessorDict):
    """Generic agent accessor parameters with optional spatial fields."""

    x: NotRequired[str | bool | None]
    y: NotRequired[str | bool | None]
    heading: NotRequired[str | bool | None]


class GridAgentAccessorDict(UniformAgentAccessorDict):
    """Type definition for grid agent accessor parameters"""

    x: str
    y: str
    heading: NotRequired[str | bool | None]


class GraphAgentAccessorNXDict(TypedDict):
    """Type definition for graph agent accessor parameters"""

    x: NotRequired[str | bool | None]
    y: NotRequired[str | bool | None]
    color: NotRequired[str | bool | None]
    icon: NotRequired[str | bool | None]
    size: NotRequired[str | bool | None]
    data: NotRequired[str | bool | None]
    auto_collect_data: NotRequired[bool]


class GraphAgentAccessorDict(UniformAgentAccessorDict):
    """Type definition for graph agent accessor parameters"""

    x: NotRequired[str | bool | None]
    y: NotRequired[str | bool | None]


def _a(
    map_fields: dict[str, str],
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
) -> None:

    if color is not None and color is not False:
        map_fields["color"] = "color" if color is True else color
    if icon is not None and icon is not False:
        map_fields["icon"] = "icon" if icon is True else icon
    if size is not None and size is not False:
        map_fields["size"] = "size" if size is True else size
    if data is not None and data is not False:
        map_fields["data"] = "data" if data is True else data


def make_graph_agent_accessor_nx(
    x: str | bool | None = None,
    y: str | bool | None = None,
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    data: str | bool | None = None,
    auto_collect_data: bool = True,
) -> Callable[[str | int, dict[str, Any]], GraphAgentModelDict]:
    """Create a function that accesses fields from an AgentModel in a NetworkX graph"""
    map_fields: dict[str, str] = {}
    if x is not None and x is not False:
        map_fields["x"] = "x" if x is True else x
    if y is not None and y is not False:
        map_fields["y"] = "y" if y is True else y
    _a(map_fields, color, icon, size, data)

    def f(node_id: str | int, node_data: dict[str, Any]) -> GraphAgentModelDict:
        obj: GraphAgentModelDict = {"id": node_id}
        obj_dict = cast(dict[str, Any], obj)
        for field, mapped_field in map_fields.items():
            if mapped_field in node_data:
                obj_dict[field] = node_data[mapped_field]
        if auto_collect_data:
            obj_dict["data"] = {
                k: v for k, v in node_data.items() if k not in map_fields.values()
            }
        return obj

    return f
