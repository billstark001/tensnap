"""Model-visible state and lifecycle through the real Python binding."""

import copy

import pytest

from examples.python_llm.common.viz import build_scenario
from examples.python_llm.mini_commons_harvest.model import MiniCommons
from examples.python_llm.mini_commons_harvest.viz import CommonsView
from examples.python_llm.naming_game.model import NamingGame
from examples.python_llm.naming_game.viz import NamingView


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,factory",
    [
        ("naming_game", NamingGame),
        ("mini_commons_harvest", MiniCommons),
    ],
)
async def test_projection_reset_restore_monitors_and_clock(kind, factory):
    model = factory()
    scenario, view = await build_scenario(
        model, NamingView if kind == "naming_game" else CommonsView
    )
    assert {"selected_agent", "metrics", "inference"} <= set(scenario.monitors)
    assert "reseed" in scenario.actions
    assert "scene.restore.checkpoint" in scenario.capabilities
    assert scenario.state_schema_version == "2"
    assert "scene.restore.projected" not in scenario.capabilities
    await scenario._ensure_initialized()
    initial = scenario.environments["main"].build_state()
    retained = copy.deepcopy(initial)
    for _ in range(4):
        await scenario._advance_step()
    assert initial == retained
    view.selected_agent = 1
    saved = view.capture()
    published = scenario.environments["main"].build_state()
    retained = copy.deepcopy(published)
    await scenario._advance_step()
    assert published == retained
    expected = model.capture()
    view.restore(saved)
    assert scenario._time_step == model.tick == 4
    await scenario._advance_step()
    assert model.capture() == expected
    assert scenario.monitors["selected_agent"][1]()["id"] == "agent_1"
    with pytest.raises(ValueError):
        view.selected_agent = len(model.agents)
    seed = model.config.seed
    await view.reseed()
    assert model.config.seed == seed + 1 and model.tick == scenario._time_step == 0
    await scenario._advance_step()
    assert model.tick == scenario._time_step == 1
    layers = scenario.environments["main"].build_state()["layers"]
    if kind == "naming_game":
        edge_layer = next(
            layer for layer in layers if layer["layer_id"] == "interactions"
        )
        assert edge_layer["dependency_layer_ids"] == {"agent": "agents"}
        assert len(edge_layer["edges"]) == 1
    else:
        resources = next(layer for layer in layers if layer["layer_id"] == "resources")
        assert len(resources["agents"]) == model.config.width * model.config.height
        assert resources["agents"][0]["data"]["value"] == model.resources[0][0]
        agents = next(layer for layer in layers if layer["layer_id"] == "agents")
        for projected, player in zip(agents["agents"], model.agents, strict=True):
            assert projected["y"] == model.config.height - 1 - player.y
            cell = next(
                item
                for item in resources["agents"]
                if item["id"] == f"cell:{player.y}:{player.x}"
            )
            assert (projected["x"], projected["y"]) == (cell["x"], cell["y"])


@pytest.mark.asyncio
async def test_failed_step_keeps_protocol_clock_at_model_time():
    class Provider:
        cursor = 0
        mode = "llm"

        async def decide(self, system, observation):
            from examples.python_llm.common.llm import BudgetExceeded

            raise BudgetExceeded("Fixture: no more paid requests")

        def status(self):
            return {"mode": "fixture"}

    model = NamingGame(provider=Provider())
    scenario, _ = await build_scenario(model, NamingView)
    with pytest.raises(RuntimeError, match="no more paid requests"):
        await scenario._advance_step()
    assert scenario._time_step == model.tick == 0
