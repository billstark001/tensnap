import asyncio
import json
import os
import socket
import sys
from pathlib import Path

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


async def _collect_state_sync_messages(port: int, until) -> list[dict]:
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(
            json.dumps(
                {
                    "type": "state_sync",
                    "payload": {
                        "parameters": [],
                        "actions": [],
                        "envs": [],
                        "charts": [],
                    },
                }
            )
        )

        deadline = asyncio.get_running_loop().time() + 20
        messages: list[dict] = []
        while asyncio.get_running_loop().time() < deadline:
            message = await asyncio.wait_for(
                ws.recv(),
                timeout=max(0.1, deadline - asyncio.get_running_loop().time()),
            )
            decoded = _decode_message(message)
            messages.append(decoded)
            if until(messages):
                return messages

    raise AssertionError("Timed out waiting for expected state_sync messages")


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
                msg["type"] == "edge_create"
                and msg["payload"].get("layer_id") == "edges"
                for msg in collected
            ),
        )
    finally:
        await _stop_process(proc)

    env_create = next(msg for msg in messages if msg["type"] == "env_create")
    layer_creates = [msg for msg in messages if msg["type"] == "env_layer_create"]

    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "sirs_graph"
    assert {msg["payload"]["layer_type"] for msg in layer_creates} >= {"agent", "edge"}
    assert any(
        msg["type"] == "edge_create"
        and msg["payload"]["env_id"] == "sirs_graph"
        and msg["payload"]["layer_id"] == "edges"
        for msg in messages
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
                msg["type"] == "agent_create"
                and msg["payload"].get("env_id") == "GameOfLife"
                for msg in collected
            ),
        )
    finally:
        await _stop_process(proc)

    env_create = next(msg for msg in messages if msg["type"] == "env_create")
    grid_layer = next(
        msg
        for msg in messages
        if msg["type"] == "env_layer_create" and msg["payload"]["layer_type"] == "grid"
    )

    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "GameOfLife"
    assert grid_layer["payload"]["env_id"] == "GameOfLife"
    assert grid_layer["payload"]["layer_id"] == "grid"
    assert grid_layer["payload"]["data"]["width"] == 50
    assert grid_layer["payload"]["data"]["height"] == 50


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
                msg["type"] == "agent_create"
                and msg["payload"].get("env_id") == "ForagingModel"
                and msg["payload"].get("layer_id") == "patches"
                for msg in collected
            ),
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
        if msg["type"] == "agent_create" and msg["payload"].get("layer_id") == "patches"
    )

    assert env_create["payload"]["type"] == "2d"
    assert env_create["payload"]["id"] == "ForagingModel"
    assert patch_layer["payload"]["layer_type"] == "agent"
    assert len(patch_agents["payload"]["agents"]) == 50 * 50
