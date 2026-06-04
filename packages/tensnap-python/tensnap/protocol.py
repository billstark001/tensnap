"""
TenSnap protocol helpers — pure functions only.

All functions here are side-effect-free and safe to unit-test in isolation.
They consume plain data and return plain data; no I/O, no async.
"""

from copy import deepcopy
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Mapping,
    Set,
    Tuple,
)

from typing_extensions import TypedDict

from .bindings.basic.chart import categorize_charts
from .models import (
    ActionMetadata,
    ChartGroupMetadata,
    ChartGroupMetadataDict,
    ChartMetadataDict,
    EnvironmentLayerState,
    EnvironmentRegistrationProtocol,
    EnvironmentState,
    Parameter,
    ParameterState,
    clone_environment_state,
)

# region Delta TypedDicts


class ActionDeltas(TypedDict):
    added: List[Dict[str, Any]]
    removed: List[str]
    updated: List[Dict[str, Any]]


class ParameterDeltas(TypedDict):
    added: List[Dict[str, Any]]
    removed: List[str]
    updated: List[Dict[str, Any]]


class ChartDeltas(TypedDict):
    added: List[Dict[str, Any]]
    removed: List[str]
    updated: List[Dict[str, Any]]


class EnvironmentDeltas(TypedDict):
    added: "List[EnvironmentState]"
    removed: List[str]
    updated: "List[EnvironmentState]"


class LayerItemOps(TypedDict):
    creates: List[Dict[str, Any]]
    updates: List[Dict[str, Any]]
    deletes: List[Dict[str, Any]]


# endregion

# region Payload builders


def layer_create_payload(env_id: str, layer: "EnvironmentLayerState") -> Dict[str, Any]:
    """Build the ENV_LAYER_CREATE payload for a layer."""
    payload: Dict[str, Any] = {
        "env_id": env_id,
        "layer_id": layer["layer_id"],
        "layer_type": layer["layer_type"],
    }
    dep_ids = layer_dependency_layer_ids(layer)
    if dep_ids:
        payload["dependency_layer_ids"] = dep_ids
    meta = layer_metadata(layer)
    if meta:
        payload["data"] = meta
    return payload


def layer_dependency_layer_ids(
    layer: "EnvironmentLayerState",
) -> Dict[str, str] | None:
    if "dependency_layer_ids" not in layer:
        return None
    return dict(layer["dependency_layer_ids"])


def layer_metadata(layer: "EnvironmentLayerState") -> Dict[str, Any] | None:
    if "data" not in layer:
        return None
    return dict(layer["data"])


def layer_items(layer: "EnvironmentLayerState") -> List[Dict[str, Any]]:
    if "items" in layer:
        return layer["items"]
    if "agents" in layer:
        return layer["agents"]
    if "edges" in layer:
        return layer["edges"]
    return []


def copied_layer_items(layer: "EnvironmentLayerState") -> List[Dict[str, Any]]:
    return [deepcopy(item) for item in layer_items(layer)]


def item_identity_fields(layer: "EnvironmentLayerState") -> Tuple[str, ...]:
    items = layer_items(layer)
    sample = items[0] if items else {}

    if layer["layer_type"] == "edge":
        if "source" in sample and "target" in sample:
            return ("source", "target")
        return ("source", "target")

    if "id" in sample:
        return ("id",)
    if "name" in sample:
        return ("name",)
    if "uid" in sample:
        return ("uid",)
    return tuple()


def item_identity_key(
    layer: "EnvironmentLayerState", item: Dict[str, Any]
) -> Tuple[Any, ...]:
    fields = item_identity_fields(layer)
    if fields:
        return tuple(item.get(field) for field in fields)
    return tuple(sorted(item.items()))


def item_key_payload(
    layer: "EnvironmentLayerState", item: Dict[str, Any]
) -> Dict[str, Any]:
    fields = item_identity_fields(layer)
    if not fields:
        return deepcopy(item)
    return {field: item.get(field) for field in fields}


def item_diff(
    layer: "EnvironmentLayerState",
    current_item: Dict[str, Any],
    previous_item: Dict[str, Any],
) -> Dict[str, Any]:
    diff: Dict[str, Any] = {}
    for key in set(previous_item) | set(current_item):
        if key not in current_item:
            diff[key] = None
        elif key not in previous_item or current_item[key] != previous_item[key]:
            diff[key] = current_item[key]

    for field in item_identity_fields(layer):
        diff[field] = current_item.get(field)
    return diff


def format_chart_update(
    chart: ChartGroupMetadata,
    value: Any,
    time: int | None = None,
) -> List[Dict[str, Any]]:
    """Convert a chart getter return value into CHART_UPDATE entries."""
    updates: List[Dict[str, Any]]
    if not chart.data_list:
        updates = [{"id": chart.id, "value": value}]
    elif isinstance(value, dict):
        updates = [
            {"id": dm.id, "value": value[dm.id]}
            for dm in chart.data_list
            if dm.id in value
        ]
    elif isinstance(value, (list, tuple)):
        updates = [{"id": dm.id, "value": v} for dm, v in zip(chart.data_list, value)]
    elif len(chart.data_list) == 1:
        updates = [{"id": chart.data_list[0].id, "value": value}]
    else:
        raise ValueError(
            f"Chart getter for '{chart.id}' returned unsupported type for "
            f"multiple data series: {type(value)}"
        )

    if time is not None:
        for update in updates:
            update["time"] = time
    return updates


# endregion

# region Delta computation


def compute_action_deltas(
    server_actions: Dict[str, ActionMetadata],
    client_actions: List[Dict[str, Any]],
) -> ActionDeltas:
    client_ids: Set[str] = {x["id"] for x in client_actions}
    server_ids = set(server_actions)
    req = {x["id"]: x for x in client_actions}

    updated = [
        server_actions[aid].to_dict()
        for aid in server_ids & client_ids
        if (
            req[aid].get("label") != server_actions[aid].label
            or req[aid].get("continuous") != server_actions[aid].continuous
            or req[aid].get("allowRuntimeChange", True)
            != server_actions[aid].allow_runtime_change
        )
    ]
    return ActionDeltas(
        added=[server_actions[i].to_dict() for i in server_ids - client_ids],
        removed=list(client_ids - server_ids),
        updated=updated,
    )


def compute_parameter_deltas(
    server_params: Dict[str, Parameter],
    client_params: List[ParameterState],
    get_value: Callable[[Parameter], Any],
) -> Tuple[ParameterDeltas, List[Tuple[str, Any]]]:
    """
    Compute parameter CUD deltas against the client's reported state.

    Returns:
        deltas:        Added / removed / updated parameter descriptors.
        value_updates: ``(param_id, client_value)`` pairs to apply server-side
                       (client wins on sync for already-known params).
    """
    client_ids: Set[str] = {x["id"] for x in client_params}
    server_ids = set(server_params)
    req = {x["id"]: x for x in client_params}

    updated_ids: Set[str] = set()
    value_updates: List[Tuple[str, Any]] = []

    for pid in server_ids & client_ids:
        param = server_params[pid]
        c = req[pid]
        if c["type"] != param.type:
            updated_ids.add(pid)
            continue
        client_val = c.get("value")
        if client_val is None:
            updated_ids.add(pid)
        elif client_val != get_value(param):
            value_updates.append((pid, client_val))

    return (
        ParameterDeltas(
            added=[server_params[i].to_dict() for i in server_ids - client_ids],
            removed=list(client_ids - server_ids),
            updated=[server_params[i].to_dict() for i in updated_ids],
        ),
        value_updates,
    )


def compute_chart_deltas(
    server_charts: Dict[str, Tuple[ChartGroupMetadata, Any]],
    client_charts: List[ChartMetadataDict],
) -> ChartDeltas:
    server_dicts: List[ChartGroupMetadataDict] = [
        c[0].to_dict() for c in server_charts.values()
    ]  # type: ignore
    result = categorize_charts(client_charts, server_dicts)
    return ChartDeltas(
        added=result["added"],
        removed=result["removed"],
        updated=result["updated"],
    )


def compute_environment_deltas(
    server_environments: Mapping[str, "EnvironmentRegistrationProtocol"],
    client_envs: List[Dict[str, Any]],
) -> EnvironmentDeltas:
    client_ids: Set[str] = {x["id"] for x in client_envs}
    server_ids = set(server_environments)
    return EnvironmentDeltas(
        added=[
            clone_environment_state(server_environments[i].build_state())
            for i in server_ids - client_ids
        ],
        removed=list(client_ids - server_ids),
        updated=[
            clone_environment_state(server_environments[i].build_state())
            for i in server_ids & client_ids
        ],
    )


# endregion

# region Layer / item diffing


def diff_layer_items(
    current_layer: "EnvironmentLayerState",
    previous_layer: "EnvironmentLayerState",
) -> LayerItemOps:
    """Diff two layer states and return item-level create / update / delete ops."""
    prev = {
        item_identity_key(previous_layer, item): item
        for item in layer_items(previous_layer)
    }
    curr = {
        item_identity_key(current_layer, item): item
        for item in layer_items(current_layer)
    }
    if not prev and not curr:
        return LayerItemOps(creates=[], updates=[], deletes=[])

    id_field_count = len(item_identity_fields(current_layer))

    creates = [deepcopy(item) for k, item in curr.items() if k not in prev]
    updates: List[Dict[str, Any]] = []
    for k, item in curr.items():
        if k not in prev:
            continue
        diff = item_diff(current_layer, item, prev[k])
        if len(diff) > id_field_count:
            updates.append(diff)
    deletes = [
        item_key_payload(previous_layer, prev[k]) for k in prev.keys() - curr.keys()
    ]
    return LayerItemOps(creates=creates, updates=updates, deletes=deletes)


# endregion
