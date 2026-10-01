import asyncio
import random
import sys
from pathlib import Path

import numpy as np

from tensnap import SimulationScenario
from tensnap.bindings import scene_restore_binding

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "examples" / "python"))
sys.path.insert(0, str(REPO_ROOT / "examples" / "python_mesa"))

from cgol import GameOfLife  # noqa: E402
from flock import FlockConfig, FlockSimulation  # noqa: E402


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
    random.seed(17)
    model = FlockSimulation(FlockConfig(num_agents=8))
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
    random.seed(31)
    model = FlockSimulation(FlockConfig(num_agents=3))
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

    assert model.steps == restored_time
    assert model.alive_count == len(restored_alive)
    assert model.datacollector.model_vars["Alive"][-1] == len(restored_alive)
    model.step()
    assert model.steps == restored_time + 1
