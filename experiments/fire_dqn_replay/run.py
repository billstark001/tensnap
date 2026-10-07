"""Publication experiment, not teaching/example code. No GUI is used.

A protocol client controls the real Python WebSocket binding. Host-private
state is read independently in this harness, never inferred from the scene.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import gzip
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import tempfile
from functools import partial
from pathlib import Path

import msgpack
import torch
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(ROOT),
    str(ROOT / "packages/tensnap-python"),
    str(ROOT / "examples"),
]
os.environ["TENSNAP_USE_SOURCE"] = "1"

from python_dqn.checkpoint import STATE_SCHEMA  # noqa: E402
from python_dqn.config import DQNConfig, EnvConfig  # noqa: E402
from python_dqn.evac_viz import configure_visualization_scenario  # noqa: E402
from tensnap import SimulationScenario, action  # noqa: E402
from tensnap.bindings.basic.restore import decode_checkpoint  # noqa: E402

from experiments.fire_dqn_replay.projected import restore_projected  # noqa: E402


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_files():
    return sorted(
        {
            *list((ROOT / "packages/tensnap-python/tensnap").rglob("*.py")),
            *list((ROOT / "examples/python_dqn").rglob("*.py")),
            *list(Path(__file__).parent.glob("*.py")),
            ROOT / "packages/tensnap-python/pyproject.toml",
            ROOT / "packages/protocol/SPECIFICATION.md",
        }
    )


def provenance():
    return {
        "commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "branch": subprocess.check_output(
            ["git", "branch", "--show-current"], cwd=ROOT, text=True
        ).strip(),
        "dirty": bool(
            subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)
        ),
        "sourceSha256": {
            str(path.relative_to(ROOT)): file_hash(path) for path in source_files()
        },
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "versions": {
            key: importlib.metadata.version(key)
            for key in ("mesa", "torch", "numpy", "msgpack", "websockets")
        },
        "torchThreads": torch.get_num_threads(),
        "device": "cpu",
        "deterministicAlgorithms": torch.are_deterministic_algorithms_enabled(),
    }


class Client:
    def __init__(self, ws, encoding):
        self.ws, self.encoding, self.sequence = ws, encoding, 0

    async def request(self, kind, fields, end):
        self.sequence += 1
        request_id = str(self.sequence)
        message = {"type": kind, "payload": {"request_id": request_id, **fields}}
        await self.ws.send(
            msgpack.packb(message, use_bin_type=True)
            if self.encoding == "msgpack"
            else json.dumps(message)
        )
        messages = []
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), 15)
            message = (
                msgpack.unpackb(raw, raw=False)
                if isinstance(raw, bytes)
                else json.loads(raw)
            )
            messages.append(message)
            if message["type"] == "error":
                raise RuntimeError(message)
            if (
                message["type"] == end
                and message["payload"].get("request_id") == request_id
            ):
                if message["payload"].get("error"):
                    raise RuntimeError(message)
                return messages

    async def step(self, guide_action=None):
        fields = (
            {"id": "step"}
            if guide_action is None
            else {"id": "guideAction", "kwargs": {"guide_action": guide_action}}
        )
        return await self.request("action_invoke", fields, "action_result")

    async def restore(self, **fields):
        messages = await self.request(
            "scene_restore",
            {
                "model_id": "examples.fire-dqn",
                "state_schema_version": STATE_SCHEMA,
                **fields,
            },
            "scene_restore_end",
        )
        assert messages[0]["type"] == "scene_restore_begin"
        assert messages[-1]["payload"]["status"] == "ok"
        assert not any(m["type"].startswith("chart_") for m in messages)
        return messages


class ExplicitAction:
    """Experiment-only action reuses the binding's normal step publication."""

    def __init__(self, scenario, manager):
        self.scenario, self.manager, self.next_action = scenario, manager, None

    def step(self):
        if self.next_action is None:
            return self.manager.step()
        value, self.next_action = self.next_action, None
        return self.manager.advance(value)

    @action(
        "guideAction",
        "Apply recorded guide action",
        kwargs=[
            {
                "name": "guide_action",
                "type": "number",
                "required": True,
                "min": 0,
                "max": 4,
            }
        ],
    )
    async def apply(self, guide_action):
        if type(guide_action) is not int or guide_action not in range(5):
            raise ValueError("guide action must be an integer from 0 to 4")
        self.next_action = guide_action
        return await self.scenario._advance_step()


def projection(scenario):
    envs = []
    for environment in scenario.environments.values():
        env = environment.build_state()
        for layer in env["layers"]:
            if "agents" in layer:
                layer["items"] = layer.pop("agents")
            if "items" in layer:
                layer["items"].sort(key=lambda item: str(item["id"]))
            if "data" in layer:
                layer["metadata"] = layer.pop("data")
        envs.append(env)
    parameters = [
        {"id": key, "value": scenario._get_param_value(param)}
        for key, param in scenario.parameters.items()
    ]
    return {"time": scenario._time_step, "parameters": parameters, "envs": envs}


def audit(manager):
    saved = manager.capture_checkpoint()
    policy = saved.pop("policy")
    saved["policySha256"] = digest(policy)
    return saved


async def trial(seed, encoding, args, stage, traces):
    scenario = SimulationScenario(
        use_msgpack=encoding == "msgpack",
        model_id="examples.fire-dqn",
        state_schema_version=STATE_SCHEMA,
        capabilities=["action.kwargs"],
    )
    model, reinit, manager = configure_visualization_scenario(
        scenario, EnvConfig(), DQNConfig(), "cpu", args.policy.parent, seed=seed
    )
    manager.guide_model = args.policy.name
    explicit = ExplicitAction(scenario, manager)

    async def init():
        await reinit.model_init()
        manager.reset_guide_model()
        manager.last_transition = None
        scenario.configure_scene_restore(
            partial(restore_projected, manager),
            checkpoint_capture=manager.capture_checkpoint,
            checkpoint_restore=manager.restore_checkpoint,
        )
        scenario.add_actions(explicit)

    scenario.configure_scene_restore(
        partial(restore_projected, manager),
        checkpoint_capture=manager.capture_checkpoint,
        checkpoint_restore=manager.restore_checkpoint,
    )
    await scenario.register_model_handler(init, explicit.step, init)
    async with serve(scenario.server.handle_client, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f"ws://127.0.0.1:{port}", max_size=8_000_000) as ws:
            raw = await ws.recv()
            hello = (
                msgpack.unpackb(raw, raw=False)
                if isinstance(raw, bytes)
                else json.loads(raw)
            )
            assert hello["type"] == "simulator_info"
            assert hello["payload"]["model"]["id"] == "examples.fire-dqn"
            assert hello["payload"]["model"]["state_schema_version"] == STATE_SCHEMA
            assert {
                "scene.restore.checkpoint",
                "scene.restore.projected",
                "action.kwargs",
            } <= set(hello["payload"]["capabilities"])
            client = Client(ws, encoding)
            await client.request(
                "state_sync",
                {
                    "model_id": "examples.fire-dqn",
                    "parameters": [],
                    "actions": [],
                    "envs": [],
                    "charts": [],
                    "monitors": [],
                },
                "state_sync_end",
            )
            for _ in range(args.capture_step):
                await client.step(0)
            assert not model.is_done(), "capture must precede terminal state"
            visible = projection(scenario)
            before = audit(manager)
            frames = await client.request("scene_capture", {}, "scene_capture_result")
            checkpoint = frames[-1]["payload"]["checkpoint"]
            path = stage / "checkpoints" / f"{encoding}-{seed}.msgpack.gz"
            with gzip.open(path, "wb") as out:
                out.write(
                    msgpack.packb(decode_checkpoint(checkpoint), use_bin_type=True)
                )
            traces.write(
                canonical(
                    {
                        "seed": seed,
                        "encoding": encoding,
                        "phase": "capture",
                        "offset": 0,
                        "state": before,
                        "projection": visible,
                    }
                )
                + "\n"
            )

            async def trajectory(phase, limit, actions=None):
                result = []
                for offset in range(1, limit + 1):
                    if model.is_done():
                        break
                    await client.step(
                        actions[offset - 1] if actions is not None else None
                    )
                    state = audit(manager)
                    row = {
                        "seed": seed,
                        "encoding": encoding,
                        "phase": phase,
                        "offset": offset,
                        "state": state,
                        "stateSha256": digest(state),
                        "projection": projection(scenario),
                        "projectionSha256": digest(projection(scenario)),
                    }
                    traces.write(canonical(row) + "\n")
                    result.append(row)
                return result

            reference = await trajectory("reference", args.horizon)
            actions = [row["state"]["last_transition"]["action"] for row in reference]
            # Checkpoint-only restore proves the protocol clock travels in private state.
            await client.restore(checkpoint=checkpoint)
            exact_capture = audit(manager) == before
            assert exact_capture
            traces.write(
                canonical(
                    {
                        "seed": seed,
                        "encoding": encoding,
                        "phase": "restored-exact",
                        "offset": 0,
                        "state": audit(manager),
                        "projection": projection(scenario),
                    }
                )
                + "\n"
            )
            exact = await trajectory("exact-actions", len(actions), actions)
            await client.restore(checkpoint=checkpoint)
            closed_loop = await trajectory("exact-policy", len(actions))
            # Restore the visible snapshot from an advanced state, without a checkpoint.
            await client.restore(**visible)
            assert digest(projection(scenario)) == digest(visible)
            projected_capture = audit(manager)
            traces.write(
                canonical(
                    {
                        "seed": seed,
                        "encoding": encoding,
                        "phase": "restored-projected",
                        "offset": 0,
                        "state": projected_capture,
                        "projection": projection(scenario),
                    }
                )
                + "\n"
            )
            projected = await trajectory("projected-actions", len(actions), actions)
            await client.restore(checkpoint=checkpoint)
            dqn = await trajectory("paired-dqn", model.config.max_steps)
            await client.restore(checkpoint=checkpoint)
            no_guide = await trajectory(
                "paired-no-guide", model.config.max_steps, [0] * model.config.max_steps
            )

            def matches(other):
                return [row["stateSha256"] for row in other] == [
                    row["stateSha256"] for row in reference
                ]

            first_divergence = next(
                (
                    index
                    for index, (a, b) in enumerate(zip(reference, projected), 1)
                    if a["projectionSha256"] != b["projectionSha256"]
                    or a["state"]["last_transition"] != b["state"]["last_transition"]
                ),
                None,
            )
            if first_divergence is None and len(projected) != len(reference):
                first_divergence = min(len(projected), len(reference)) + 1
            return {
                "seed": seed,
                "encoding": encoding,
                "steps": len(reference),
                "exactCapture": exact_capture,
                "exactActions": matches(exact),
                "exactPolicy": matches(closed_loop),
                "projectedHiddenEqual": projected_capture == before,
                "projectedFirstDivergence": first_divergence,
                "dqnEvacuated": dqn[-1]["state"]["last_transition"]["info"][
                    "evacuated"
                ],
                "noGuideEvacuated": no_guide[-1]["state"]["last_transition"]["info"][
                    "evacuated"
                ],
            }


def summarize(rows, bootstrap_seed=20261007):
    summary = {}
    for encoding in sorted({row["encoding"] for row in rows}):
        group = [row for row in rows if row["encoding"] == encoding]
        n = len(group)
        passed = sum(
            row["exactCapture"] and row["exactActions"] and row["exactPolicy"]
            for row in group
        )
        # Wilson score interval, two-sided 95%. Encodings are not pooled as independent seeds.
        z = 1.959963984540054
        p = passed / n
        center = (p + z * z / (2 * n)) / (1 + z * z / n)
        radius = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
        diffs = [row["dqnEvacuated"] - row["noGuideEvacuated"] for row in group]
        rng = random.Random(bootstrap_seed)
        means = sorted(sum(rng.choices(diffs, k=n)) / n for _ in range(10000))
        divergences = [row["projectedFirstDivergence"] for row in group]
        summary[encoding] = {
            "seeds": n,
            "exactMatches": passed,
            "exactMatchRate": p,
            "wilson95": [center - radius, center + radius],
            "projectedDiverged": sum(value is not None for value in divergences),
            "projectedFirstDivergence": {
                str(value): divergences.count(value)
                for value in sorted(
                    set(divergences), key=lambda x: n + 1 if x is None else x
                )
            },
            "pairedMeanEvacuatedDifference": sum(diffs) / n,
            "pairedBootstrap95": [means[249], means[9749]],
            "bootstrapReplicates": 10000,
            "bootstrapSeed": bootstrap_seed,
        }
    return summary


async def run(args):
    if args.output.exists():
        raise ValueError(f"refusing to overwrite {args.output}")
    if (
        args.seeds < 1
        or args.seed_start < 0
        or args.capture_step < 0
        or args.horizon < 1
        or len(set(args.encodings)) != len(args.encodings)
    ):
        raise ValueError("invalid experiment bounds")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(
        tempfile.mkdtemp(prefix=f".{args.output.name}-", dir=args.output.parent)
    )
    try:
        (stage / "checkpoints").mkdir()
        (stage / "source").mkdir()
        metadata = provenance()
        for path in source_files():
            target = stage / "source" / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        (stage / "policy").mkdir()
        policy = stage / "policy" / args.policy.name
        shutil.copy2(args.policy, policy)
        runtime_args = copy.copy(args)
        runtime_args.policy = policy
        rows = []
        with gzip.open(stage / "trajectories.jsonl.gz", "wt") as traces:
            for encoding in args.encodings:
                for seed in range(args.seed_start, args.seed_start + args.seeds):
                    rows.append(
                        await trial(seed, encoding, runtime_args, stage, traces)
                    )
                    if len(rows) % 10 == 0:
                        print(
                            f"Completed {len(rows)}/{args.seeds * len(args.encodings)} trials",
                            flush=True,
                        )
        (stage / "trials.json").write_text(json.dumps(rows, indent=2) + "\n")
        (stage / "summary.json").write_text(
            json.dumps(summarize(rows), indent=2) + "\n"
        )
        manifest = {
            "schema": "fire-dqn-replay-evidence-v1",
            "provenance": metadata,
            "plan": {
                "seedStart": args.seed_start,
                "seeds": args.seeds,
                "captureStep": args.capture_step,
                "horizon": args.horizon,
                "encodings": args.encodings,
            },
            "policyPath": str(policy.relative_to(stage)),
            "policySha256": file_hash(policy),
            "filesSha256": {
                str(path.relative_to(stage)): file_hash(path)
                for path in sorted(stage.rglob("*"))
                if path.is_file()
            },
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        verify(stage)
        stage.rename(args.output)
        print(json.dumps(summarize(rows), indent=2))
    except BaseException:
        shutil.rmtree(stage)
        raise


def verify(output):
    """Reconstruct matches/divergences and paired results from retained full states."""
    manifest = json.loads((output / "manifest.json").read_text())
    for name, expected in manifest["filesSha256"].items():
        if file_hash(output / name) != expected:
            raise ValueError(f"checksum mismatch: {name}")
    if file_hash(output / manifest["policyPath"]) != manifest["policySha256"]:
        raise ValueError("policy provenance mismatch")
    for name, expected_hash in manifest["provenance"]["sourceSha256"].items():
        if file_hash(output / "source" / name) != expected_hash:
            raise ValueError(f"source provenance mismatch: {name}")
    rows = json.loads((output / "trials.json").read_text())
    plan = manifest["plan"]
    expected = {
        (seed, encoding)
        for encoding in plan["encodings"]
        for seed in range(plan["seedStart"], plan["seedStart"] + plan["seeds"])
    }
    if (
        len(rows) != len(expected)
        or {(row["seed"], row["encoding"]) for row in rows} != expected
    ):
        raise ValueError("incomplete or duplicate seed matrix")
    trajectories = {}
    with gzip.open(output / "trajectories.jsonl.gz", "rt") as stream:
        for line in stream:
            row = json.loads(line)
            key = row["seed"], row["encoding"], row["phase"]
            if "stateSha256" in row and digest(row["state"]) != row["stateSha256"]:
                raise ValueError("invalid host-state hash")
            if (
                "projectionSha256" in row
                and digest(row["projection"]) != row["projectionSha256"]
            ):
                raise ValueError("invalid projection hash")
            agents = row["state"]["model"]["evacuees"]
            if len({agent["id"] for agent in agents}) != len(agents):
                raise ValueError("duplicate host agent identity")
            info = row["state"]["last_transition"]
            if info and sum(
                info["info"][key] for key in ("alive", "evacuated", "dead")
            ) != len(agents):
                raise ValueError("population conservation failed")
            # Keep only comparison data in memory; full states remain in the archive.
            compact = {
                "offset": row["offset"],
                "stateSha256": digest(row["state"]),
                "modelTick": row["state"]["model"]["step_count"],
                "projectionSha256": digest(row["projection"]),
                "transition": info,
            }
            trajectories.setdefault(key, []).append(compact)
    phases = {
        "capture",
        "restored-exact",
        "restored-projected",
        "reference",
        "exact-actions",
        "exact-policy",
        "projected-actions",
        "paired-dqn",
        "paired-no-guide",
    }
    if set(trajectories) != {
        (seed, encoding, phase) for seed, encoding in expected for phase in phases
    }:
        raise ValueError("incomplete trajectory matrix")
    for trial_row in rows:
        seed, encoding = trial_row["seed"], trial_row["encoding"]

        def phase(name):
            return trajectories[seed, encoding, name]

        if any(
            len(phase(name)) != 1
            for name in ("capture", "restored-exact", "restored-projected")
        ):
            raise ValueError("duplicate captured state")
        capture = phase("capture")[0]
        if capture["modelTick"] != plan["captureStep"]:
            raise ValueError("invalid capture step")
        with gzip.open(
            output / "checkpoints" / f"{encoding}-{seed}.msgpack.gz", "rb"
        ) as stream:
            checkpoint = msgpack.unpackb(stream.read(), raw=False)
        policy = checkpoint.pop("policy")
        checkpoint["policySha256"] = digest(policy)
        if digest(checkpoint) != capture["stateSha256"]:
            raise ValueError("checkpoint does not match retained host state")
        exact_capture = (
            phase("restored-exact")[0]["stateSha256"] == capture["stateSha256"]
        )
        projected_capture = phase("restored-projected")[0]
        if not exact_capture or exact_capture != trial_row["exactCapture"]:
            raise ValueError("exact capture mismatch")
        if projected_capture["projectionSha256"] != capture["projectionSha256"]:
            raise ValueError("projected capture mismatch")
        if (projected_capture["stateSha256"] == capture["stateSha256"]) != trial_row[
            "projectedHiddenEqual"
        ]:
            raise ValueError("projected private state mismatch")
        reference = phase("reference")
        for name in phases - {"capture", "restored-exact", "restored-projected"}:
            if [row["offset"] for row in phase(name)] != list(
                range(1, len(phase(name)) + 1)
            ):
                raise ValueError("non-contiguous trajectory")
        if len(reference) != trial_row["steps"] or len(reference) > plan["horizon"]:
            raise ValueError("invalid reference horizon")
        for name, result in (
            ("exact-actions", "exactActions"),
            ("exact-policy", "exactPolicy"),
        ):
            equal = [row["stateSha256"] for row in phase(name)] == [
                row["stateSha256"] for row in reference
            ]
            if not equal or equal != trial_row[result]:
                raise ValueError(f"exact replay failed: {seed}/{encoding}/{name}")
        projected = phase("projected-actions")
        first = next(
            (
                index
                for index, (a, b) in enumerate(zip(reference, projected), 1)
                if a["projectionSha256"] != b["projectionSha256"]
                or a["transition"] != b["transition"]
            ),
            None,
        )
        if first is None and len(reference) != len(projected):
            first = min(len(reference), len(projected)) + 1
        if first != trial_row["projectedFirstDivergence"]:
            raise ValueError("invalid projected divergence")
        for name, result in (
            ("paired-dqn", "dqnEvacuated"),
            ("paired-no-guide", "noGuideEvacuated"),
        ):
            last = phase(name)[-1]["transition"]
            if not last["done"] or last["info"]["evacuated"] != trial_row[result]:
                raise ValueError("invalid paired terminal outcome")
    if summarize(rows) != json.loads((output / "summary.json").read_text()):
        raise ValueError("summary does not reconstruct from retained trials")
    print(f"Verified {len(rows)} trials in {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify"))
    parser.add_argument(
        "--output", type=Path, default=ROOT / "benchmark-results/fire-dqn-replay"
    )
    parser.add_argument(
        "--policy",
        type=Path,
        default=ROOT / "examples/python_dqn/checkpoints/dqn_latest.pt",
    )
    parser.add_argument("--seeds", type=int, default=100)
    parser.add_argument("--seed-start", type=int, default=5000)
    parser.add_argument("--capture-step", type=int, default=2)
    parser.add_argument("--horizon", type=int, default=20)
    parser.add_argument(
        "--encodings",
        nargs="+",
        choices=("json", "msgpack"),
        default=["json", "msgpack"],
    )
    args = parser.parse_args()
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    if args.command == "run":
        asyncio.run(run(args))
    else:
        verify(args.output)


if __name__ == "__main__":
    main()
