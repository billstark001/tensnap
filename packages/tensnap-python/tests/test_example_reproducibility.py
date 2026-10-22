"""Reproduction is a model contract: seeds, isolation, observation and checkpoints."""

import asyncio
import copy
import json
import random
from unittest.mock import AsyncMock

import numpy as np
import pytest
from cgol import GameOfLife
from flock import Bird, FlockConfig, FlockSimulation
from hk import AdaptiveNetworkHKModel
from mushroom import ForagingModel, MushroomState
from predator_prey import PredatorPreyConfig, PredatorPreySimulation
from random_walk import RandomWalkConfig, RandomWalkSimulation
from schelling_checkpoint import capture_checkpoint, restore_checkpoint
from schelling_study import run_trial
from schelling_tensnap import SchellingModel, create_schelling_scenario
from sirs import ERNetworkEnvironment, GridEnvironment, SIRSSimulation
from sugarscape import SugarAgent, Sugarscape

from tensnap import SimulationScenario, cleanup_mesa_model_step
from tensnap.bindings.basic.restore import encode_checkpoint


def walk(seed):
    model = RandomWalkSimulation(RandomWalkConfig(seed=seed, num_agents=12))
    model.initialize()
    return model


def flock(seed):
    model = FlockSimulation(FlockConfig(seed=seed, num_agents=12))
    model.initialize()
    return model


def predators(seed):
    model = PredatorPreySimulation(
        PredatorPreyConfig(
            seed=seed, width=8, height=7, initial_sheep=12, initial_wolves=4
        )
    )
    model.initialize()
    return model


def state(model):
    if isinstance(model, RandomWalkSimulation):
        domain = [vars(w).copy() for w in model.walkers]
    elif isinstance(model, FlockSimulation):
        domain = [vars(b).copy() for b in model.birds]
    elif isinstance(model, PredatorPreySimulation):
        domain = (
            [vars(a).copy() for a in model.sheep],
            [vars(a).copy() for a in model.wolves],
            model.grass_timer,
        )
    elif isinstance(model, AdaptiveNetworkHKModel):
        domain = (model.opinions.tolist(), list(model.graph.edges))
    elif isinstance(model, SIRSSimulation):
        domain = (
            [int(a.state) for a in model.agents],
            list(model.environment.graph.edges)
            if isinstance(model.environment, ERNetworkEnvironment)
            else [],
        )
    elif isinstance(model, Sugarscape):
        domain = (
            model.sugar.tolist(),
            [
                (a.unique_id, a.cell.coordinate, a.metabolism, a.vision, a.sugar)
                for a in model.agents
            ],
        )
    elif isinstance(model, ForagingModel):
        domain = (
            [(coord, p.state) for coord, p in model.patch_map.items()],
            [
                (
                    h.pos,
                    h.heading_arc,
                    h.collected,
                    h.has_found,
                    h.time_since_last_found,
                )
                for h in model.hunters
            ],
        )
    elif isinstance(model, GameOfLife):
        domain = model.alive.tolist()
    else:
        domain = [(a.unique_id, a.cell.coordinate, a.group) for a in model.agents]
    streams = []
    for name in ("random", "rng"):
        rng = getattr(model, name, None)
        if isinstance(rng, random.Random):
            streams.append(rng.getstate())
        elif isinstance(rng, np.random.Generator):
            streams.append(copy.deepcopy(rng.bit_generator.state))
    return copy.deepcopy((domain, streams))


def observe(model):
    scenario = SimulationScenario()
    scenario.add_all(model)
    if hasattr(model, "config"):
        scenario.add_all(model.config)
    if isinstance(model, SIRSSimulation):
        scenario.add_all(model.environment)
        _ = model.get_current_states
    for env in scenario.environments.values():
        for registration in env.layers.values():
            registration.binding.build_item_list(registration.target)
    if isinstance(model, SchellingModel):
        model.satisfied_pct()
        model.segregation_index()


FACTORIES = [
    walk,
    flock,
    predators,
    lambda seed: AdaptiveNetworkHKModel(n_agents=12, seed=seed),
    lambda seed: SIRSSimulation(GridEnvironment(5, 7), 0.3, 0.1, 0.05, 3, seed=seed),
    lambda seed: SIRSSimulation(
        ERNetworkEnvironment(20, 0.2), 0.3, 0.1, 0.05, 3, seed=seed
    ),
    lambda seed: Sugarscape(width=9, height=7, agent_count=12, seed=seed),
    lambda seed: Sugarscape(
        width=9, height=7, agent_count=12, seed=seed, grid_type="random"
    ),
    lambda seed: ForagingModel(
        width=12, height=12, num_clusters=1, patches_per_cluster=12, seed=seed
    ),
    lambda seed: ForagingModel(
        width=12,
        height=12,
        num_clusters=1,
        patches_per_cluster=12,
        seed=seed,
        area_restricted=False,
    ),
    lambda seed: GameOfLife(width=9, height=7, seed=seed),
    lambda seed: SchellingModel(width=9, height=7, seed=seed),
]


@pytest.mark.parametrize("factory", FACTORIES)
def test_seeded_models_ignore_global_rng_interleaving_and_observation(factory):
    python_before, numpy_before = random.getstate(), np.random.get_state()
    models = [factory(7), factory(7), factory(29)]
    left, right, other = models
    try:
        for _ in range(8):
            assert state(left) == state(right)
            before = state(left)
            observe(left)
            assert state(left) == before
            left.step()
            other.step()
            observe(other)
            right.step()
        assert state(left) == state(right)
        assert random.getstate() == python_before
        numpy_after = np.random.get_state()
        assert numpy_after[0] == numpy_before[0]
        assert np.array_equal(numpy_after[1], numpy_before[1])
        assert numpy_after[2:] == numpy_before[2:]
    finally:
        for model in models:
            cleanup_mesa_model_step(model)


@pytest.mark.parametrize("factory", FACTORIES[6:])
def test_mesa_constructor_parameters_are_initialization_only_and_reset_repeats(factory):
    model = factory(7)
    initial = state(model)
    scenario = SimulationScenario()
    asyncio.run(scenario.register_model(model))
    assert scenario.parameters["seed"].allow_runtime_change is False
    model.step()
    asyncio.run(scenario.reset())
    assert state(model) == initial
    before = state(model)
    scenario.set_parameter("seed", 8)
    assert state(model) == before
    asyncio.run(scenario.reset())
    reference = factory(8)
    assert state(model) == state(reference)
    cleanup_mesa_model_step(reference)
    cleanup_mesa_model_step(model)


def test_flock_uses_toroidal_neighbors_and_synchronous_velocities():
    config = FlockConfig(
        world_width=20,
        world_height=20,
        num_agents=0,
        max_speed=10,
        separation_distance=0,
        alignment_distance=0,
        cohesion_distance=2,
    )
    model = FlockSimulation(config)
    model.birds = [
        Bird.from_snapshot("a", 0.2, 10, 0, 0, 0),
        Bird.from_snapshot("b", 19.8, 10, 0, 0, 0),
    ]
    assert model.next_velocity(model.birds[0])[0] == pytest.approx(-0.04)
    config.alignment_distance = 2
    model.birds[1].vx = 0.3
    expected = {b.id: model.next_velocity(b) for b in model.birds}
    model.step()
    assert {b.id: (b.vx, b.vy) for b in model.birds} == expected


def test_flock_invalid_checkpoint_keeps_config_population_and_rng():
    model = flock(7)
    saved = model.capture_checkpoint()
    broken = json.loads(saved)
    broken["config"]["max_speed"] = 0.01
    broken["birds"].append(broken["birds"][0])
    with pytest.raises(ValueError, match="duplicate"):
        model.restore_checkpoint(json.dumps(broken).encode())
    assert model.capture_checkpoint() == saved


def test_sugarscape_projection_uses_existing_matrix_with_correct_axes():
    model = Sugarscape(width=9, height=7, agent_count=0, seed=7)
    scenario = SimulationScenario()
    scenario.add_all(model)
    registration = scenario.environments["sugarscape_env"].layers["sugar"]
    items = registration.binding.build_item_list(registration.target)
    assert not hasattr(model, "sugar_patches")
    for item in items:
        assert item["data"]["sugar"] == model.sugar[item["x"], item["y"]]
        assert item["id"] == f"cell:{model.height - 1 - item['y']}:{item['x']}"


def test_sugarscape_gradient_uses_wrapped_distance_and_reachable_empty_targets():
    model = Sugarscape(
        width=9, height=7, agent_count=0, seed=7, vision_min=3, vision_max=4
    )
    agent = SugarAgent(model, model.grid[(0, 3)])
    model.sugar[:] = 0
    model.sugar[8, 3] = 10
    assert model.distance((0, 3), (8, 3)) == 1
    agent.move()
    assert agent.cell.coordinate == (8, 3)


def test_mushroom_state_is_independent_of_display_color_and_search_age_starts_at_zero():
    model = ForagingModel(
        width=12, height=12, num_clusters=1, patches_per_cluster=3, seed=7
    )
    assert all(h.time_since_last_found == h.collected == 0 for h in model.hunters)
    patch = model.patches[0]
    assert patch.state == MushroomState.AVAILABLE
    patch.state = MushroomState.COLLECTED
    assert patch.color == "yellow"


def test_hk_random_contacts_do_not_double_weight_graph_neighbors():
    model = AdaptiveNetworkHKModel(
        3,
        confidence_bound=2,
        influence_strength=1,
        k_random=3,
        initial_opinions=[0, 1, -1],
        seed=7,
    )
    model.graph.clear_edges()
    model.graph.add_edge(1, 0)
    assert model.calculate_opinion_influence(0) == 0


def test_schelling_reports_jamming_separately_from_satisfaction():
    trial = run_trial(threshold=1, seed=7, steps=10, width=5, height=5, density=1)
    moving = run_trial(threshold=0.7, seed=7, steps=10, width=9, height=7)
    assert moving.steps_run > 1 and moving.termination in ("satisfied", "limit")
    assert trial.termination == "jammed"
    assert trial.satisfied_pct < 1 and trial.last_swapped == 0 and trial.steps_run == 1
    assert (
        run_trial(threshold=0, seed=7, steps=10, width=5, height=5).termination
        == "satisfied"
    )


@pytest.mark.asyncio
async def test_schelling_checkpoint_replays_rng_and_public_protocol_clock():
    scenario, model = await create_schelling_scenario(
        model_kwargs={"width": 9, "height": 7, "seed": 7}
    )
    assert "similarityThreshold" in scenario.parameters
    assert "similarity_threshold" not in scenario.parameters
    for _ in range(3):
        await scenario._advance_step()
    saved = scenario._checkpoint_capture()
    expected = []
    for _ in range(4):
        await scenario._advance_step()
        expected.append(capture_checkpoint(model))
    scenario.server.send = AsyncMock()
    await scenario._on_scene_restore(
        None,
        {
            "request_id": "replay",
            "model_id": scenario.model_id,
            "checkpoint": encode_checkpoint(saved, use_msgpack=False),
        },
    )
    assert scenario._scene_restore_results["replay"]["status"] == "ok"
    assert scenario._time_step == model.tick == 3
    for value in expected:
        await scenario._advance_step()
        assert capture_checkpoint(model) == value
    before = capture_checkpoint(model)
    broken = copy.deepcopy(before)
    broken["random_state"] = "invalid"
    with pytest.raises((TypeError, ValueError)):
        restore_checkpoint(model, broken)
    assert capture_checkpoint(model) == before
    cleanup_mesa_model_step(model)
