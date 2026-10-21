import asyncio
import random
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import numpy as np
import pytest

from tensnap import SimulationScenario, chart, cleanup_mesa_model_step, mesa_model_time
from tensnap.bindings import scene_restore_binding
from tensnap.bindings.basic.restore import encode_checkpoint

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "examples" / "python"))
sys.path.insert(0, str(REPO_ROOT / "examples" / "python_mesa"))

from cgol import GameOfLife  # noqa: E402
from flock import FlockConfig, FlockSimulation  # noqa: E402


@pytest.mark.asyncio
async def test_scenario_checkpoint_rebinds_constructor_parameters_before_reset():
    model = GameOfLife(width=5, height=4, seed=7)
    scenario = SimulationScenario()
    scenario.server.send = AsyncMock()
    await scenario.register_model(model, model_time=lambda: int(mesa_model_time(model)))

    # A separately registered chart is outside the model's lifecycle inventory.
    @chart("external", "External")
    def external_chart():
        return 1

    scenario.add_charts({"external": external_chart})
    await scenario._advance_step()
    saved = model.capture_checkpoint()
    saved_board = model.alive.copy()
    scenario.set_parameter("width", 8)
    scenario.set_parameter("height", 7)
    scenario.set_parameter("seed", 42)
    await scenario.reset()
    assert (model.width, model.height, model.seed) == (8, 7, 42)

    await scenario._on_scene_restore(
        None,
        {
            "request_id": "constructor-restore",
            "model_id": scenario.model_id,
            "checkpoint": encode_checkpoint(saved, use_msgpack=False),
        },
    )
    assert scenario._scene_restore_results["constructor-restore"]["status"] == "ok"
    assert scenario._time_step == mesa_model_time(model) == 1
    assert scenario.dump_parameters() == {"width": 5, "height": 4, "seed": 7}
    assert np.array_equal(model.alive, saved_board)
    assert "external" in scenario.charts
    await scenario.reset()
    reference = GameOfLife(width=5, height=4, seed=7)
    assert np.array_equal(model.alive, reference.alive)
    assert len(scenario._handlers) == 1
    cleanup_mesa_model_step(model)
    cleanup_mesa_model_step(reference)


@pytest.mark.asyncio
async def test_registered_model_can_continue_a_checkpoint_before_its_first_step():
    reference = GameOfLife(width=5, height=4, seed=7)
    for _ in range(3):
        reference.step()
    saved = reference.capture_checkpoint()
    reference.step()
    model = GameOfLife(width=8, height=7, seed=42)
    scenario = SimulationScenario()
    scenario.server.send = AsyncMock()
    await scenario.register_model(model, model_time=lambda: int(mesa_model_time(model)))
    await scenario._on_scene_restore(
        None,
        {
            "request_id": "before-first-step",
            "model_id": scenario.model_id,
            "checkpoint": encode_checkpoint(saved, use_msgpack=False),
        },
    )
    assert scenario._scene_restore_results["before-first-step"]["status"] == "ok"
    await scenario._advance_step()
    assert np.array_equal(model.alive, reference.alive)
    assert scenario._time_step == mesa_model_time(model) == 4
    cleanup_mesa_model_step(model)
    cleanup_mesa_model_step(reference)


@pytest.mark.asyncio
@pytest.mark.parametrize("use_msgpack", [False, True])
async def test_cgol_wire_checkpoint_keeps_bytes_with_explicit_parameter_overlay(
    use_msgpack,
):
    model = GameOfLife(width=5, height=4, seed=7)
    scenario = SimulationScenario(use_msgpack=use_msgpack)
    scenario.server.send = AsyncMock()
    await scenario.register_model(model, model_time=lambda: int(mesa_model_time(model)))
    scenario.set_parameter("width", 8)
    scenario.set_parameter("seed", 42)
    model_data = model.capture_checkpoint()
    parameters = [
        {"id": name, "value": value}
        for name, value in scenario.dump_parameters().items()
    ]
    await scenario._on_scene_capture(None, {"request_id": "capture-controls"})
    checkpoint = dict(scenario.server.send.call_args.args[2])
    assert checkpoint["checkpoint"] == encode_checkpoint(
        model_data, use_msgpack=use_msgpack
    )
    assert checkpoint["checkpoint"]["encoding"] == "application/octet-stream"
    projection = _projected_env(scenario, "cgol_grid")
    scenario.set_parameter("width", 9)
    scenario.set_parameter("seed", 99)
    await scenario.reset()
    assert (model.width, model.seed) == (9, 99)
    await scenario._on_scene_restore(
        None,
        {
            **checkpoint,
            "envs": [projection],
            "parameters": parameters,
            "request_id": "restore-controls",
        },
    )
    assert scenario._scene_restore_results["restore-controls"]["status"] == "ok"
    assert (model.width, model.seed) == (5, 7)
    assert scenario.get_parameter("width") == 8
    assert scenario.get_parameter("seed") == 42
    await scenario.reset()
    reference = GameOfLife(width=8, height=4, seed=42)
    assert np.array_equal(model.alive, reference.alive)
    cleanup_mesa_model_step(model)
    cleanup_mesa_model_step(reference)


def _flock_state(model: FlockSimulation) -> list[tuple]:
    return [
        (bird.id, bird.x, bird.y, bird.heading, bird.vx, bird.vy)
        for bird in model.birds
    ]


def _projected_env(scenario: SimulationScenario, env_id: str) -> dict:
    environment = scenario.environments[env_id]
    return {
        "id": env_id,
        "type": environment.type,
        "layers": [
            {
                "layer_id": layer_id,
                "layer_type": registration.binding.layer_type,
                "dependency_layer_ids": registration.binding.dependency_layer_ids,
                "metadata": registration.binding.build_metadata(registration.target),
                "items": registration.binding.build_item_list(registration.target),
            }
            for layer_id, registration in environment.layers.items()
        ],
    }


def _restore_projected(
    model: object, scenario: SimulationScenario, payload: dict
) -> None:
    restore, _, _ = scene_restore_binding(model).bind(model, scenario)
    assert restore is not None
    asyncio.run(restore(payload))


def test_flock_checkpoint_restores_exact_next_step() -> None:
    model = FlockSimulation(FlockConfig(num_agents=8, seed=17))
    model.initialize()
    model.step()
    checkpoint = model.capture_checkpoint()
    checkpoint_status = model.flock_status()

    model.step()
    expected_state = _flock_state(model)
    expected_status = model.flock_status()

    model.config.max_speed = 0.01
    model.birds.clear()
    model.restore_checkpoint(checkpoint)

    assert model.flock_status() == checkpoint_status
    model.step()
    assert _flock_state(model) == expected_state
    assert model.flock_status() == expected_status


def test_flock_projected_restore_replaces_visible_birds_and_time() -> None:
    model = FlockSimulation(FlockConfig(num_agents=3, seed=31))
    model.initialize()
    random_state = random.getstate()
    restored_time = 12
    restored_max_speed = 0.5

    scenario = SimulationScenario(port=8765)
    scenario.add_all(model)
    scenario.add_all(model.config)
    environment = _projected_env(scenario, "main")
    next(layer for layer in environment["layers"] if layer["layer_id"] == "birds")[
        "items"
    ] = [
        {
            "id": "restored",
            "x": 4.0,
            "y": 7.0,
            "heading": 0.25,
            "data": {"vx": 0.3, "vy": -0.1},
        }
    ]
    _restore_projected(
        model,
        scenario,
        {
            "time": restored_time,
            "parameters": [{"id": "max_speed", "value": restored_max_speed}],
            "envs": [environment],
        },
    )

    assert model.time_step == restored_time
    assert model.config.max_speed == restored_max_speed
    assert _flock_state(model) == [("restored", 4.0, 7.0, 0.25, 0.3, -0.1)]
    assert random.getstate() == random_state


def test_cgol_checkpoint_restores_board_rng_and_chart_state() -> None:
    model = GameOfLife(width=8, height=6, seed=23)
    model.step()
    checkpoint = model.capture_checkpoint()
    checkpoint_status = model.board_status()

    model.step()
    expected_board = model.alive.copy()
    expected_status = model.board_status()
    expected_chart_state = {
        key: list(values) for key, values in model.datacollector.model_vars.items()
    }

    model.alive.fill(False)
    model.alive_count = 0
    model.restore_checkpoint(checkpoint)

    assert model.board_status() == checkpoint_status
    model.step()
    np.testing.assert_array_equal(model.alive, expected_board)
    assert model.board_status() == expected_status
    assert model.datacollector.model_vars == expected_chart_state


def test_cgol_projected_restore_replaces_complete_board_and_time() -> None:
    model = GameOfLife(width=4, height=3, seed=29)
    restored_time = 9
    restored_alive = {(0, 0), (1, 1), (2, 1), (3, 2)}
    scenario = SimulationScenario(port=8765)
    scenario.add_all(model)
    environment = _projected_env(scenario, "cgol_grid")
    cells = next(
        layer for layer in environment["layers"] if layer["layer_id"] == "cells"
    )
    for item in cells["items"]:
        item["data"]["alive"] = (item["x"], item["y"]) in restored_alive
    _restore_projected(
        model,
        scenario,
        {
            "time": restored_time,
            "envs": [environment],
        },
    )

    assert mesa_model_time(model) == restored_time
    assert model.alive_count == len(restored_alive)
    assert model.datacollector.model_vars["Alive"][-1] == len(restored_alive)
    collected = len(model.datacollector.model_vars["Alive"])
    model.step()
    assert mesa_model_time(model) == restored_time + 1
    assert len(model.datacollector.model_vars["Alive"]) == collected + 1
