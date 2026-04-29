"""Typed helpers for canonical environment state handling."""

# region Imports

from copy import deepcopy
from typing import Any, cast

from tensnap.models import (
    EnvironmentBinderProtocol,
    EnvironmentLayerState,
    EnvironmentState,
    GraphEdgeDict,
)

# endregion

# region Type Aliases

AgentState = dict[str, Any]
EdgeDiff = dict[str, Any]
ItemState = dict[str, Any]
ItemKey = tuple[Any, ...]

# endregion

# region State Builders


def clone_environment_state(state: EnvironmentState) -> EnvironmentState:
    return cast(EnvironmentState, deepcopy(state))


def layer_metadata(layer: EnvironmentLayerState) -> dict[str, Any]:
    metadata = deepcopy(cast(dict[str, Any], layer.get("data", {})))
    metadata.pop("dependency_layer_ids", None)
    return metadata


def layer_dependency_layer_ids(layer: EnvironmentLayerState) -> dict[str, str]:
    return deepcopy(cast(dict[str, str], layer.get("dependency_layer_ids", {})))


def layer_agents(layer: EnvironmentLayerState) -> list[AgentState]:
    return cast(list[AgentState], layer.get("agents", []))


def copied_layer_agents(layer: EnvironmentLayerState) -> list[AgentState]:
    return deepcopy(layer_agents(layer))


def layer_edges(layer: EnvironmentLayerState) -> list[GraphEdgeDict]:
    return cast(list[GraphEdgeDict], layer.get("edges", []))


def copied_layer_edges(layer: EnvironmentLayerState) -> list[GraphEdgeDict]:
    return deepcopy(layer_edges(layer))


def layer_items(layer: EnvironmentLayerState) -> list[ItemState]:
    if "items" in layer:
        return cast(list[ItemState], layer.get("items", []))
    if layer.get("layer_type") == "agent":
        return cast(list[ItemState], layer.get("agents", []))
    if layer.get("layer_type") == "edge":
        return cast(list[ItemState], layer.get("edges", []))
    return []


def copied_layer_items(layer: EnvironmentLayerState) -> list[ItemState]:
    return deepcopy(layer_items(layer))


# endregion

# region Diffs


def agent_diff(current: AgentState, previous: AgentState) -> AgentState:
    diff: AgentState = {"id": current["id"]}
    for key in (set(current.keys()) | set(previous.keys())) - {"id"}:
        if key not in current and key in previous:
            diff[key] = None
            continue
        if key in current and current.get(key) != previous.get(key):
            diff[key] = current[key]
    return diff


def edge_diff(current: GraphEdgeDict, previous: GraphEdgeDict) -> EdgeDiff:
    diff: EdgeDiff = {
        "source": current["source"],
        "target": current["target"],
    }
    for key in (set(current.keys()) | set(previous.keys())) - {"source", "target"}:
        if key not in current and key in previous:
            diff[key] = None
            continue
        if key in current and current.get(key) != previous.get(key):
            diff[key] = current[key]
    return diff


def item_identity_fields(layer: EnvironmentLayerState) -> tuple[str, ...]:
    if layer.get("layer_type") == "edge":
        return ("source", "target")
    return ("id",)


def item_identity_key(layer: EnvironmentLayerState, item: ItemState) -> ItemKey:
    return tuple(item[field] for field in item_identity_fields(layer))


def item_key_payload(layer: EnvironmentLayerState, item: ItemState) -> ItemState:
    return {field: item[field] for field in item_identity_fields(layer)}


def item_diff(
    layer: EnvironmentLayerState,
    current: ItemState,
    previous: ItemState,
) -> ItemState:
    identity_fields = set(item_identity_fields(layer))
    diff: ItemState = {field: current[field] for field in identity_fields}
    for key in (set(current.keys()) | set(previous.keys())) - identity_fields:
        if key not in current and key in previous:
            diff[key] = None
            continue
        if key in current and current.get(key) != previous.get(key):
            diff[key] = current[key]
    return diff


# endregion
