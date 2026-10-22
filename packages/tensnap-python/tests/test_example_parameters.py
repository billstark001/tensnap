"""Parameter inventories and edit semantics of the runnable Python examples."""

import pytest
from cgol import GameOfLife
from examples.python_llm.mini_commons_harvest.model import MiniCommons
from examples.python_llm.mini_commons_harvest.viz import CommonsView
from examples.python_llm.naming_game.model import NamingGame
from examples.python_llm.naming_game.viz import NamingView
from flock import FlockConfig
from hk import AdaptiveNetworkHKModel
from mushroom import ForagingModel
from predator_prey import PredatorPreyConfig
from random_walk import RandomWalkConfig
from schelling_tensnap import SchellingModel
from sirs import ERNetworkEnvironment, GridEnvironment, SIRSSimulation
from sugarscape import Sugarscape

from tensnap import BindParametersConfig, SimulationScenario
from tensnap.bindings import parameters
from tensnap.bindings.mesa import cleanup_mesa_model_step


@pytest.mark.parametrize(
    "target,expected",
    [
        (
            RandomWalkConfig(num_agents=9, step_size=0.75, seed=23),
            {"num_agents", "step_size", "seed"},
        ),
        (
            FlockConfig(num_agents=9, max_speed=1.2, spawn_radius=6, seed=23),
            {
                "num_agents",
                "max_speed",
                "spawn_radius",
                "seed",
                "separation_distance",
                "alignment_distance",
                "cohesion_distance",
            },
        ),
        (
            PredatorPreyConfig(initial_sheep=12, initial_wolves=3, seed=23),
            {
                "initial_sheep",
                "initial_wolves",
                "sheep_gain_from_food",
                "wolf_gain_from_food",
                "sheep_reproduce_rate",
                "wolf_reproduce_rate",
                "sheep_energy_loss",
                "wolf_energy_loss",
                "wolf_sight_radius",
                "grass_regrowth_steps",
                "seed",
            },
        ),
        (
            AdaptiveNetworkHKModel(n_agents=12, seed=23),
            {
                "n_agents",
                "confidence_bound",
                "influence_strength",
                "k_random",
                "rewire_prob",
                "edge_prob",
                "seed",
            },
        ),
        (GridEnvironment(7, 9), {"rows", "cols"}),
        (ERNetworkEnvironment(20, 0.2), {"num_agents", "connection_prob"}),
        (
            SIRSSimulation(GridEnvironment(7, 9), 0.4, 0.1, 0.05, 3, seed=23),
            {"beta", "gamma", "xi", "initial_infected", "seed"},
        ),
    ],
    ids=["walk", "flock", "predators", "hk", "sirs-grid", "sirs-graph", "sirs"],
)
def test_examples_publish_one_current_value_per_control(target, expected):
    discovered = parameters(target)
    assert len(discovered) == len({parameter.id for _, parameter in discovered})
    scenario = SimulationScenario()
    scenario.add_all(target)
    assert set(scenario.parameters) == expected
    for name, parameter in discovered:
        assert parameter.value == getattr(target, name)
        assert scenario.parameters[parameter.id].value == getattr(target, name)
        assert scenario.get_parameter(parameter.id) == getattr(target, name)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "factory,integer_fields,extra",
    [
        (
            lambda: GameOfLife(width=9, height=7, seed=23),
            {"width", "height", "seed"},
            set(),
        ),
        (
            lambda: ForagingModel(
                width=12, height=12, num_clusters=1, patches_per_cluster=8, seed=23
            ),
            {
                "width",
                "height",
                "num_clusters",
                "patches_per_cluster",
                "num_turtles",
                "seed",
            },
            {"area_restricted"},
        ),
        (
            lambda: Sugarscape(
                width=9, height=7, agent_count=12, seed=23, grid_type="random"
            ),
            {
                "width",
                "height",
                "agent_count",
                "seed",
                "sugar_growth_rate",
                "vision_min",
                "vision_max",
            },
            {
                "grid_type",
                "metabolism_min",
                "metabolism_max",
                "initial_sugar_min",
                "initial_sugar_max",
                "torus",
            },
        ),
    ],
    ids=["cgol", "mushroom", "sugarscape"],
)
async def test_mesa_constructor_controls_are_typed_and_staged(
    factory, integer_fields, extra
):
    model = factory()
    scenario = SimulationScenario()
    try:
        await scenario.register_model(model)
        assert set(scenario.parameters) == integer_fields | extra
        for name, parameter in scenario.parameters.items():
            assert parameter.allow_runtime_change is False
            assert parameter.value == scenario.get_parameter(name)
            if name in integer_fields:
                assert parameter.type == "number" and parameter.step == 1
        if isinstance(model, Sugarscape):
            parameter = scenario.parameters["grid_type"]
            assert parameter.type == "enum"
            assert parameter.options == ["circular", "random"]
            assert parameter.value == "random"
        width = model.width
        scenario.set_parameter("width", width + 1)
        scenario.set_parameter("seed", 29)
        assert (model.width, model.seed) == (width, 23)
        await scenario.reset()
        assert (model.width, model.seed) == (width + 1, 29)
    finally:
        cleanup_mesa_model_step(model)


@pytest.mark.asyncio
async def test_schelling_keeps_native_property_and_public_parameter_id():
    assert isinstance(SchellingModel.similarity_threshold, property)
    model = SchellingModel(width=9, height=7, seed=23)
    scenario = SimulationScenario()
    try:
        await scenario.register_model(model)
        assert set(scenario.parameters) == {
            "width",
            "height",
            "density",
            "balance",
            "similarityThreshold",
            "seed",
        }
        assert "similarity_threshold" not in scenario.parameters
        assert (
            scenario.parameters["width"].min == scenario.parameters["height"].min == 1
        )
        scenario.set_parameter("similarityThreshold", 1.4)
        assert (
            model.similarity_threshold
            == scenario.get_parameter("similarityThreshold")
            == 1.0
        )
        scenario.set_parameter("similarityThreshold", 0.4)
        assert model.similarity_threshold == 0.4
        await scenario.reset()
        assert model.similarity_threshold == 0.4
    finally:
        cleanup_mesa_model_step(model)


@pytest.mark.parametrize("kind", ["naming", "commons"])
def test_llm_views_declare_inherited_controls_and_observers_once(kind):

    model, view_type = (
        (NamingGame(), NamingView) if kind == "naming" else (MiniCommons(), CommonsView)
    )
    view = view_type(model)
    scenario = SimulationScenario()
    scenario.add_all(view)
    expected = {"selected_agent", "seed", "policy", "scenario"} | (
        {"agent_count", "topology", "initial_names", "layout", "degree", "exploration"}
        if kind == "naming"
        else {"regrowth", "rule"}
    )
    assert set(scenario.parameters) == expected
    assert {"selected_agent", "inference", "metrics"} <= set(scenario.monitors)
    assert "reseed" in scenario.actions
    assert (
        scenario.parameters["policy"].type
        == scenario.parameters["scenario"].type
        == "enum"
    )
    if kind == "commons":
        assert scenario.parameters["rule"].type == "enum"
        scenario.set_parameter("rule", "conserve")
        assert model.config.rule == "conserve"


@pytest.mark.asyncio
async def test_dqn_guide_has_one_control_and_initialization_edits_apply_on_reset(
    tmp_path,
):
    pytest.importorskip("torch")
    from examples.python_dqn.config import DQNConfig, EnvConfig
    from examples.python_dqn.evac_viz import configure_visualization_scenario

    config = EnvConfig(num_evacuees=12, max_steps=40)
    scenario = SimulationScenario()
    model, manager = await configure_visualization_scenario(
        scenario, config, DQNConfig(hidden_dim=8), "cpu", tmp_path
    )
    try:
        assert [
            (name, parameter.id)
            for name, parameter in parameters(
                manager, BindParametersConfig.EXPLICIT_ONLY
            )
        ] == [("guide_model", "guideModel")]
        assert len(scenario.parameters) == 18
        assert scenario.parameters["guideModel"].type == "enum"
        assert scenario.parameters["guideModel"].options == ["untrained"]
        for name in ("width", "height", "num_evacuees", "sample_fire_source"):
            assert scenario.parameters[name].allow_runtime_change is False
        assert scenario.parameters["max_steps"].allow_runtime_change is True
        scenario.set_parameter("guideModel", "untrained")
        assert manager.guide_model == "untrained"
        scenario.set_parameter("num_evacuees", 9)
        assert len(model.evacuees) == 12
        await scenario.reset()
        assert len(model.evacuees) == 9
        assert scenario.parameters["num_evacuees"].value == 9
    finally:
        cleanup_mesa_model_step(model)
