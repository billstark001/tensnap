"""Regressions for the example's inference checkpoint contract."""

import asyncio
import copy
import json
import os
import random
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import torch
from tensnap import SimulationScenario
from tensnap.bindings.basic.restore import decode_checkpoint, encode_checkpoint

from python_dqn.checkpoint import STATE_SCHEMA
from python_dqn.config import DQNConfig, EnvConfig
from python_dqn.evac_viz import configure_visualization_scenario

POLICIES = Path(__file__).resolve().parents[1] / "checkpoints"


def canonical(value):
    return json.dumps(value, sort_keys=True)


def host(seed=5000):
    scenario = SimulationScenario(
        model_id="examples.fire-dqn", state_schema_version=STATE_SCHEMA
    )
    model, reinit, manager = configure_visualization_scenario(
        scenario, EnvConfig(), DQNConfig(), "cpu", POLICIES, seed=seed
    )
    manager.guide_model = "dqn_latest.pt"
    manager.reset_guide_model()
    return scenario, model, reinit, manager


@pytest.mark.parametrize("msgpack", [False, True])
@pytest.mark.parametrize("capture_step", [0, 8, 50])
def test_checkpoint_replays_complete_inference_state_and_terminal(
    msgpack, capture_step
):
    scenario, model, _, manager = host()
    for _ in range(capture_step):
        manager.step()
    scenario._time_step = model.step_count
    checkpoint = encode_checkpoint(manager.capture_checkpoint(), use_msgpack=msgpack)
    before = canonical(manager.capture_checkpoint())

    def trajectory():
        result = []
        for _ in range(20):
            if model.is_done():
                break
            manager.step()
            result.append(canonical(manager.capture_checkpoint()))
        return result

    first = trajectory()
    # Restore must be self-contained even after the active policy changes.
    manager.guide_model = "untrained"
    manager.reset_guide_model()
    random_state, torch_state = random.getstate(), torch.get_rng_state()
    manager.restore_checkpoint(decode_checkpoint(checkpoint))
    assert random.getstate() == random_state
    assert torch.equal(torch.get_rng_state(), torch_state)
    assert canonical(manager.capture_checkpoint()) == before
    assert trajectory() == first
    assert all(agent.model is model for agent in model.agents)
    assert model.grid.get_cell_list_contents([model.guide.pos])


def test_reset_preserves_explicit_seed():
    _, model, reinit, manager = host()
    before = canonical(manager.capture_checkpoint()["model"])
    manager.step()
    asyncio.run(reinit.model_init())
    assert canonical(manager.capture_checkpoint()["model"]) == before


def test_greedy_policy_does_not_consume_global_rng():
    _, model, _, manager = host()
    state = random.getstate()
    manager.dqn_agent.select_action(model.get_state(), greedy=True)
    assert random.getstate() == state


@pytest.mark.parametrize("bad", ["position", "ids", "schema", "weights"])
def test_protocol_failed_restore_rolls_back_and_caches_request(bad):
    scenario, _, _, manager = host()
    for _ in range(6):
        manager.step()
    before = canonical(manager.capture_checkpoint())
    saved = copy.deepcopy(manager.capture_checkpoint())
    if bad == "position":
        saved["model"]["evacuees"][0]["pos"] = [-1, 0]
    elif bad == "ids":
        saved["model"]["evacuees"][0]["id"] = 1
    elif bad == "schema":
        saved["schema"] = "old"
    else:
        saved["policy"]["net.0.weight"] = [[0]]
    scenario.server.send = AsyncMock()
    payload = {
        "request_id": "bad",
        "model_id": scenario.model_id,
        "checkpoint": encode_checkpoint(saved, use_msgpack=False),
    }
    asyncio.run(scenario._on_scene_restore(None, payload))
    assert scenario.server.send.await_args.args[2]["status"] == "failed"
    assert canonical(manager.capture_checkpoint()) == before
    # Reusing the ID cannot reapply a later, now valid checkpoint.
    payload["checkpoint"] = encode_checkpoint(
        manager.capture_checkpoint(), use_msgpack=False
    )
    asyncio.run(scenario._on_scene_restore(None, payload))
    assert scenario.server.send.await_args.args[2]["status"] == "failed"
    assert canonical(manager.capture_checkpoint()) == before


@pytest.mark.parametrize(
    "guard,value",
    [
        ("model_id", "other"),
        ("expected_instance_id", "stale"),
        ("state_schema_version", "old"),
    ],
)
def test_identity_guard_does_not_mutate_host(guard, value):
    scenario, _, _, manager = host()
    before = canonical(manager.capture_checkpoint())
    scenario.server.send = AsyncMock()
    payload = {
        "request_id": "guard",
        "model_id": scenario.model_id,
        "checkpoint": encode_checkpoint(
            manager.capture_checkpoint(), use_msgpack=False
        ),
        guard: value,
    }
    asyncio.run(scenario._on_scene_restore(None, payload))
    assert scenario.server.send.await_args.args[2]["status"] == "rejected"
    assert canonical(manager.capture_checkpoint()) == before


def test_checkpoint_preserves_pending_structural_parameters():
    scenario, model, reinit, manager = host()
    for _ in range(4):
        manager.step()
    original_config = model.config
    original_config.width = 19
    original_config.num_evacuees = 12
    saved = manager.capture_checkpoint()
    expected = canonical(saved)
    asyncio.run(reinit.model_init())
    assert model.width == 19 and len(model.evacuees) == 12
    manager.restore_checkpoint(saved)
    assert model.config is original_config
    assert model.width == 17 and len(model.evacuees) == 28
    assert model.config.width == 19 and model.config.num_evacuees == 12
    assert canonical(manager.capture_checkpoint()) == expected
    assert scenario.parameters["width"].getter() == 19


def test_restore_without_original_policy_file_and_checkpoint_only_capability(tmp_path):
    scenario, _, _, manager = host()
    saved = manager.capture_checkpoint()
    manager.guide_model_dir = tmp_path  # no policy file remains available
    manager.guide_model = "untrained"
    manager.reset_guide_model()
    scenario.server.send = AsyncMock()
    asyncio.run(
        scenario._on_scene_restore(
            None,
            {
                "request_id": "self-contained",
                "model_id": scenario.model_id,
                "checkpoint": encode_checkpoint(saved, use_msgpack=False),
            },
        )
    )
    assert scenario.server.send.await_args.args[2]["status"] == "ok"
    assert manager.guide_model == "dqn_latest.pt"
    assert manager.guide_model in manager.guide_model_options()
    assert canonical(manager.capture_checkpoint()) == canonical(saved)
    assert "scene.restore.checkpoint" in scenario.capabilities
    assert "scene.restore.projected" not in scenario.capabilities


def test_source_selection_precedes_binding_import():
    root = Path(__file__).resolve().parents[3]
    env = {
        **os.environ,
        "TENSNAP_USE_SOURCE": "1",
        "PYTHONPATH": str(root / "examples"),
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import python_dqn.evac_viz; import tensnap; print(tensnap.__file__)",
        ],
        cwd=root,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    assert str(root / "packages/tensnap-python/tensnap/__init__.py") in result.stdout


def test_checkpoint_preserves_noncontiguous_agent_ids():
    _, model, _, manager = host()
    for agent in model.agents:
        agent.unique_id += 100
    saved = manager.capture_checkpoint()
    manager.step()
    manager.restore_checkpoint(saved)
    assert canonical(manager.capture_checkpoint()) == canonical(saved)
    assert [agent.unique_id for agent in model.evacuees] == [
        row["id"] for row in saved["model"]["evacuees"]
    ]
