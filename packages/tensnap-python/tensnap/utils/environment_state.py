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

# endregion

# region State Builders


def clone_environment_state(state: EnvironmentState) -> EnvironmentState:
    return cast(EnvironmentState, deepcopy(state))


def layer_metadata(layer: EnvironmentLayerState) -> dict[str, Any]:
    return deepcopy(cast(dict[str, Any], layer.get("data", {})))


def layer_agents(layer: EnvironmentLayerState) -> list[AgentState]:
    return cast(list[AgentState], layer.get("agents", []))


def copied_layer_agents(layer: EnvironmentLayerState) -> list[AgentState]:
    return deepcopy(layer_agents(layer))


def layer_edges(layer: EnvironmentLayerState) -> list[GraphEdgeDict]:
    return cast(list[GraphEdgeDict], layer.get("edges", []))


def copied_layer_edges(layer: EnvironmentLayerState) -> list[GraphEdgeDict]:
    return deepcopy(layer_edges(layer))


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


# endregion
