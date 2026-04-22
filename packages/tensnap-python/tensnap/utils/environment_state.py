"""Typed helpers for canonical environment state handling."""

#region Imports

from copy import deepcopy
from typing import Any, cast

from tensnap.models import (
    EnvironmentBinderProtocol,
    EnvironmentLayerState,
    EnvironmentState,
    GraphEdgeDict,
)

#endregion

#region Type Aliases

AgentState = dict[str, Any]
EdgeDiff = dict[str, Any]

#endregion

#region State Builders

def clone_environment_state(state: EnvironmentState) -> EnvironmentState:
    return cast(EnvironmentState, deepcopy(state))


def build_environment_state(env: EnvironmentBinderProtocol) -> EnvironmentState:
    state_getter = getattr(env, "get_state", None)
    if callable(state_getter):
        candidate = state_getter()
        if isinstance(candidate, dict) and {"id", "type", "layers"}.issubset(candidate.keys()):
            return clone_environment_state(cast(EnvironmentState, candidate))

    model_dict = env.get_model_dict()
    env_id = getattr(env, "id", model_dict.get("id", "environment"))
    legacy_type = model_dict.get("type", "uniform")
    metadata = {
        key: value
        for key, value in model_dict.items()
        if key not in ("id", "type", "edges")
    }
    agents = deepcopy(env.get_agent_list())

    edge_getter = getattr(env, "get_edge_list", None)
    if callable(edge_getter):
        edges: list[GraphEdgeDict] = deepcopy(
            cast(list[GraphEdgeDict], edge_getter())
        )
    else:
        edges = deepcopy(cast(list[GraphEdgeDict], model_dict.get("edges", [])))

    if legacy_type == "graph":
        layers: list[EnvironmentLayerState] = []

        agent_layer: EnvironmentLayerState = {
            "layer_id": "agents",
            "layer_type": "agent",
        }
        if agents:
            agent_layer["agents"] = agents
        layers.append(agent_layer)

        edge_layer: EnvironmentLayerState = {
            "layer_id": "edges",
            "layer_type": "edge",
        }
        if metadata:
            edge_layer["data"] = metadata
        if edges:
            edge_layer["edges"] = edges
        layers.append(edge_layer)

        return {"id": env_id, "type": "2d", "layers": layers}

    if legacy_type == "grid":
        layer: EnvironmentLayerState = {
            "layer_id": "grid",
            "layer_type": "grid",
        }
        if metadata:
            layer["data"] = metadata
        if agents:
            layer["agents"] = agents
        return {"id": env_id, "type": "2d", "layers": [layer]}

    layers: list[EnvironmentLayerState] = []
    if metadata or agents:
        layer: EnvironmentLayerState = {
            "layer_id": "agents",
            "layer_type": "agent",
        }
        if metadata:
            layer["data"] = metadata
        if agents:
            layer["agents"] = agents
        layers.append(layer)

    return {"id": env_id, "type": "uniform", "layers": layers}


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

#endregion

#region Diffs

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

#endregion