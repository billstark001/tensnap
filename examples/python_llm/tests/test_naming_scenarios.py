"""Population, initial conventions and layout are reproducible scene choices."""

import math
from dataclasses import replace

import networkx as nx
import pytest

from examples.python_llm.common.viz import build_scenario
from examples.python_llm.naming_game.model import NamingConfig, NamingGame
from examples.python_llm.naming_game.scenarios import LAYOUTS, NAMING_SCENARIOS
from examples.python_llm.naming_game.viz import NamingView


@pytest.mark.parametrize("preset", NAMING_SCENARIOS)
def test_all_presets_initialize_and_reset_exactly(preset):
    config = NAMING_SCENARIOS[preset].configure(NamingConfig())
    model = NamingGame(config)
    initial = model.capture()
    assert len(model.agents) == config.agents
    assert nx.is_connected(model.network.graph)
    assert all(not agent.history and agent.score == 0 for agent in model.agents)
    assert len({(agent.x, agent.y) for agent in model.agents}) == config.agents
    assert all(
        math.isfinite(agent.x) and math.isfinite(agent.y) for agent in model.agents
    )
    model.reset()
    assert model.capture() == initial


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_barbell_has_two_cliques_one_bridge_and_separated_positions(seed):
    config = replace(
        NAMING_SCENARIOS["barbell-polarized"].configure(NamingConfig()),
        seed=seed,
        agents=12,
    )
    model = NamingGame(config)
    assert model.network_summary()["cross_community_edges"] == 1
    assert len(list(nx.bridges(model.network.graph))) == 1
    assert model.network.graph.number_of_edges() == 31
    for _ in range(30):
        first, second = model._choose_pair()
        assert (
            int(second.id.split("_")[1]) in model.neighbors[int(first.id.split("_")[1])]
        )
    for group in (0, 1):
        members = [
            i
            for i, agent in enumerate(model.agents)
            if model.communities[agent.id] == group
        ]
        assert model.network.graph.subgraph(members).number_of_edges() == 15
        players = [model.agents[i] for i in members]
        assert {agent.name for agent in players} == ({"Q"} if group == 0 else {"M"})
        assert all(
            (agent.x <= 9) if group == 0 else (agent.x >= 13) for agent in players
        )


@pytest.mark.asyncio
async def test_layout_changes_do_not_change_contact_or_policy_trajectories():
    models = [
        NamingGame(NamingConfig(topology="community", layout=layout))
        for layout in LAYOUTS
    ]
    assert len(
        {tuple((agent.x, agent.y) for agent in model.agents) for model in models}
    ) == len(LAYOUTS)
    for _ in range(30):
        for model in models:
            await model.step()
        for model in models[1:]:
            assert model.last_interaction == models[0].last_interaction
            assert model.metrics() == models[0].metrics()
            assert model.rng.getstate() == models[0].rng.getstate()
            assert model.policy_rng.getstate() == models[0].policy_rng.getstate()
    saved = models[1].capture()
    for _ in range(5):
        await models[1].step()
    expected = models[1].capture()
    models[1].restore(saved)
    for _ in range(5):
        await models[1].step()
    assert models[1].capture() == expected


@pytest.mark.parametrize(
    "assignment,q,m,unassigned",
    [
        ("unassigned", 0, 0, 24),
        ("all-q", 24, 0, 0),
        ("all-m", 0, 24, 0),
        ("balanced", 12, 12, 0),
        ("polarized", 12, 12, 0),
    ],
)
def test_initial_names_are_real_choices_without_fabricated_histories(
    assignment, q, m, unassigned
):
    model = NamingGame(NamingConfig(initial_names=assignment))
    names = [agent.name for agent in model.agents]
    assert (names.count("Q"), names.count("M"), names.count(None)) == (q, m, unassigned)
    for player in model.agents:
        assert player.history == []
        if player.name is not None:
            assert model.rule_decision(player)["name"] == player.name
            assert model.observation(player)["current_name"] == player.name
        else:
            assert "current_name" not in model.observation(player)


@pytest.mark.asyncio
async def test_population_reset_manual_overrides_and_cross_population_restore():
    model = NamingGame(NamingConfig(agents=64))
    scenario, view = await build_scenario(model, NamingView)
    await scenario._ensure_initialized()
    view.selected_agent = 63
    scenario.parameters["scenario"].setter("small-population")
    pending = view.capture()
    await scenario.reset()
    assert len(model.agents) == 12
    assert scenario.parameters["agent_count"].value == 12
    assert scenario.parameters["topology"].value == "ring"
    assert view.scenario == "small-population"
    assert view.selected_agent == scenario.parameters["selected_agent"].max == 11
    view.restore(pending)
    assert len(model.agents) == 64
    assert view.selected_agent == scenario.parameters["selected_agent"].max == 63
    for name, value in [
        ("agent_count", 20),
        ("initial_names", "balanced"),
        ("layout", "grid"),
    ]:
        scenario.parameters[name].setter(value)
        assert scenario.get_parameter(name) == value
    staged = view.capture()
    view.restore(staged)
    await scenario.reset()
    assert len(model.agents) == 20
    assert scenario.parameters["agent_count"].value == 20
    assert scenario.parameters["initial_names"].value == "balanced"
    assert model.config.layout == "grid"
    assert model.metrics()["q_share"] == model.metrics()["m_share"] == 0.5
    assert view.scenario == "custom"
    layers = scenario.environments["main"].build_state()["layers"]
    contacts = next(layer for layer in layers if layer["layer_id"] == "contacts")
    assert len(contacts["edges"]) == model.network.graph.number_of_edges()
    assert contacts["data"]["link_distance"] == -1
    assert contacts["dependency_layer_ids"] == {"agent": "agents"}


@pytest.mark.asyncio
async def test_named_initial_state_affects_first_encounter_and_replays():
    model = NamingGame(NamingConfig(initial_names="all-m"))
    old = model.capture()
    await model.step()
    assert model.last_interaction["names"] == ["M", "M"]
    assert model.last_interaction["success"]
    expected = model.capture()
    model.restore(old)
    await model.step()
    assert model.capture() == expected
