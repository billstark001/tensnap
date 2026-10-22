"""Model-visible state and lifecycle through the real Python binding."""

import copy
from unittest.mock import AsyncMock

import pytest

from examples.python_llm.common.viz import build_scenario
from examples.python_llm.mini_commons_harvest.model import MiniCommons
from examples.python_llm.mini_commons_harvest.scenarios import COMMONS_SCENARIOS
from examples.python_llm.mini_commons_harvest.viz import CommonsView
from examples.python_llm.naming_game.model import NamingGame
from examples.python_llm.naming_game.scenarios import NAMING_SCENARIOS
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
        assert edge_layer["data"]["link_distance"] == -1
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "factory,view_type,condition",
    [
        (NamingGame, NamingView, "community-minority"),
        (MiniCommons, CommonsView, "signal-off-drought"),
    ],
)
async def test_initialization_controls_accept_edits_and_apply_on_reset(
    factory, view_type, condition
):
    model = factory()
    scenario, view = await build_scenario(model, view_type)
    await scenario._ensure_initialized()
    await scenario._advance_step()
    active = model.capture()
    scenario.server.send = AsyncMock()
    for name, value in [("seed", 42), ("scenario", condition)]:
        await scenario._on_param_change(None, {"id": name, "value": value})
        assert scenario.get_parameter(name) == value
    # Accepted values must not be rejected/canonicalized back to the old value.
    scenario.server.send.assert_not_awaited()
    assert model.capture() == active
    pending = view.capture()
    view.seed = 8
    view.restore(pending)
    assert view.capture() == pending
    await scenario.reset()
    assert model.config.seed == 42
    assert model.tick == scenario._time_step == 0
    assert scenario.get_parameter("scenario") == condition
    if factory is NamingGame:
        assert model.config.topology == "community"
        assert len(model.committed_ids) == 4
        assert model.network_summary()["cross_community_edges"] == 2
    else:
        assert model.config.rule == "signal"
        assert model.config.message_delivery == "off"
        assert model.config.drought_start == model.config.drought_duration == 40
    expected = factory(model.config)
    await scenario._advance_step()
    await expected.step()
    assert model.capture() == expected.capture()
    # Older view checkpoints have no staged initialization controls.
    pending.pop("controls")
    view.restore(pending)
    assert view.seed == active["config"]["seed"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "factory,view_type,conditions",
    [
        (NamingGame, NamingView, NAMING_SCENARIOS),
        (MiniCommons, CommonsView, COMMONS_SCENARIOS),
    ],
)
async def test_enum_metadata_and_invalid_edits(factory, view_type, conditions):
    scenario, view = await build_scenario(factory(), view_type)
    assert scenario.parameters["policy"].type == "enum"
    assert scenario.parameters["policy"].options == ["rule", "llm", "replay"]
    assert scenario.parameters["scenario"].type == "enum"
    assert scenario.parameters["scenario"].options == [*conditions, "custom"]
    if factory is MiniCommons:
        assert scenario.parameters["rule"].type == "enum"
        scenario.parameters["rule"].setter("conserve")
        assert view.model.config.rule == "conserve"
        assert view.scenario == "conserve-on-normal"
    before = view.capture()
    for name, value in [
        ("seed", -1),
        ("seed", 1.5),
        ("scenario", "unknown"),
        ("policy", "llm"),
    ]:
        with pytest.raises(ValueError):
            scenario.parameters[name].setter(value)
        assert view.capture() == before
    invalid = copy.deepcopy(before)
    invalid["controls"]["scenario"] = "unknown"
    with pytest.raises(ValueError, match="Unknown scenario"):
        view.restore(invalid)
    assert view.capture() == before


@pytest.mark.asyncio
async def test_policy_switch_and_checkpoint_restore_reuse_the_configured_provider():
    class Provider:
        mode = "llm"
        cursor = 0

        def status(self):
            return {"mode": self.mode, "live_calls": 12}

    provider = Provider()
    model = NamingGame(provider=provider)
    scenario, view = await build_scenario(model, NamingView)
    await scenario._ensure_initialized()
    llm_checkpoint = view.capture()
    scenario.parameters["policy"].setter("rule")
    assert model.provider is provider
    await scenario.reset()
    assert model.provider is None
    rule_checkpoint = view.capture()
    view.restore(llm_checkpoint)
    assert model.provider is provider
    assert view.policy == "llm"
    view.restore(rule_checkpoint)
    assert model.provider is None
    assert view.policy == "rule"
    scenario.parameters["policy"].setter("llm")
    await scenario.reset()
    assert model.provider is provider
    assert view.inference()["live_calls"] == 12
