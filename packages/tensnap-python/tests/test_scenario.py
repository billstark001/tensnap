"""Tests for the scenario registry/runtime flow."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from tensnap.bindings import (
    BindParameterConfig,
    action,
    agent,
    agent_layer,
    chart,
    env,
    grid_layer,
)
from tensnap.models import EnvironmentBinding, LayerBinding
from tensnap.scenario import DefaultSimulationHandler, SimulationScenario
from tensnap.server import ServerToClientMessageType as MT


class TestSimulationScenario:
    @pytest.fixture
    def scenario(self) -> SimulationScenario:
        return SimulationScenario(
            host="localhost",
            port=8765,
            use_msgpack=False,
            step_interval=0.05,
        )

    def test_initialization_registers_builtin_actions(
        self, scenario: SimulationScenario
    ):
        assert scenario.server.host == "localhost"
        assert scenario.server.port == 8765
        assert scenario.server.use_msgpack is False
        assert scenario.step_interval == 0.05
        assert scenario.environments == {}
        assert {"start", "step", "reset"}.issubset(scenario.actions)

    def test_add_environment_and_layer_builds_registry_state(
        self, scenario: SimulationScenario
    ):
        agents = [{"id": "a1", "x": 1, "y": 2}]
        scenario.add_environment_binding(EnvironmentBinding(id="world", type="2d"))
        scenario.add_layer_binding(
            "world",
            LayerBinding(
                layer_id="agents",
                layer_type="agent",
                item_keys=("id",),
                items_projector=lambda layer: list(layer),
            ),
            agents,
        )

        state = scenario.environments["world"].build_state()

        assert state == {
            "id": "world",
            "type": "2d",
            "layers": [
                {
                    "layer_id": "agents",
                    "layer_type": "agent",
                    "agents": [{"id": "a1", "x": 1, "y": 2}],
                }
            ],
        }

    def test_add_bound_environment_reads_unified_binding_surface(
        self, scenario: SimulationScenario
    ):
        @agent(x="position[0]", y="position[1]")
        class Bird:
            def __init__(self, bird_id: int, position: tuple[int, int]):
                self.id = bird_id
                self.position = position

        @grid_layer(width="width", height="height")
        @agent_layer("birds", item_iterable_projector="birds")
        @env(id="aviary")
        class Aviary:
            def __init__(self):
                self.width = 20
                self.height = 10
                self.birds = [Bird(1, (2, 3))]

        scenario.add_environment(Aviary())

        assert "aviary" in scenario.environments
        assert set(scenario.environments["aviary"].layers) == {"birds", "grid"}

    def test_add_environment_rejects_stale_binder_objects(
        self, scenario: SimulationScenario
    ):
        with pytest.raises(TypeError):
            scenario.add_environment_binding(object())  # type: ignore[arg-type]

    def test_add_parameters_from_object_and_bound_property(
        self, scenario: SimulationScenario
    ):
        class Config:
            def __init__(self):
                self._speed = 10.0
                self.enabled = True

            @BindParameterConfig("number", id="speed", min=0.0, max=100.0)
            def speed(self):
                return self._speed

        param_ids = scenario.add_parameters(Config())

        assert set(param_ids) == {"speed", "enabled"}
        assert set(scenario.parameters) == {"speed", "enabled"}

    @pytest.mark.asyncio
    async def test_add_charts_and_actions_bind_instance_methods(
        self, scenario: SimulationScenario
    ):
        class Model:
            def __init__(self):
                self.calls = 0

            @chart("population", "Population")
            def population(self):
                return 42

            @action("tick", "Tick")
            def tick(self):
                self.calls += 1

        model = Model()
        chart_ids = scenario.add_charts(model)
        scenario.add_actions(model)

        assert chart_ids == ["population"]
        assert set(scenario.charts) == {"population"}
        assert set(scenario.actions) >= {"start", "step", "reset", "tick"}

        scenario._action_handlers["tick"]()
        assert model.calls == 1

    @pytest.mark.asyncio
    async def test_register_handler_invokes_on_registered(
        self, scenario: SimulationScenario
    ):
        handler = AsyncMock()
        handler.on_registered = AsyncMock()
        handler.on_init = AsyncMock()
        handler.on_start = AsyncMock()
        handler.on_step = AsyncMock()
        handler.on_reset = AsyncMock()

        await scenario.register_handler(handler)

        assert scenario._handlers[-1] is handler
        handler.on_registered.assert_awaited_once_with(scenario)

    @pytest.mark.asyncio
    async def test_step_initializes_then_advances_to_step_one(
        self, scenario: SimulationScenario
    ):
        handler = AsyncMock()
        handler.on_registered = AsyncMock()
        handler.on_init = AsyncMock()
        handler.on_start = AsyncMock()
        handler.on_step = AsyncMock()
        handler.on_reset = AsyncMock()

        await scenario.register_handler(handler)

        await scenario._action_handlers["step"]()

        handler.on_init.assert_awaited_once_with()
        handler.on_step.assert_awaited_once_with(1)
        assert scenario._time_step == 1
        assert scenario._initialized is True

    @pytest.mark.asyncio
    async def test_state_sync_initializes_without_advancing_time(
        self, scenario: SimulationScenario
    ):
        handler = AsyncMock()
        handler.on_registered = AsyncMock()
        handler.on_init = AsyncMock()
        handler.on_start = AsyncMock()
        handler.on_step = AsyncMock()
        handler.on_reset = AsyncMock()
        await scenario.register_handler(handler)

        scenario.server.send = AsyncMock()
        ws = object()

        await scenario._on_state_sync(
            ws,
            {
                "request_id": "sync-1",
                "actions": [],
                "parameters": [],
                "envs": [],
                "charts": [],
            },
        )

        handler.on_init.assert_awaited_once_with()
        handler.on_step.assert_not_called()
        assert scenario._time_step == 0
        scenario.server.send.assert_any_await(ws, MT.METADATA_UPDATE, {"time": 0})

    @pytest.mark.asyncio
    async def test_action_start_serializes_action_handlers(
        self, scenario: SimulationScenario
    ):
        class Model:
            def __init__(self):
                self.active = 0
                self.max_active = 0
                self.calls = 0

            @action("slow", "Slow")
            async def slow(self):
                self.active += 1
                self.max_active = max(self.max_active, self.active)
                await asyncio.sleep(0)
                self.calls += 1
                self.active -= 1

        model = Model()
        scenario.add_actions(model)
        scenario.server.send_action_end = AsyncMock()

        await asyncio.gather(
            scenario._on_action_start(object(), {"id": "slow", "tick_id": "a"}),
            scenario._on_action_start(object(), {"id": "slow", "tick_id": "b"}),
        )

        assert model.calls == 2
        assert model.max_active == 1
        assert [
            call.kwargs["tick_id"]
            for call in scenario.server.send_action_end.await_args_list
        ] == ["a", "b"]


class TestDefaultSimulationHandler:
    @pytest.mark.asyncio
    async def test_broadcast_full_state_emits_time_zero_snapshot(self):
        scenario = SimulationScenario()
        handler = DefaultSimulationHandler()
        await handler.on_registered(scenario)

        agents = [{"id": "a1", "x": 1, "y": 2}]
        scenario.add_environment_binding(EnvironmentBinding(id="world", type="2d"))
        scenario.add_layer_binding(
            "world",
            LayerBinding(
                layer_id="agents",
                layer_type="agent",
                item_keys=("id",),
                items_projector=lambda layer: list(layer),
            ),
            agents,
        )

        scenario.server.broadcast = AsyncMock()
        scenario.server.broadcast_metadata_update = AsyncMock()
        scenario.broadcast_charts = AsyncMock()

        await handler.on_init()
        await scenario._broadcast_full_state()

        scenario.server.broadcast_metadata_update.assert_awaited_once_with({"time": 0})
        assert any(
            call.args[0] == MT.ENV_CREATE
            for call in scenario.server.broadcast.await_args_list
        )
        assert any(
            call.args[0] == MT.ENV_LAYER_CREATE
            for call in scenario.server.broadcast.await_args_list
        )
        item_creates = [
            call
            for call in scenario.server.broadcast.await_args_list
            if call.args[0] == MT.ITEM_CREATE
        ]
        assert item_creates
        assert item_creates[0].args[1]["items"] == [{"id": "a1", "x": 1, "y": 2}]

    @pytest.mark.asyncio
    async def test_on_step_emits_incremental_item_updates(self):
        scenario = SimulationScenario()
        handler = DefaultSimulationHandler()
        await handler.on_registered(scenario)

        agents = [{"id": "a1", "x": 1, "y": 2}]
        scenario.add_environment_binding(EnvironmentBinding(id="world", type="2d"))
        scenario.add_layer_binding(
            "world",
            LayerBinding(
                layer_id="agents",
                layer_type="agent",
                item_keys=("id",),
                items_projector=lambda layer: list(layer),
            ),
            agents,
        )

        scenario.server.broadcast = AsyncMock()
        scenario.server.broadcast_metadata_update = AsyncMock()
        scenario.broadcast_charts = AsyncMock()

        await handler.on_init()
        scenario.server.broadcast.reset_mock()

        agents[0] = {"id": "a1", "x": 3, "y": 2}
        await handler.on_step(1)

        scenario.server.broadcast_metadata_update.assert_awaited_with({"time": 1})
        item_updates = [
            call
            for call in scenario.server.broadcast.await_args_list
            if call.args[0] == MT.ITEM_UPDATE
        ]
        assert item_updates
        assert item_updates[0].args[1]["items"] == [{"id": "a1", "x": 3}]

    @pytest.mark.asyncio
    async def test_on_reset_prefers_explicit_reset_and_falls_back_to_init(self):
        scenario = SimulationScenario()
        model_init = AsyncMock()
        model_reset = AsyncMock()

        explicit_reset = DefaultSimulationHandler(
            model_init=model_init,
            model_reset=model_reset,
        )
        await explicit_reset.on_registered(scenario)
        await explicit_reset.on_reset()

        model_reset.assert_awaited_once_with()
        model_init.assert_not_awaited()

        fallback_reset = DefaultSimulationHandler(model_init=model_init)
        await fallback_reset.on_registered(scenario)
        await fallback_reset.on_reset()

        assert model_init.await_count == 1
