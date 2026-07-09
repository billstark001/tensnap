"""Shared helpers for scenario state synchronization and broadcasts."""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from .models import EnvironmentRegistration, EnvironmentState
from .protocol import (
    copied_layer_items,
    layer_create_payload,
    layer_dependency_layer_ids,
    layer_metadata,
)
from .server import ServerToClientMessageType as MT
from .server import TenSnapServer

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from .models import EnvironmentLayerState


async def send_layer_full(
    target: "ServerConnection | None",
    server: TenSnapServer,
    env_id: str,
    layer: "EnvironmentLayerState",
) -> None:
    """Send a full layer create + all items to ``target`` (or broadcast if None)."""
    payload = layer_create_payload(env_id, layer)
    lid = layer["layer_id"]
    if target is None:
        await server.broadcast(MT.ENV_LAYER_CREATE, payload)
        items = copied_layer_items(layer)
        if items:
            await server.broadcast(
                MT.ITEM_CREATE, {"env_id": env_id, "layer_id": lid, "items": items}
            )
    else:
        await server.send(target, MT.ENV_LAYER_CREATE, payload)
        items = copied_layer_items(layer)
        if items:
            await server.send(
                target,
                MT.ITEM_CREATE,
                {"env_id": env_id, "layer_id": lid, "items": items},
            )


def topologically_order_layer_ids(
    layer_ids: list[str],
    dependency_lookup: Callable[[str], list[str]],
) -> list[str]:
    """Return layer ids ordered so dependencies are emitted before dependents."""
    pending = set(layer_ids)
    resolved: list[str] = []

    while pending:
        progressed = False
        for layer_id in layer_ids:
            if layer_id not in pending:
                continue
            deps = [
                dep
                for dep in dependency_lookup(layer_id)
                if dep in pending or dep in resolved
            ]
            if all(dep in resolved for dep in deps):
                resolved.append(layer_id)
                pending.remove(layer_id)
                progressed = True
        if not progressed:
            # Cycle or malformed dependency graph: preserve remaining original order.
            resolved.extend([layer_id for layer_id in layer_ids if layer_id in pending])
            break

    return resolved


def ordered_registration_layer_ids(
    environment: EnvironmentRegistration,
    current_layers: dict[str, "EnvironmentLayerState"],
) -> list[str]:
    layer_ids = list(current_layers.keys())
    return topologically_order_layer_ids(
        layer_ids,
        lambda layer_id: (
            list(environment.layers[layer_id].binding.dependency_layer_ids.values())
            if layer_id in environment.layers
            else []
        ),
    )


def ordered_state_layers(
    layers: list["EnvironmentLayerState"],
) -> list["EnvironmentLayerState"]:
    by_id = {layer["layer_id"]: layer for layer in layers}
    ordered_ids = topologically_order_layer_ids(
        [layer["layer_id"] for layer in layers],
        lambda layer_id: (
            list(by_id[layer_id].get("dependency_layer_ids", {}).values())
            if layer_id in by_id
            else []
        ),
    )
    return [by_id[layer_id] for layer_id in ordered_ids if layer_id in by_id]


async def broadcast_env_update(
    server: TenSnapServer,
    environment: EnvironmentRegistration,
    env_state: EnvironmentState,
    previous_state: EnvironmentState | None = None,
) -> None:
    """Diff previous vs. current environment state and broadcast changes."""
    env_id: str = environment.id
    current_layers = {layer["layer_id"]: layer for layer in env_state["layers"]}

    if previous_state is None:
        await server.broadcast(
            MT.ENV_CREATE, environment.binding.build_create_payload()
        )
        ordered_layer_ids = ordered_registration_layer_ids(environment, current_layers)
        for layer_id in ordered_layer_ids:
            registration = environment.layers[layer_id]
            layer = current_layers[layer_id]
            registration.reset_diff_state()
            await send_layer_full(None, server, env_id, layer)
            registration.seed_item_deltas_from_state(layer)
        return

    if previous_state["type"] != env_state["type"]:
        await server.broadcast(
            MT.ENV_DELETE, environment.binding.build_delete_payload()
        )
        await broadcast_env_update(server, environment, env_state, None)
        return

    prev_layers = {layer["layer_id"]: layer for layer in previous_state["layers"]}
    curr_layer_ids = set(current_layers)

    for removed_lid in prev_layers.keys() - curr_layer_ids:
        await server.broadcast(
            MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": removed_lid}
        )

    for lid, registration in environment.layers.items():
        layer = current_layers[lid]
        prev_layer = prev_layers.get(lid)

        if prev_layer is None or prev_layer["layer_type"] != layer["layer_type"]:
            if prev_layer is not None:
                await server.broadcast(
                    MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": lid}
                )
            registration.reset_diff_state()
            full_layer = registration.build_state()
            await send_layer_full(None, server, env_id, full_layer)
            registration.seed_item_deltas_from_state(full_layer)
            continue

        if layer_dependency_layer_ids(layer) != layer_dependency_layer_ids(prev_layer):
            await server.broadcast(
                MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": lid}
            )
            registration.reset_diff_state()
            full_layer = registration.build_state()
            await send_layer_full(None, server, env_id, full_layer)
            registration.seed_item_deltas_from_state(full_layer)
            continue

        meta = layer_metadata(layer)
        if meta != layer_metadata(prev_layer):
            await server.broadcast(
                MT.ENV_LAYER_UPDATE,
                {"env_id": env_id, "layer_id": lid, "data": meta or {}},
            )

        creates, updates, deleted_item_ids = registration.build_item_deltas()
        if creates:
            await server.broadcast(
                MT.ITEM_CREATE,
                {"env_id": env_id, "layer_id": lid, "items": creates},
            )
        if updates:
            await server.broadcast(
                MT.ITEM_UPDATE,
                {"env_id": env_id, "layer_id": lid, "items": updates},
            )
        delete_payloads = registration.build_item_delete_payloads(deleted_item_ids)
        if delete_payloads:
            await server.broadcast(
                MT.ITEM_DELETE,
                {"env_id": env_id, "layer_id": lid, "items": delete_payloads},
            )


async def send_env_snapshot(
    ws: "ServerConnection",
    server: TenSnapServer,
    env_state: EnvironmentState,
    client_env: dict[str, Any] | None = None,
) -> None:
    """Send a full environment snapshot to a single client (used in state-sync)."""
    env_id = env_state["id"]
    recreate = client_env is None or client_env.get("type") != env_state["type"]

    if recreate and client_env is not None:
        await server.send(ws, MT.ENV_DELETE, {"id": env_id})
    if recreate:
        await server.send(ws, MT.ENV_CREATE, {"id": env_id, "type": env_state["type"]})

    client_layer_ids = (
        {layer["layer_id"] for layer in client_env.get("layers", [])}
        if client_env
        else set()
    )
    server_layer_ids = {layer["layer_id"] for layer in env_state["layers"]}
    for removed_lid in client_layer_ids - server_layer_ids:
        await server.send(
            ws, MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": removed_lid}
        )

    for layer in ordered_state_layers(env_state["layers"]):
        lid = layer["layer_id"]
        if lid in client_layer_ids:
            # Destroy the stale layer before recreating.
            await server.send(
                ws, MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": lid}
            )
        await send_layer_full(ws, server, env_id, layer)


async def dispatch_cud(
    send_fn: Callable[..., Any],
    deltas: dict[str, Any],
    create_type: MT,
    delete_type: MT,
    update_type: MT,
) -> None:
    """
    Dispatch create / delete / update messages for a generic delta result.

    Args:
        send_fn: ``async (msg_type, payload) -> None``
        deltas:  Dict with keys ``added``, ``removed``, ``updated``.
    """
    for item in deltas["added"]:
        await send_fn(create_type, item)
    for item_id in deltas["removed"]:
        await send_fn(delete_type, {"id": item_id})
    for item in deltas["updated"]:
        await send_fn(update_type, item)
