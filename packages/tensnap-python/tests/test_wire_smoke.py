import asyncio
import json
import os
import socket
import sys
from pathlib import Path
from typing import Any, cast

import msgpack
import pytest
from websockets.asyncio.client import connect

REPO_ROOT = Path(__file__).resolve().parents[3]


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(sock.getsockname()[1])


def _decode_message(message: str | bytes) -> dict:
    if isinstance(message, bytes):
        return msgpack.unpackb(message, raw=False)
    return json.loads(message)


async def _start_example(script_path: Path, port: int) -> asyncio.subprocess.Process:
    env = os.environ.copy()
    env["TENSNAP_SERVER_PORT"] = str(port)
    env["TENSNAP_USE_SOURCE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    return await asyncio.create_subprocess_exec(
        sys.executable,
        script_path.name,
        cwd=str(script_path.parent),
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )


async def _wait_for_server(proc: asyncio.subprocess.Process, port: int) -> None:
    deadline = asyncio.get_running_loop().time() + 20
    last_error: Exception | None = None
    while asyncio.get_running_loop().time() < deadline:
        if proc.returncode is not None:
            stderr = await proc.stderr.read() if proc.stderr else b""
            raise AssertionError(
                f"Example exited before accepting connections: {stderr.decode().strip()}"
            )
        try:
            async with connect(f"ws://127.0.0.1:{port}"):
                return
        except Exception as exc:  # pragma: no cover - retry loop
            last_error = exc
            await asyncio.sleep(0.1)
    raise AssertionError(f"Timed out waiting for example server: {last_error}")


async def _collect_state_sync_messages(
    port: int, until, *, use_msgpack: bool = False
) -> list[dict]:
    request_id = "sync-smoke"
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        message = {
            "type": "state_sync",
            "payload": {
                "request_id": request_id,
                "parameters": [],
                "actions": [],
                "envs": [],
                "charts": [],
            },
        }
        await ws.send(
            cast(
                Any,
                (
                    msgpack.packb(message, use_bin_type=True)
                    if use_msgpack
                    else json.dumps(message)
                ),
            )
        )

        deadline = asyncio.get_running_loop().time() + 20
        messages: list[dict] = []
        saw_target = False
        while asyncio.get_running_loop().time() < deadline:
            message = await asyncio.wait_for(
                ws.recv(),
                timeout=max(0.1, deadline - asyncio.get_running_loop().time()),
            )
            decoded = _decode_message(message)
            messages.append(decoded)
            saw_target = saw_target or until(messages)
            if (
                saw_target
                and decoded.get("type") == "state_sync_end"
                and decoded.get("payload", {}).get("request_id") == request_id
            ):
                return messages

    raise AssertionError("Timed out waiting for expected state_sync messages")


async def _sync_and_run_action(
    port: int,
    action_id: str,
    *,
    use_msgpack: bool = False,
) -> tuple[list[dict], list[dict]]:
    request_id = "sync-action"
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        sync_request = {
            "type": "state_sync",
            "payload": {
                "request_id": request_id,
                "parameters": [],
                "actions": [],
                "envs": [],
                "charts": [],
            },
        }
        await ws.send(
            cast(
                Any,
                (
                    msgpack.packb(sync_request, use_bin_type=True)
                    if use_msgpack
                    else json.dumps(sync_request)
                ),
            )
        )

        deadline = asyncio.get_running_loop().time() + 20
        sync_messages: list[dict] = []
        while asyncio.get_running_loop().time() < deadline:
            message = await asyncio.wait_for(
                ws.recv(),
                timeout=max(0.1, deadline - asyncio.get_running_loop().time()),
            )
            decoded = _decode_message(message)
            sync_messages.append(decoded)
            if (
                decoded.get("type") == "state_sync_end"
                and decoded.get("payload", {}).get("request_id") == request_id
            ):
                break
        else:
            raise AssertionError(
                "Timed out waiting for state_sync before action dispatch"
            )

        action_request = {"type": "action_start", "payload": {"id": action_id}}
        await ws.send(
            cast(
                Any,
                (
                    msgpack.packb(action_request, use_bin_type=True)
                    if use_msgpack
                    else json.dumps(action_request)
                ),
            )
        )

        action_messages: list[dict] = []
        while asyncio.get_running_loop().time() < deadline:
            message = await asyncio.wait_for(
                ws.recv(),
                timeout=max(0.1, deadline - asyncio.get_running_loop().time()),
            )
            decoded = _decode_message(message)
            action_messages.append(decoded)
            if (
                decoded.get("type") == "action_end"
                and decoded.get("payload", {}).get("id") == action_id
            ):
                return sync_messages, action_messages

    raise AssertionError(f"Timed out waiting for action_end for '{action_id}'")


async def _stop_process(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()


@pytest.mark.asyncio
async def test_graph_example_emits_canonical_layered_wire_output():
    script = REPO_ROOT / "examples" / "python" / "sirs_viz_graph.py"
    port = _get_free_port()
    proc = await _start_example(script, port)

    try:
        await _wait_for_server(proc, port)
        messages = await _collect_state_sync_messages(
            port,
            lambda collected: any(
                msg["type"] == "item_create"
                and msg["payload"].get("layer_id") == "edges"
                for msg in collected
            ),
        )
    finally:
        await _stop_process(proc)

    env_create = next(msg for msg in messages if msg["type"] == "env_create")
    layer_creates = [msg for msg in messages if msg["type"] == "env_layer_create"]
    layer_create_index = {
        (msg["payload"]["layer_id"], msg["payload"]["layer_type"]): idx
        for idx, msg in enumerate(messages)
        if msg["type"] == "env_layer_create"
    }
    edge_item_create_index = next(
        idx
        for idx, msg in enumerate(messages)
        if msg["type"] == "item_create" and msg["payload"].get("layer_id") == "edges"
    )

    assert messages[0] == {
        "type": "state_sync_begin",
        "payload": {"request_id": "sync-smoke"},
    }
    assert messages[-1] == {
        "type": "state_sync_end",
        "payload": {"request_id": "sync-smoke"},
    }
    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "sirs_graph"
    assert {msg["payload"]["layer_type"] for msg in layer_creates} >= {"agent", "edge"}
    assert (
        layer_create_index[("agents", "agent")] < layer_create_index[("edges", "edge")]
    )
    assert layer_create_index[("agents", "agent")] < edge_item_create_index
    assert any(
        msg["type"] == "item_create"
        and msg["payload"]["env_id"] == "sirs_graph"
        and msg["payload"]["layer_id"] == "edges"
        for msg in messages
    )


@pytest.mark.asyncio
async def test_graph_example_initializes_at_time_zero_and_first_step_is_one():
    script = REPO_ROOT / "examples" / "python" / "sirs_viz_graph.py"
    port = _get_free_port()
    proc = await _start_example(script, port)

    try:
        await _wait_for_server(proc, port)
        sync_messages, action_messages = await _sync_and_run_action(port, "step")
    finally:
        await _stop_process(proc)

    assert any(
        msg["type"] == "metadata_update" and msg["payload"].get("time") == 0
        for msg in sync_messages
    )
    assert any(
        msg["type"] == "metadata_update" and msg["payload"].get("time") == 1
        for msg in action_messages
    )


@pytest.mark.asyncio
async def test_mesa_example_emits_canonical_grid_layer_wire_output():
    script = REPO_ROOT / "examples" / "python_mesa" / "cgol_viz.py"
    port = _get_free_port()
    proc = await _start_example(script, port)

    try:
        await _wait_for_server(proc, port)
        messages = await _collect_state_sync_messages(
            port,
            lambda collected: any(
                msg["type"] == "item_create"
                and msg["payload"].get("env_id") == "cgol_grid"
                and msg["payload"].get("layer_id") == "cells"
                for msg in collected
            ),
            use_msgpack=True,
        )
    finally:
        await _stop_process(proc)

    env_create = next(msg for msg in messages if msg["type"] == "env_create")
    cell_layer = next(
        msg
        for msg in messages
        if msg["type"] == "env_layer_create" and msg["payload"]["layer_id"] == "cells"
    )

    assert messages[0] == {
        "type": "state_sync_begin",
        "payload": {"request_id": "sync-smoke"},
    }
    assert messages[-1] == {
        "type": "state_sync_end",
        "payload": {"request_id": "sync-smoke"},
    }
    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "cgol_grid"
    assert cell_layer["payload"]["env_id"] == "cgol_grid"
    assert cell_layer["payload"]["layer_id"] == "cells"
    assert cell_layer["payload"]["layer_type"] == "agent"


@pytest.mark.asyncio
async def test_mushroom_example_emits_patch_resource_layer():
    script = REPO_ROOT / "examples" / "python_mesa" / "mushroom_viz.py"
    port = _get_free_port()
    proc = await _start_example(script, port)

    try:
        await _wait_for_server(proc, port)
        messages = await _collect_state_sync_messages(
            port,
            lambda collected: any(
                msg["type"] == "item_create"
                and msg["payload"].get("env_id") == "main"
                and msg["payload"].get("layer_id") == "patches"
                for msg in collected
            ),
            use_msgpack=True,
        )
    finally:
        await _stop_process(proc)

    env_create = next(msg for msg in messages if msg["type"] == "env_create")
    patch_layer = next(
        msg
        for msg in messages
        if msg["type"] == "env_layer_create" and msg["payload"]["layer_id"] == "patches"
    )
    patch_agents = next(
        msg
        for msg in messages
        if msg["type"] == "item_create" and msg["payload"].get("layer_id") == "patches"
    )

    assert messages[0] == {
        "type": "state_sync_begin",
        "payload": {"request_id": "sync-smoke"},
    }
    assert messages[-1] == {
        "type": "state_sync_end",
        "payload": {"request_id": "sync-smoke"},
    }
    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "main"
    assert patch_layer["payload"]["layer_type"] == "agent"


@pytest.mark.asyncio
async def test_sugarscape_example_emits_sugar_resource_layer():
    script = REPO_ROOT / "examples" / "python_mesa" / "sugarscape_viz.py"
    port = _get_free_port()
    proc = await _start_example(script, port)

    try:
        await _wait_for_server(proc, port)
        messages = await _collect_state_sync_messages(
            port,
            lambda collected: any(
                msg["type"] == "item_create"
                and msg["payload"].get("env_id") == "sugarscape_env"
                and msg["payload"].get("layer_id") == "sugar"
                for msg in collected
            ),
            use_msgpack=True,
        )
    finally:
        await _stop_process(proc)

    env_create = next(msg for msg in messages if msg["type"] == "env_create")
    sugar_layer = next(
        msg
        for msg in messages
        if msg["type"] == "env_layer_create" and msg["payload"]["layer_id"] == "sugar"
    )
    sugar_agents = next(
        msg
        for msg in messages
        if msg["type"] == "item_create" and msg["payload"].get("layer_id") == "sugar"
    )

    assert messages[0] == {
        "type": "state_sync_begin",
        "payload": {"request_id": "sync-smoke"},
    }
    assert messages[-1] == {
        "type": "state_sync_end",
        "payload": {"request_id": "sync-smoke"},
    }
    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "sugarscape_env"
    assert sugar_layer["payload"]["layer_type"] == "agent"
    assert len(sugar_agents["payload"]["items"]) == 50 * 50
