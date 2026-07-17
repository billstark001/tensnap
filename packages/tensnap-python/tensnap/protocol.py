"""
TenSnap protocol helpers — pure functions only.

All functions here are side-effect-free and safe to unit-test in isolation.
They consume plain data and return plain data; no I/O, no async.
"""

from collections.abc import Callable, Mapping
from typing import (
    Any,
    cast,
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
    MonitorMetadata,
    Parameter,
    ParameterState,
    clone_environment_state,
)

# region Delta TypedDicts


class ActionDeltas(TypedDict):
    added: list[dict[str, Any]]
    removed: list[str]
    updated: list[dict[str, Any]]


class ParameterDeltas(TypedDict):
    added: list[dict[str, Any]]
    removed: list[str]
    updated: list[dict[str, Any]]


class ChartDeltas(TypedDict):
    added: list[ChartGroupMetadataDict]
    removed: list[str]
    updated: list[ChartGroupMetadataDict]


class MonitorDeltas(TypedDict):
    added: list[dict[str, Any]]
    removed: list[str]
    updated: list[dict[str, Any]]


class EnvironmentDeltas(TypedDict):
    added: "list[EnvironmentState]"
    removed: list[str]
    updated: "list[EnvironmentState]"


class LayerItemOps(TypedDict):
    creates: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    deletes: list[dict[str, Any]]


# endregion

# region Payload builders


def layer_create_payload(env_id: str, layer: "EnvironmentLayerState") -> dict[str, Any]:
    """Build the ENV_LAYER_CREATE payload for a layer."""
    payload: dict[str, Any] = {
        "env_id": env_id,
        "layer_id": layer["layer_id"],
        "layer_type": layer["layer_type"],
    }
    dep_ids = layer_dependency_layer_ids(layer)
    if dep_ids:
        payload["dependency_layer_ids"] = dep_ids
    meta = layer_metadata(layer)
    if meta:
        payload["metadata"] = meta
    return payload


def layer_dependency_layer_ids(
    layer: "EnvironmentLayerState",
) -> dict[str, str] | None:
    if "dependency_layer_ids" not in layer:
        return None
    return dict(layer["dependency_layer_ids"])


def layer_metadata(layer: "EnvironmentLayerState") -> dict[str, Any] | None:
    if "data" not in layer:
        return None
    return dict(layer["data"])


def layer_items(layer: "EnvironmentLayerState") -> list[dict[str, Any]]:
    if "items" in layer:
        return layer["items"]
    if "agents" in layer:
        return layer["agents"]
    if "edges" in layer:
        return layer["edges"]
    return []


def copied_layer_items(layer: "EnvironmentLayerState") -> list[dict[str, Any]]:
    return [dict(item) for item in layer_items(layer)]


def item_identity_fields(layer: "EnvironmentLayerState") -> tuple[str, ...]:
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
    layer: "EnvironmentLayerState", item: dict[str, Any]
) -> tuple[Any, ...]:
    fields = item_identity_fields(layer)
    if fields:
        return tuple(item.get(field) for field in fields)
    return tuple(sorted(item.items()))


def item_key_payload(
    layer: "EnvironmentLayerState", item: dict[str, Any]
) -> dict[str, Any]:
    fields = item_identity_fields(layer)
    if not fields:
        return dict(item)
    return {field: item.get(field) for field in fields}


def item_diff(
    layer: "EnvironmentLayerState",
    current_item: dict[str, Any],
    previous_item: dict[str, Any],
) -> dict[str, Any]:
    diff: dict[str, Any] = {}
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
) -> list[dict[str, Any]]:
    """Convert a chart getter return value into CHART_UPDATE entries."""
    updates: list[dict[str, Any]]
    if not chart.data_list:
        updates = [{"id": chart.id, "value": value}]
    elif isinstance(value, dict):
        updates = [
            {"id": dm.id, "value": value[dm.id]}
            for dm in chart.data_list
            if dm.id in value
        ]
    elif isinstance(value, (list, tuple)):
        updates = [
            {"id": dm.id, "value": v}
            for dm, v in zip(chart.data_list, value, strict=False)
        ]
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
    server_actions: dict[str, ActionMetadata],
    client_actions: list[dict[str, Any]],
) -> ActionDeltas:
    client_ids: set[str] = {x["id"] for x in client_actions}
    server_ids = set(server_actions)
    req = {x["id"]: x for x in client_actions}

    updated = [
        server_actions[aid].to_dict()
        for aid in server_ids & client_ids
        if (
            req[aid].get("label") != server_actions[aid].label
            or req[aid] != server_actions[aid].to_dict()
        )
    ]
    return ActionDeltas(
        added=[server_actions[i].to_dict() for i in server_ids - client_ids],
        removed=list(client_ids - server_ids),
        updated=updated,
    )


def compute_parameter_deltas(
    server_params: dict[str, Parameter],
    client_params: list[ParameterState],
    get_value: Callable[[Parameter], Any],
) -> ParameterDeltas:
    """
    Compute parameter CUD deltas against the client's reported state.

    State-sync inventory is read-only.  The renderer never writes a parameter
    back to the model here; a stale renderer value simply makes the simulator
    re-emit its canonical definition.
    """
    client_ids: set[str] = {x["id"] for x in client_params}
    server_ids = set(server_params)
    req = {x["id"]: x for x in client_params}

    updated_ids: set[str] = set()

    for pid in server_ids & client_ids:
        param = server_params[pid]
        c = req[pid]
        if c["type"] != param.type:
            updated_ids.add(pid)
            continue
        server_descriptor = param.to_dict()
        client_descriptor = dict(c)
        server_descriptor.pop("value", None)
        client_descriptor.pop("value", None)
        if server_descriptor != client_descriptor:
            updated_ids.add(pid)
        if c.get("value") != get_value(param):
            updated_ids.add(pid)
    return ParameterDeltas(
        added=[server_params[i].to_dict() for i in server_ids - client_ids],
        removed=list(client_ids - server_ids),
        updated=[server_params[i].to_dict() for i in updated_ids],
    )


def compute_chart_deltas(
    server_charts: dict[str, tuple[ChartGroupMetadata, Any]],
    client_charts: list[ChartMetadataDict],
) -> ChartDeltas:
    # v0.3 state_sync inventory is intentionally flat: chart groups are
    # simulator-owned definitions, so compare group ids without guessing a
    # group from one of its series ids.
    server_dicts = {
        chart.id: cast(ChartGroupMetadataDict, chart.to_dict())
        for chart, _getter in server_charts.values()
    }
    client_ids = {item["id"] for item in client_charts}
    server_ids = set(server_dicts)
    return ChartDeltas(
        added=[server_dicts[chart_id] for chart_id in server_ids - client_ids],
        removed=list(client_ids - server_ids),
        updated=[],
    )


def compute_monitor_deltas(
    server_monitors: dict[str, tuple[MonitorMetadata, Any]],
    client_monitors: list[dict[str, Any]],
) -> MonitorDeltas:
    server_dicts = {
        monitor.id: monitor.to_dict()
        for monitor, _getter in server_monitors.values()
    }
    client = {item["id"]: item for item in client_monitors if "id" in item}
    server_ids = set(server_dicts)
    client_ids = set(client)
    return MonitorDeltas(
        added=[server_dicts[mid] for mid in server_ids - client_ids],
        removed=list(client_ids - server_ids),
        updated=[
            server_dicts[mid]
            for mid in server_ids & client_ids
            if server_dicts[mid] != client[mid]
        ],
    )


def compute_environment_deltas(
    server_environments: Mapping[str, "EnvironmentRegistrationProtocol"],
    client_envs: list[dict[str, Any]],
) -> EnvironmentDeltas:
    client_ids: set[str] = {x["id"] for x in client_envs}
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

    creates = [dict(item) for k, item in curr.items() if k not in prev]
    updates: list[dict[str, Any]] = []
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
