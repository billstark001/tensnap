"""Tile models for TenSnap simulations

Tiles are objects with fixed coordinates and custom rendering behavior.
They serve as complements to agents and can partially replace background rendering.
"""

from collections.abc import Callable
from typing import (
    Any,
    TypedDict,
)
from typing_extensions import NotRequired

from tensnap.utils.attr import make_dict_accessor


class TileModelDict(TypedDict):
    """Type definition for Tile dictionary representation
    
    Tiles are positioned objects with custom rendering, similar to agents
    but typically stationary or infrequently updated.
    """

    id: str | int
    x: float
    y: float
    color: NotRequired[str]
    icon: NotRequired[str]  # "circle" | "square" | "triangle" | custom
    size: NotRequired[float]
    shape: NotRequired[str]  # For custom shapes
    layer: NotRequired[int]  # Z-index for rendering order
    opacity: NotRequired[float]  # 0.0 to 1.0
    rotation: NotRequired[float]  # In radians
    data: NotRequired[dict[str, Any]]  # Custom data


class GridTileModelDict(TileModelDict):
    """Type definition for Grid Tile Model dictionary representation"""
    pass


class GraphTileModelDict(TileModelDict):
    """Type definition for Graph Tile Model dictionary representation"""
    pass


class UniformTileModelDict(TileModelDict):
    """Type definition for Uniform Tile Model dictionary representation"""
    pass


# TypedDicts for accessor parameters
class TileAccessorDict(TypedDict):
    """Type definition for tile accessor parameters"""
    id: str
    x: str
    y: str
    color: NotRequired[str | bool | None]
    icon: NotRequired[str | bool | None]
    size: NotRequired[str | bool | None]
    shape: NotRequired[str | bool | None]
    layer: NotRequired[str | bool | None]
    opacity: NotRequired[str | bool | None]
    rotation: NotRequired[str | bool | None]
    data: NotRequired[str | bool | None]


class GridTileAccessorDict(TileAccessorDict):
    """Type definition for grid tile accessor parameters"""
    pass


class GraphTileAccessorDict(TileAccessorDict):
    """Type definition for graph tile accessor parameters"""
    pass


class UniformTileAccessorDict(TileAccessorDict):
    """Type definition for uniform tile accessor parameters"""
    pass


def _tile_accessor_helper(
    map_fields: dict[str, str],
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    shape: str | bool | None = None,
    layer: str | bool | None = None,
    opacity: str | bool | None = None,
    rotation: str | bool | None = None,
    data: str | bool | None = None,
):
    """Helper function to populate map_fields dict for tile accessors"""
    if color is not None and color is not False:
        map_fields["color"] = "color" if color is True else color
    if icon is not None and icon is not False:
        map_fields["icon"] = "icon" if icon is True else icon
    if size is not None and size is not False:
        map_fields["size"] = "size" if size is True else size
    if shape is not None and shape is not False:
        map_fields["shape"] = "shape" if shape is True else shape
    if layer is not None and layer is not False:
        map_fields["layer"] = "layer" if layer is True else layer
    if opacity is not None and opacity is not False:
        map_fields["opacity"] = "opacity" if opacity is True else opacity
    if rotation is not None and rotation is not False:
        map_fields["rotation"] = "rotation" if rotation is True else rotation
    if data is not None and data is not False:
        map_fields["data"] = "data" if data is True else data


def make_tile_accessor(
    id: str = "id",
    x: str = "x",
    y: str = "y",
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    shape: str | bool | None = None,
    layer: str | bool | None = None,
    opacity: str | bool | None = None,
    rotation: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], TileModelDict]:
    """Create a function that accesses fields from a Tile object"""
    map_fields: dict[str, str] = {}
    map_fields["id"] = id
    map_fields["x"] = x
    map_fields["y"] = y
    _tile_accessor_helper(
        map_fields, color, icon, size, shape, layer, opacity, rotation, data
    )
    return make_dict_accessor([], map_fields, {})  # type: ignore


def make_grid_tile_accessor(
    id: str = "id",
    x: str = "x",
    y: str = "y",
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    shape: str | bool | None = None,
    layer: str | bool | None = None,
    opacity: str | bool | None = None,
    rotation: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], GridTileModelDict]:
    """Create a function that accesses fields from a Grid Tile object"""
    return make_tile_accessor(
        id, x, y, color, icon, size, shape, layer, opacity, rotation, data
    )  # type: ignore


def make_graph_tile_accessor(
    id: str = "id",
    x: str = "x",
    y: str = "y",
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    shape: str | bool | None = None,
    layer: str | bool | None = None,
    opacity: str | bool | None = None,
    rotation: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], GraphTileModelDict]:
    """Create a function that accesses fields from a Graph Tile object"""
    return make_tile_accessor(
        id, x, y, color, icon, size, shape, layer, opacity, rotation, data
    )  # type: ignore


def make_uniform_tile_accessor(
    id: str = "id",
    x: str = "x",
    y: str = "y",
    color: str | bool | None = None,
    icon: str | bool | None = None,
    size: str | bool | None = None,
    shape: str | bool | None = None,
    layer: str | bool | None = None,
    opacity: str | bool | None = None,
    rotation: str | bool | None = None,
    data: str | bool | None = None,
) -> Callable[[Any], UniformTileModelDict]:
    """Create a function that accesses fields from a Uniform Tile object"""
    return make_tile_accessor(
        id, x, y, color, icon, size, shape, layer, opacity, rotation, data
    )  # type: ignore
