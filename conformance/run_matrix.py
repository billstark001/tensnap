"""Exercise the public WebSocket hosts and retain a cross-binding matrix.

Run from the repository root: python conformance/run_matrix.py --write
The probe uses a sidecar written by each fixture to inspect host-private RNG
and scheduler state independently of the renderer's projected messages.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any

import msgpack
from websockets.asyncio.client import connect


ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
ROWS = (
    "identity_handshake",
    "spatial_population",
    "atomic_sync",
    "host_only_transition",
    "action_correlation",
    "parameter_control",
    "parameter_extremes",
    "reconnect",
    "negative_identity_capability",
    "exact_checkpoint",
    "future_replay",
    "population_churn",
    "dense_population",
    "empty_reseed",
    "dense_checkpoint_replay",
    "multi_client_inspection",
)
BINDINGS = ("python", "go", "js", "julia")
ENCODINGS = {binding: ("json", "msgpack") for binding in BINDINGS}
FIXTURES = {
    "python": "conformance/fixtures/python.py",
    "go": "conformance/fixtures/go/main.go",
    "js": "conformance/fixtures/js.ts",
    "julia": "conformance/fixtures/julia.jl",
}


def expected_statuses(binding: str) -> dict[str, str]:
    return {row: ("not tested" if row == "multi_client_inspection" and binding == "js" else "pass")
            for row in ROWS}


class ProbeFailure(RuntimeError):
    def __init__(self, row: str, rows: dict[str, dict[str, Any]], cause: Exception):
        super().__init__(f"{row}: {type(cause).__name__}: {cause}")
        self.row = row
        self.rows = rows.copy()


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def host_state(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


async def wait_host_value(path: Path, key: str, expected: Any) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + 8
    while True:
        try:
            state = host_state(path)
            if state[key] == expected:
                return state
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError(f"host {key} did not become {expected!r}")
        await asyncio.sleep(0.02)


def source_digest(binding: str) -> str:
    source_dir, suffix = {
        "python": (ROOT / "packages/tensnap-python/tensnap", ".py"),
        "go": (ROOT / "packages/tensnap-go", ".go"),
        "js": (ROOT / "packages/tensnap-js/src", ".ts"),
        "julia": (ROOT / "packages/tensnap-julia/src", ".jl"),
    }[binding]
    fixture_files = (sorted((HERE / "fixtures/go").glob("*.go")) if binding == "go" else
                     [ROOT / FIXTURES[binding], HERE / "fixtures/js-model.ts"] if binding == "js" else
                     [ROOT / FIXTURES[binding]])
    manifest = {
        "python": ROOT / "packages/tensnap-python/pyproject.toml",
        "go": ROOT / "packages/tensnap-go/go.mod",
        "js": ROOT / "packages/tensnap-js/package.json",
        "julia": ROOT / "packages/tensnap-julia/Project.toml",
    }[binding]
    files = [*source_dir.rglob(f"*{suffix}"), *sorted((HERE / "traces").glob("*.json")),
             *fixture_files, manifest, HERE / "run_matrix.py",
             HERE / "test_harness_canaries.py", HERE / "validate_traces.ts",
             ROOT / "packages/protocol/SPECIFICATION.md", ROOT / "packages/core/src/runtime/RendererSession.ts",
             ROOT / "packages/protocol/src/schemas.ts", ROOT / "packages/protocol/src/codec.ts",
             ROOT / "conformance/renderer-client.ts"]
    digest = hashlib.sha256()
    for path in sorted(set(files)):
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def require_identity(info: dict[str, Any], binding: str) -> None:
    assert info["protocol_version"] == "0.3"
    assert info["model"]["id"] == "conformance.counter"
    assert info["model"]["state_schema_version"] == "1"
    assert info["binding"]["name"] == f"tensnap-{binding}"
    assert info["binding"]["version"] and info["instance_id"]
    assert {"monitor", "scene.restore.checkpoint", "scene.restore.projected"} <= set(info["capabilities"])


def require_one_transition(before: dict[str, Any], after: dict[str, Any]) -> None:
    assert after["steps"] == before["steps"] + 1
    assert after["rng"] != before["rng"] and after["queue"] != before["queue"]


def require_action_order(messages: list[dict[str, Any]], request_id: str, *, accepted: bool) -> None:
    results = [m for m in messages if m["type"] == "action_result" and m["payload"]["request_id"] == request_id]
    assert len(results) == 1 and messages[-1] == results[0]
    if accepted:
        assert "error" not in results[0]["payload"]
        assert any(m["type"] == "metadata_update" for m in messages[:-1])
    else:
        assert results[0]["payload"]["error"]["code"]


def require_full_digest(before: dict[str, Any], after: dict[str, Any]) -> None:
    assert after == before


def require_parameter_correction(message: dict[str, Any], canonical: Any) -> None:
    assert message["type"] == "param_sync"
    assert message["payload"] == {"id": "speed", "value": canonical}


def require_future_replay(first: list[dict[str, Any]], second: list[dict[str, Any]]) -> None:
    assert first == second


def state_hash(state: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def population_counts(state: dict[str, Any]) -> dict[str, int]:
    agents = state["agents"]
    ids = [agent["id"] for agent in agents]
    assert len(ids) == len(set(ids))
    assert len(agents) == state["base_population"] + state["births"] - state["deaths"]
    assert all(0 <= agent["x"] < 64 and 0 <= agent["y"] < 64 for agent in agents)
    assert all(agent["health"] in ("S", "I", "R") for agent in agents)
    return {
        "susceptible": sum(agent["health"] == "S" for agent in agents),
        "infected": sum(agent["health"] == "I" for agent in agents),
        "recovered": sum(agent["health"] == "R" for agent in agents),
    }


def apply_agent_frames(inventory: dict[int, dict[str, Any]], messages: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    for message in messages:
        if message["type"] not in ("item_create", "item_update", "item_delete"):
            continue
        payload = message["payload"]
        if payload["env_id"] != "study" or payload["layer_id"] != "agents":
            continue
        if message["type"] == "item_create":
            for item in payload["items"]:
                assert item["id"] not in inventory, f"duplicate agent create: {item['id']}"
                inventory[item["id"]] = dict(item)
        elif message["type"] == "item_update":
            for item in payload["items"]:
                assert item["id"] in inventory, f"update before agent create: {item['id']}"
                inventory[item["id"]].update(item)
        else:
            for key in payload["items"]:
                agent_id = key["id"] if isinstance(key, dict) else key
                assert agent_id in inventory, f"delete before agent create: {agent_id}"
                del inventory[agent_id]
    return inventory


def require_agent_projection(inventory: dict[int, dict[str, Any]], state: dict[str, Any]) -> None:
    host = {agent["id"]: agent for agent in state["agents"]}
    assert inventory.keys() == host.keys(), (len(inventory), len(host))
    colors = {"S": "#3498db", "I": "#e74c3c", "R": "#2ecc71"}
    for agent_id, agent in host.items():
        item = inventory[agent_id]
        assert item["x"] == agent["x"] and item["y"] == agent["y"], agent_id
        assert item["color"].lower() == colors[agent["health"]], agent_id
        assert item["data"]["health"] == agent["health"], agent_id


def require_population_observations(messages: list[dict[str, Any]], state: dict[str, Any]) -> None:
    counts = population_counts(state)
    chart = {entry["id"]: entry["value"] for message in messages if message["type"] == "chart_update"
             for entry in message["payload"]["updates"]}
    assert all(chart.get(key) == value for key, value in counts.items()), (chart, counts)
    population = [message["payload"]["value"] for message in messages
                  if message["type"] == "monitor_update" and message["payload"]["id"] == "population"]
    assert population and population[-1] == len(state["agents"]), population


def encode(message: dict[str, Any], encoding: str) -> str | bytes:
    return msgpack.packb(message, use_bin_type=True) if encoding == "msgpack" else json.dumps(message)


def decode(raw: str | bytes) -> dict[str, Any]:
    return msgpack.unpackb(raw, raw=False) if isinstance(raw, bytes) else json.loads(raw)


async def receive_until(ws: Any, kind: str, request_id: str | None = None) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    while True:
        message = decode(await asyncio.wait_for(ws.recv(), 8))
        messages.append(message)
        if message.get("type") == kind and (request_id is None or message.get("payload", {}).get("request_id") == request_id):
            return messages


async def send(ws: Any, encoding: str, kind: str, payload: dict[str, Any]) -> None:
    await ws.send(encode({"type": kind, "payload": payload}, encoding))


async def sync(ws: Any, encoding: str, request_id: str, instance_id: str | None = None) -> list[dict[str, Any]]:
    payload: dict[str, Any] = {
        "request_id": request_id,
        "model_id": "conformance.counter",
        "parameters": [], "actions": [], "envs": [], "charts": [], "monitors": [],
    }
    if instance_id is not None:
        payload["instance_id"] = instance_id
    await send(ws, encoding, "state_sync", payload)
    messages = await receive_until(ws, "state_sync_end", request_id)
    assert next(message for message in messages if message["type"] == "state_sync_begin")["payload"]["request_id"] == request_id
    return messages


async def action(ws: Any, encoding: str, request_id: str, action_id: str = "step") -> list[dict[str, Any]]:
    await send(ws, encoding, "action_invoke", {"id": action_id, "request_id": request_id})
    messages = await receive_until(ws, "action_result", request_id)
    results = [m for m in messages if m["type"] == "action_result" and m["payload"]["request_id"] == request_id]
    assert len(results) == 1 and results[0]["payload"]["id"] == action_id
    assert all(m["type"] != "action_result" or m["payload"]["request_id"] == request_id for m in messages)
    try:
        late = decode(await asyncio.wait_for(ws.recv(), 0.03))
    except asyncio.TimeoutError:
        pass
    else:
        raise AssertionError(f"frame after action_result: {late}")
    return messages


async def restore(ws: Any, encoding: str, request_id: str, **fields: Any) -> list[dict[str, Any]]:
    await send(ws, encoding, "scene_restore", {"request_id": request_id, "model_id": "conformance.counter", **fields})
    messages = await receive_until(ws, "scene_restore_end", request_id)
    assert any(m["type"] == "scene_restore_begin" and m["payload"]["request_id"] == request_id for m in messages)
    return messages


def observation(messages: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "time": [m["payload"]["time"] for m in messages if m["type"] == "metadata_update" and "time" in m["payload"]],
        "position": [m["payload"]["value"] for m in messages if m["type"] == "monitor_update" and m["payload"]["id"] == "position"],
    }


async def probe(ws: Any, encoding: str, state_path: Path, info: dict[str, Any], binding: str, port: int) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}

    async def check(row: str, fn: Any) -> Any:
        try:
            evidence = await fn()
            results[row] = {"status": "pass", "evidence": evidence}
            return evidence
        except Exception as error:
            results[row] = {"status": "fail", "detail": "".join(traceback.format_exception(error, limit=5))}
            raise ProbeFailure(row, results, error) from error

    async def identity() -> dict[str, Any]:
        require_identity(info, binding)
        messages = await sync(ws, encoding, "identity-sync")
        assert messages[0]["type"] == "state_sync_begin"
        return {"binding_version": info["binding"]["version"], "instance_id": info["instance_id"], "capabilities": info["capabilities"]}

    await check("identity_handshake", identity)

    async def spatial_population() -> dict[str, Any]:
        before = host_state(state_path)
        assert len(before["agents"]) == 4 and population_counts(before) == {
            "susceptible": 3, "infected": 1, "recovered": 0}
        messages = await sync(ws, encoding, "spatial-initial")
        assert any(m["type"] == "env_create" and m["payload"]["id"] == "study" for m in messages)
        layers = {m["payload"]["layer_id"]: m["payload"] for m in messages
                  if m["type"] == "env_layer_create" and m["payload"]["env_id"] == "study"}
        assert layers["grid"]["layer_type"] == "grid" and layers["agents"]["layer_type"] == "agent"
        assert layers["grid"]["metadata"]["width"] == 64 and layers["grid"]["metadata"]["height"] == 64
        charts = [m["payload"] for m in messages if m["type"] == "chart_create" and m["payload"]["id"] == "health"]
        assert len(charts) == 1
        assert {entry["id"] for entry in charts[0]["data_list"]} == {"susceptible", "infected", "recovered"}
        inventory = apply_agent_frames({}, messages)
        require_agent_projection(inventory, before)
        require_population_observations(messages, before)
        assert host_state(state_path) == before
        return {"population": 4, "health": population_counts(before), "layers": sorted(layers),
                "host_sha256": state_hash(before)}

    await check("spatial_population", spatial_population)

    async def host_transition() -> dict[str, Any]:
        before = host_state(state_path)
        assert before["steps"] == 0
        messages = await action(ws, encoding, "step-once")
        after = host_state(state_path)
        require_one_transition(before, after)
        require_action_order(messages, "step-once", accepted=True)
        await sync(ws, encoding, "read-only-sync", info["instance_id"])
        assert host_state(state_path) == after
        return {"before": before, "after": after}

    await check("host_only_transition", host_transition)

    async def correlation() -> dict[str, Any]:
        before = host_state(state_path)
        messages = await action(ws, encoding, "correlated-step")
        require_action_order(messages, "correlated-step", accepted=True)
        assert host_state(state_path)["steps"] == before["steps"] + 1
        before_error = host_state(state_path)
        rejected = await action(ws, encoding, "rejected-action", "missing")
        require_action_order(rejected, "rejected-action", accepted=False)
        assert host_state(state_path) == before_error
        failed = await action(ws, encoding, "handler-failure", "fail")
        require_action_order(failed, "handler-failure", accepted=False)
        assert host_state(state_path) == before_error
        return {"accepted_order": [m["type"] for m in messages],
                "rejected_error": rejected[-1]["payload"]["error"]["code"],
                "handler_error": failed[-1]["payload"]["error"]["code"]}

    await check("action_correlation", correlation)

    async def parameter() -> dict[str, Any]:
        await send(ws, encoding, "param_change", {"id": "speed", "value": 2})
        await wait_host_value(state_path, "speed", 2)
        accepted = await sync(ws, encoding, "accepted-param-sync", info["instance_id"])
        assert not any(m["type"] == "param_sync" for m in accepted)
        value = next(m["payload"]["value"] for m in accepted if m["type"] in ("param_create", "param_update") and m["payload"]["id"] == "speed")
        assert value == 2
        await send(ws, encoding, "param_change", {"id": "speed", "value": 9})
        correction = await receive_until(ws, "param_sync")
        require_parameter_correction(correction[-1], 5)
        assert host_state(state_path)["speed"] == 5
        return {"accepted": 2, "normalized": correction[-1]["payload"]}

    await check("parameter_control", parameter)

    async def parameter_extremes() -> dict[str, Any]:
        await send(ws, encoding, "param_change", {"id": "speed", "value": 0})
        await wait_host_value(state_path, "speed", 0)
        accepted = await sync(ws, encoding, "zero-speed-sync", info["instance_id"])
        assert not any(m["type"] == "param_sync" for m in accepted)
        before = host_state(state_path)
        messages = await action(ws, encoding, "zero-speed-step")
        require_action_order(messages, "zero-speed-step", accepted=True)
        after = host_state(state_path)
        require_one_transition(before, after)
        assert after["x"] == before["x"]
        await send(ws, encoding, "param_change", {"id": "speed", "value": 5})
        await wait_host_value(state_path, "speed", 5)
        accepted = await sync(ws, encoding, "max-speed-sync", info["instance_id"])
        assert not any(m["type"] == "param_sync" for m in accepted)
        await send(ws, encoding, "param_change", {"id": "speed", "value": -100})
        correction = await receive_until(ws, "param_sync")
        require_parameter_correction(correction[-1], 0)
        assert host_state(state_path)["speed"] == 0
        return {"zero_speed_advance": after["steps"] - before["steps"], "zero_speed_position": after["x"],
                "accepted_bounds": [0, 5], "negative_input_canonical": 0}

    await check("parameter_extremes", parameter_extremes)

    async def negative() -> dict[str, Any]:
        before = host_state(state_path)
        await send(ws, encoding, "state_sync", {"request_id": "wrong-model-sync", "model_id": "wrong.model", "parameters": [], "actions": [], "envs": [], "charts": [], "monitors": []})
        mismatch = await receive_until(ws, "error", "wrong-model-sync")
        assert mismatch[-1]["payload"]["code"] == "model_mismatch"
        for label, fields, code in (
            ("model", {"model_id": "wrong.model", "time": 0}, "model_mismatch"),
            ("instance", {"expected_instance_id": "stale", "time": 0}, "instance_mismatch"),
            ("schema", {"state_schema_version": "wrong", "time": 0}, "state_schema_mismatch"),
        ):
            messages = await restore(ws, encoding, f"wrong-{label}-restore", **fields)
            assert messages[-1]["payload"]["status"] == "rejected"
            assert messages[-1]["payload"]["error"]["code"] == code
            assert host_state(state_path) == before
        return {"sync": "model_mismatch", "restore": ["model_mismatch", "instance_mismatch", "state_schema_mismatch"]}

    await check("negative_identity_capability", negative)

    async def exact() -> dict[str, Any]:
        baseline = host_state(state_path)
        await send(ws, encoding, "scene_capture", {"request_id": "exact-capture"})
        captured = (await receive_until(ws, "scene_capture_result", "exact-capture"))[-1]["payload"]
        assert captured["model_id"] == "conformance.counter" and captured["checkpoint"]
        require_full_digest(baseline, host_state(state_path))
        await action(ws, encoding, "advance-before-restore")
        assert host_state(state_path) != baseline
        restored = await restore(ws, encoding, "exact-restore", checkpoint=captured["checkpoint"], time=baseline["steps"],
                                 state_schema_version="1", expected_instance_id=info["instance_id"])
        assert restored[-1]["payload"]["status"] == "ok", restored[-1]
        require_full_digest(baseline, host_state(state_path))
        assert baseline["steps"] in observation(restored)["time"]
        return {"full_digest": baseline, "checkpoint_encoding": captured["checkpoint"]["encoding"]}

    await check("exact_checkpoint", exact)

    async def replay() -> dict[str, Any]:
        baseline = host_state(state_path)
        await send(ws, encoding, "scene_capture", {"request_id": "replay-capture"})
        captured = (await receive_until(ws, "scene_capture_result", "replay-capture"))[-1]["payload"]
        first = []
        for index in range(3):
            messages = await action(ws, encoding, f"first-replay-{index}")
            first.append({"host": host_state(state_path), "observed": observation(messages)})
        restored = await restore(ws, encoding, "replay-restore", checkpoint=captured["checkpoint"], time=baseline["steps"],
                                 state_schema_version="1", expected_instance_id=info["instance_id"])
        assert restored[-1]["payload"]["status"] == "ok" and host_state(state_path) == baseline
        second = []
        for index in range(3):
            messages = await action(ws, encoding, f"second-replay-{index}")
            second.append({"host": host_state(state_path), "observed": observation(messages)})
        require_future_replay(first, second)
        return {"steps_compared": 3, "trajectory": first}

    await check("future_replay", replay)

    async def population_churn() -> dict[str, Any]:
        start = host_state(state_path)
        inventory = apply_agent_frames({}, await sync(ws, encoding, "churn-baseline"))
        require_agent_projection(inventory, start)
        trajectory = []
        for index in range(6):
            messages = await action(ws, encoding, f"churn-{index}")
            state = host_state(state_path)
            apply_agent_frames(inventory, messages)
            require_agent_projection(inventory, state)
            require_population_observations(messages, state)
            trajectory.append({"steps": state["steps"], "population": len(state["agents"]),
                               "births": state["births"], "deaths": state["deaths"],
                               "host_sha256": state_hash(state)})
        end = host_state(state_path)
        assert end["births"] - start["births"] == 3
        assert end["deaths"] - start["deaths"] == 2
        return {"steps_compared": 6, "trajectory": trajectory}

    await check("population_churn", population_churn)

    async def dense_population() -> dict[str, Any]:
        messages = await action(ws, encoding, "seed-dense", "seed_dense")
        assert "error" not in messages[-1]["payload"], messages[-1]
        state = host_state(state_path)
        assert len(state["agents"]) == 1024 and state["base_population"] == 1024
        population_counts(state)
        assert any(m["type"] == "item_create" and m["payload"].get("layer_id") == "agents" for m in messages)
        before_sync = state_hash(state)
        full = await sync(ws, encoding, "dense-full-sync")
        inventory = apply_agent_frames({}, full)
        require_agent_projection(inventory, state)
        require_population_observations(full, state)
        assert state_hash(host_state(state_path)) == before_sync
        return {"population": len(inventory), "payload_items": sum(
            len(m["payload"]["items"]) for m in full if m["type"] == "item_create" and
            m["payload"].get("layer_id") == "agents"), "host_sha256": before_sync}

    await check("dense_population", dense_population)

    async def empty_reseed() -> dict[str, Any]:
        previous_ids = {agent["id"] for agent in host_state(state_path)["agents"]}
        cleared = await action(ws, encoding, "clear-population", "clear_population")
        assert "error" not in cleared[-1]["payload"]
        empty = host_state(state_path)
        assert empty["agents"] == [] and population_counts(empty) == {
            "susceptible": 0, "infected": 0, "recovered": 0}
        assert any(m["type"] == "item_delete" and m["payload"].get("layer_id") == "agents" for m in cleared)
        require_population_observations(cleared, empty)
        full = await sync(ws, encoding, "empty-full-sync")
        assert apply_agent_frames({}, full) == {}
        assert host_state(state_path) == empty
        stepped = await action(ws, encoding, "empty-absorbing-step")
        after_step = host_state(state_path)
        assert after_step["steps"] == empty["steps"] + 1 and after_step["agents"] == []
        assert not any(m["type"] == "item_create" and m["payload"].get("layer_id") == "agents" for m in stepped)
        seeded = await action(ws, encoding, "reseed-population", "seed_dense")
        assert "error" not in seeded[-1]["payload"]
        replacement = host_state(state_path)
        assert len(replacement["agents"]) == 1024
        assert {agent["id"] for agent in replacement["agents"]}.isdisjoint(previous_ids)
        inventory = apply_agent_frames({}, await sync(ws, encoding, "reseed-full-sync"))
        require_agent_projection(inventory, replacement)
        return {"empty_after_step": True, "reseeded_population": 1024,
                "old_ids_reused": False, "host_sha256": state_hash(replacement)}

    await check("empty_reseed", empty_reseed)

    async def dense_checkpoint_replay() -> dict[str, Any]:
        baseline = host_state(state_path)
        await send(ws, encoding, "scene_capture", {"request_id": "dense-capture"})
        captured = (await receive_until(ws, "scene_capture_result", "dense-capture"))[-1]["payload"]
        require_full_digest(baseline, host_state(state_path))
        first = []
        for index in range(4):
            messages = await action(ws, encoding, f"dense-first-{index}")
            state = host_state(state_path)
            require_population_observations(messages, state)
            first.append({"host": state, "observed": observation(messages)})
        restored = await restore(ws, encoding, "dense-restore", checkpoint=captured["checkpoint"],
                                 time=baseline["steps"], state_schema_version="1",
                                 expected_instance_id=info["instance_id"])
        assert restored[-1]["payload"]["status"] == "ok"
        require_full_digest(baseline, host_state(state_path))
        second = []
        for index in range(4):
            messages = await action(ws, encoding, f"dense-second-{index}")
            state = host_state(state_path)
            require_population_observations(messages, state)
            second.append({"host": state, "observed": observation(messages)})
        require_future_replay(first, second)
        return {"population": len(baseline["agents"]), "steps_compared": 4,
                "host_sha256": [state_hash(step["host"]) for step in first],
                "observed": [step["observed"] for step in first]}

    await check("dense_checkpoint_replay", dense_checkpoint_replay)

    async def multi_client_inspection() -> dict[str, Any]:
        baseline = host_state(state_path)
        async with connect(f"ws://127.0.0.1:{port}") as inspector:
            handshake = decode(await asyncio.wait_for(inspector.recv(), 8))
            assert handshake["type"] == "simulator_info" and handshake["payload"] == info
            initial = await sync(inspector, encoding, "inspector-initial", info["instance_id"])
            require_agent_projection(apply_agent_frames({}, initial), baseline)
            require_population_observations(initial, baseline)
            require_full_digest(baseline, host_state(state_path))
            stepped = await action(ws, encoding, "inspected-step")
            require_action_order(stepped, "inspected-step", accepted=True)
            advanced = host_state(state_path)
            require_one_transition(baseline, advanced)
            refreshed = await sync(inspector, encoding, "inspector-refresh", info["instance_id"])
            boundary = next(index for index, message in enumerate(refreshed) if message["type"] == "state_sync_begin")
            committed = refreshed[boundary:]
            require_agent_projection(apply_agent_frames({}, committed), advanced)
            require_population_observations(committed, advanced)
            require_full_digest(advanced, host_state(state_path))
        return {"clients": 2, "inspection_advanced_host": False,
                "action_advanced_host_once": True, "population": len(advanced["agents"]),
                "full_digest": state_hash(advanced)}

    if binding == "js":
        results["multi_client_inspection"] = {"status": "not tested", "detail": "JavaScript fixture reuses one session and cannot represent two independent live clients"}
    else:
        await check("multi_client_inspection", multi_client_inspection)
    return results


def command(binding: str) -> tuple[list[str], Path]:
    if binding == "python":
        return [sys.executable, str(ROOT / FIXTURES[binding])], ROOT
    if binding == "go":
        return ["go", "run", "../../conformance/fixtures/go/main.go",
                "../../conformance/fixtures/go/model.go"], ROOT / "packages/tensnap-go"
    if binding == "js":
        return ["pnpm", "--dir", "examples/js", "exec", "tsx", "../../conformance/fixtures/js.ts"], ROOT
    return ["julia", "--project=packages/tensnap-julia", str(ROOT / FIXTURES[binding])], ROOT


async def missing_capability_probe(binding: str, encoding: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        state_path = Path(tmp) / "state.json"
        log_path = Path(tmp) / "host.log"
        port = free_port()
        env = os.environ.copy()
        env.update(TENSNAP_CONFORMANCE_PORT=str(port), TENSNAP_CONFORMANCE_STATE=str(state_path),
                   TENSNAP_CONFORMANCE_ENCODING=encoding, TENSNAP_CONFORMANCE_NO_CHECKPOINT="1")
        env["PYTHONPATH"] = str(ROOT / "packages/tensnap-python") + os.pathsep + env.get("PYTHONPATH", "")
        argv, cwd = command(binding)
        with log_path.open("w") as log:
            process = await asyncio.create_subprocess_exec(*argv, cwd=cwd, env=env, stdout=log, stderr=log)
            try:
                deadline = asyncio.get_running_loop().time() + 45
                while True:
                    if process.returncode is not None:
                        raise RuntimeError(f"no-checkpoint host exited: {log_path.read_text()[-3000:]}")
                    try:
                        ws = await connect(f"ws://127.0.0.1:{port}")
                        break
                    except OSError:
                        if asyncio.get_running_loop().time() > deadline:
                            raise RuntimeError(f"no-checkpoint host timed out: {log_path.read_text()[-3000:]}")
                        await asyncio.sleep(0.1)
                async with ws:
                    info = decode(await asyncio.wait_for(ws.recv(), 8))
                    assert info["type"] == "simulator_info"
                    assert "scene.restore.checkpoint" not in info["payload"]["capabilities"]
                    before = host_state(state_path)
                    await send(ws, encoding, "scene_capture", {"request_id": "no-cap-capture"})
                    capture_error = (await receive_until(ws, "error", "no-cap-capture"))[-1]["payload"]
                    assert capture_error["code"] == "unsupported_capability", capture_error
                    rejected = await restore(ws, encoding, "no-cap-restore", checkpoint={"encoding": "application/octet-stream", "data": "data:application/octet-stream;base64,AA=="})
                    assert rejected[-1]["payload"]["status"] == "rejected", rejected[-1]
                    assert rejected[-1]["payload"]["error"]["code"] == "unsupported_capability", rejected[-1]
                    assert host_state(state_path) == before
                    return {"capture": capture_error["code"], "restore": rejected[-1]["payload"]["error"]["code"]}
            finally:
                if process.returncode is None:
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()


async def client_bridge(binding: str, encoding: str, first_port: int, first_state_path: Path) -> dict[str, dict[str, Any]]:
    with tempfile.TemporaryDirectory() as tmp:
        state_path = Path(tmp) / "state.json"
        log_path = Path(tmp) / "host.log"
        second_port = free_port()
        env = os.environ.copy()
        env.update(TENSNAP_CONFORMANCE_PORT=str(second_port), TENSNAP_CONFORMANCE_STATE=str(state_path), TENSNAP_CONFORMANCE_ENCODING=encoding)
        env["PYTHONPATH"] = str(ROOT / "packages/tensnap-python") + os.pathsep + env.get("PYTHONPATH", "")
        argv, cwd = command(binding)
        with log_path.open("w") as log:
            process = await asyncio.create_subprocess_exec(*argv, cwd=cwd, env=env, stdout=log, stderr=log)
            try:
                deadline = asyncio.get_running_loop().time() + 45
                while True:
                    if process.returncode is not None:
                        raise RuntimeError(f"replacement host exited: {log_path.read_text()[-3000:]}")
                    try:
                        ready = await connect(f"ws://127.0.0.1:{second_port}")
                        await ready.close()
                        break
                    except OSError:
                        if asyncio.get_running_loop().time() > deadline:
                            raise RuntimeError(f"replacement host timed out: {log_path.read_text()[-3000:]}")
                        await asyncio.sleep(0.1)
                bridge_command = ["pnpm", "--dir", "examples/js", "exec", "tsx",
                                  "../../conformance/renderer-client.ts",
                                  str(first_port), str(second_port), encoding]
                first_before = host_state(first_state_path)
                second_before = host_state(state_path)
                bridge = await asyncio.create_subprocess_exec(*bridge_command, cwd=ROOT, env=env,
                                                              stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                stdout, stderr = await asyncio.wait_for(bridge.communicate(), 45)
                if bridge.returncode != 0:
                    raise AssertionError(f"renderer bridge failed: {stderr.decode()[-4000:]}; host: {log_path.read_text()[-2000:]}")
                require_full_digest(first_before, host_state(first_state_path))
                require_full_digest(second_before, host_state(state_path))
                rows = json.loads(stdout)
                for row in ("atomic_sync", "reconnect"):
                    rows[row]["evidence"]["host_state_unchanged"] = True
                return rows
            finally:
                if process.returncode is None:
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()


async def run_one(binding: str, encoding: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        state_path = Path(tmp) / "state.json"
        log_path = Path(tmp) / "host.log"
        port = free_port()
        env = os.environ.copy()
        env.update(TENSNAP_CONFORMANCE_PORT=str(port), TENSNAP_CONFORMANCE_STATE=str(state_path), TENSNAP_CONFORMANCE_ENCODING=encoding)
        env["PYTHONPATH"] = str(ROOT / "packages/tensnap-python") + os.pathsep + env.get("PYTHONPATH", "")
        argv, cwd = command(binding)
        with log_path.open("w") as log:
            process = await asyncio.create_subprocess_exec(*argv, cwd=cwd, env=env, stdout=log, stderr=log)
            try:
                deadline = asyncio.get_running_loop().time() + 45
                while True:
                    if process.returncode is not None:
                        raise RuntimeError(f"host exited {process.returncode}: {log_path.read_text()[-4000:]}")
                    try:
                        ws = await connect(f"ws://127.0.0.1:{port}")
                        break
                    except OSError:
                        if asyncio.get_running_loop().time() > deadline:
                            raise RuntimeError(f"host startup timed out: {log_path.read_text()[-4000:]}")
                        await asyncio.sleep(0.1)
                async with ws:
                    info_message = decode(await asyncio.wait_for(ws.recv(), 8))
                    assert info_message["type"] == "simulator_info", info_message
                    info = info_message["payload"]
                    try:
                        rows = await probe(ws, encoding, state_path, info, binding, port)
                    except ProbeFailure as error:
                        rows = error.rows
                        rows[error.row]["detail"] += f"; host: {log_path.read_text()[-3000:]}"
                    except Exception as error:
                        rows = {"_probe": {"status": "fail", "detail": f"{type(error).__name__}: {error}; host: {log_path.read_text()[-3000:]}"}}
                    if rows.get("negative_identity_capability", {}).get("status") == "pass":
                        try:
                            rows["negative_identity_capability"]["evidence"]["missing_capability"] = await missing_capability_probe(binding, encoding)
                        except Exception as error:
                            rows["negative_identity_capability"] = {"status": "fail", "detail": f"missing capability: {type(error).__name__}: {error}"}
                if all(rows.get(row, {}).get("status") == "pass" for row in ("identity_handshake", "host_only_transition", "action_correlation", "parameter_control", "negative_identity_capability", "exact_checkpoint", "future_replay")):
                    await asyncio.sleep(0.05)
                    try:
                        rows.update(await client_bridge(binding, encoding, port, state_path))
                        if rows.get("identity_handshake", {}).get("status") == "pass" and rows.get("reconnect", {}).get("status") == "pass":
                            rows["identity_handshake"]["evidence"]["stable_reconnect"] = rows["reconnect"]["evidence"]["same_instance_reconnect"]
                    except Exception as error:
                        for row in ("atomic_sync", "reconnect"):
                            rows[row] = {"status": "fail", "detail": f"{type(error).__name__}: {error}"}
                for row in ROWS:
                    rows.setdefault(row, {"status": "not tested", "detail": "probe stopped after a prior failure"})
                return {"binding": binding, "encoding": encoding, "binding_version": info["binding"].get("version"),
                        "fixture": FIXTURES[binding], "test": "conformance/run_matrix.py",
                        "client_test": "conformance/renderer-client.ts", "source_sha256": source_digest(binding), "rows": rows,
                        "host_log": log_path.read_text()[-2000:] if "_probe" in rows else ""}
            finally:
                if process.returncode is None:
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()


def markdown(result: dict[str, Any]) -> str:
    runs = {(r["binding"], r["encoding"]): r for r in result["runs"]}
    names = {
        "identity_handshake": "Identity handshake", "spatial_population": "Spatial population and health series",
        "atomic_sync": "Atomic synchronization",
        "host_only_transition": "Host-only transition", "action_correlation": "Action correlation",
        "parameter_control": "Parameter control", "parameter_extremes": "Parameter boundaries and zero-rate step",
        "reconnect": "Reconnect replacement",
        "negative_identity_capability": "Negative identity/capability", "exact_checkpoint": "Exact checkpoint",
        "future_replay": "Future replay", "population_churn": "Demographic and spatial churn",
        "dense_population": "Dense 1,024-agent snapshot", "empty_reseed": "Extinction and reseeding",
        "dense_checkpoint_replay": "Dense population checkpoint/replay",
        "multi_client_inspection": "Concurrent inspection and action",
    }
    lines = ["# Cross-binding protocol conformance matrix", "",
             f"Protocol v0.3 · repository base revision `{result['revision']}` · generated by `python conformance/run_matrix.py --write`.", "",
             "Each row links to retained machine-readable evidence. `pass` means the linked test ran successfully; `fail` is a measured failure; `unsupported` means the encoding or capability is absent; `not tested` is an explicit gap. Each binding run records its source SHA-256 as well as its package version and repository base revision.", "",
             "| Invariant | Python/Mesa | Go | JavaScript/TypeScript | Julia | Renderer client |", "| --- | --- | --- | --- | --- | --- |"]
    for row in ROWS:
        cells = []
        for binding in BINDINGS:
            parts = []
            for encoding in ("json", "msgpack"):
                run = runs.get((binding, encoding))
                status = (run or {}).get("rows", {}).get(row, {}).get("status", "unsupported" if encoding not in ENCODINGS[binding] else "not tested")
                parts.append(f"{encoding}: {status}")
            cells.append("<br>".join(parts))
        client = result["client"]["rows"].get(row, {"status": "not tested"})["status"]
        lines.append("| [" + names[row] + "](evidence/" + row + ".json) | " + " | ".join(cells) + " | " + client + " |")
    lines.extend(["", "## Evidence and limits", "",
                  "The [wire probe](run_matrix.py) drives the public WebSocket path of the four [deterministic fixtures](fixtures/). The Python fixture exercises the same binding used by Mesa examples, but it does not instantiate Mesa's scheduler; Mesa-specific scheduler behavior is not established by this matrix. The probe records a full fixture host digest containing position, transition count, RNG state, scheduler queue, canonical parameter value, and the complete agent population. Projected items, grouped health charts, and monitors are checked separately. Results retain the test path, fixture path, binding version, encoding, and source digest.", "",
                  "A visible Scenario equality check compares renderer-owned projections only. The sidecar digest compares the complete state of this instrumented host, including fields absent from its visible projection. The population cases exercise spatial bounds, births/deaths, stable IDs, zero-population absorption, a 1,024-agent sync, and exact replay after a dense checkpoint. A second client inspects the live population before and after a first client's action without advancing the host. The JavaScript fixture reuses a single session, so its multi-client row is not tested; this does not establish that the binding lacks multi-client support. Each item diff is applied to a local inventory and compared with host state; health chart counts and population monitors are checked independently. These claims apply to the fixture, not automatically to every example model.", "",
                  "`atomic_sync` and `reconnect` use a [renderer bridge](renderer-client.ts) to feed each binding's live WebSocket frames through `RendererSession`. The bridge injects a mismatched end boundary, disconnects before a valid end, and reconnects to both the same and a new simulator instance with stale items and chart history in committed state. The probe confirms neither host's full sidecar state advances during these synchronizations.", "",
                  "The [protocol trace test](validate_traces.ts) schema-validates the earlier transport-neutral [trajectories](traces/). The [canary tests](test_harness_canaries.py) deliberately corrupt identity, transition count, action order, parameter correction, private RNG state, and replay state; each must be rejected by an assertion also used in the live probe. The live probe sends wrong model/instance/schema requests, unknown actions, and requests to a host with checkpoint capability disabled. The renderer bridge injects mismatched sync boundaries and stale reconnect state.", "",
                  "## Case-study interpretation", "",
                  "| Case study | Existing evidence | Conformance interpretation |", "| --- | --- | --- |",
                  "| [Schelling](../benchmarks/README.md) | [Retained v2 benchmark profiles](../artifacts/benchmark-results/macos-15.7.5-arm64/README.md) cover Mesa, Go, JS, and Julia kernels and UI paths with profile and sample verification. | Feature and semantic coverage. Cross-language trajectories are not byte-identical evidence because implementations use different RNGs and schedulers. No cross-language exact replay claim. |",
                  "| [Fire/Double DQN](../examples/python_dqn/README.md) | `pnpm evidence:fire:verify` checks retained training/evaluation rows, seed mapping, summaries, and artifact hashes. | The learned policy and environment evidence does not establish exact TenSnap restore. An exact replay claim needs a separate test that captures and restores environment, policy/replay-buffer state, RNG, and scheduler, then compares subsequent complete states and observations. Status for that case study: not tested. |", "",
                  "Reproduce all supported runs: `python conformance/run_matrix.py --check`. Refresh retained results and this document: `python conformance/run_matrix.py --write`. Both commands require Python `websockets` and `msgpack`, Node/pnpm dependencies, Go, and Julia with package dependencies installed.", ""])
    return "\n".join(lines)


def row_evidence(result: dict[str, Any], row: str) -> dict[str, Any]:
    return {
        "invariant": row,
        "protocol_version": result["protocol_version"],
        "revision": result["revision"],
        "bindings": [
            {key: value for key, value in run.items() if key != "rows"} | {"outcome": run["rows"].get(row, {"status": "not tested"})}
            for run in result["runs"]
        ],
        "renderer_client": result["client"]["rows"].get(row, {"status": "not tested"}),
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--bindings", nargs="+", choices=BINDINGS, default=BINDINGS)
    args = parser.parse_args()
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    runs = []
    for binding in args.bindings:
        for encoding in ENCODINGS[binding]:
            print(f"{binding}/{encoding}", flush=True)
            try:
                run = await run_one(binding, encoding)
            except Exception as error:
                run = {"binding": binding, "encoding": encoding, "fixture": FIXTURES[binding],
                       "test": "conformance/run_matrix.py", "rows": {"_startup": {"status": "fail", "detail": repr(error)}} |
                       {row: {"status": "not tested", "detail": "host failed before probe"} for row in ROWS}}
            for row, outcome in run["rows"].items():
                print(f"  {row}: {outcome['status']} {outcome.get('detail', '')}", flush=True)
            runs.append(run)
    client_rows = {}
    for row in ("atomic_sync", "reconnect"):
        passed = all(run["rows"].get(row, {}).get("status") == "pass" for run in runs)
        client_rows[row] = {"status": "pass" if passed else "fail", "detail": "all eight live renderer bridges"}
    client = {"test": "conformance/renderer-client.ts", "rows": client_rows}
    trace_command = ["pnpm", "--dir", "examples/js", "exec", "tsx", "../../conformance/validate_traces.ts"]
    trace_test = subprocess.run(trace_command, cwd=ROOT, capture_output=True, text=True, check=False)
    protocol_traces = {"test": "conformance/validate_traces.ts", "traces": "conformance/traces/*.json",
                       "status": "pass" if trace_test.returncode == 0 else "fail",
                       "output": trace_test.stdout[-2000:] + trace_test.stderr[-2000:] if trace_test.returncode else ""}
    canary_command = [sys.executable, "-m", "unittest", "discover", "-s", "conformance", "-p", "test_harness_canaries.py"]
    canary_test = subprocess.run(canary_command, cwd=ROOT, capture_output=True, text=True, check=False)
    canaries = {"test": "conformance/test_harness_canaries.py",
                "status": "pass" if canary_test.returncode == 0 else "fail",
                "output": canary_test.stdout[-2000:] + canary_test.stderr[-2000:] if canary_test.returncode else ""}
    result = {"protocol_version": "0.3", "revision": revision, "runs": runs, "client": client,
              "protocol_traces": protocol_traces, "canaries": canaries}
    failures = [f"{r['binding']}/{r['encoding']}: {row}: {v.get('detail', '')}" for r in runs for row, v in r["rows"].items() if v["status"] == "fail"]
    expected = set(ROWS)
    failures += [f"{r['binding']}/{r['encoding']}: missing {sorted(expected - set(r['rows']))}" for r in runs if expected - set(r["rows"])]
    failures += [f"{r['binding']}/{r['encoding']}: {row} unexpectedly {r['rows'][row]['status']}"
                 for r in runs for row, status in expected_statuses(r["binding"]).items()
                 if row in r["rows"] and r["rows"][row]["status"] != status]
    if any(value["status"] == "fail" for value in client_rows.values()):
        failures.append("renderer client: one or more live bridges failed")
    if protocol_traces["status"] == "fail":
        failures.append(f"protocol traces: {protocol_traces['output']}")
    if canaries["status"] == "fail":
        failures.append(f"harness canaries: {canaries['output']}")
    if args.write:
        (HERE / "results.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        (HERE / "MATRIX.md").write_text(markdown(result))
        evidence_dir = HERE / "evidence"
        evidence_dir.mkdir(exist_ok=True)
        for row in ROWS:
            (evidence_dir / f"{row}.json").write_text(json.dumps(row_evidence(result, row), indent=2, sort_keys=True) + "\n")
    else:
        retained = json.loads((HERE / "results.json").read_text())
        expected_pairs = {(binding, encoding) for binding in BINDINGS for encoding in ENCODINGS[binding]}
        assert {(run["binding"], run["encoding"]) for run in retained["runs"]} == expected_pairs, "retained binding/encoding coverage differs"
        assert len(retained["runs"]) == len(expected_pairs), "duplicate retained binding/encoding run"
        assert (HERE / "MATRIX.md").read_text() == markdown(retained), "matrix and retained results differ"
        for row in ROWS:
            assert (HERE / "evidence" / f"{row}.json").read_text() == json.dumps(row_evidence(retained, row), indent=2, sort_keys=True) + "\n"
        for run in retained["runs"]:
            assert set(run["rows"]) == set(ROWS), f"incomplete retained rows: {run['binding']}/{run['encoding']}"
            assert all(run["rows"][row]["status"] == status for row, status in expected_statuses(run["binding"]).items()), f"retained run has an unexpected outcome: {run['binding']}/{run['encoding']}"
            assert run["source_sha256"] == source_digest(run["binding"]), f"stale source digest: {run['binding']}"
        assert all(retained["client"]["rows"][row]["status"] == "pass" for row in ("atomic_sync", "reconnect")), "retained renderer client failure"
        assert retained["protocol_traces"]["status"] == "pass", "retained protocol trace failure"
        assert retained["canaries"]["status"] == "pass", "retained canary failure"
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
