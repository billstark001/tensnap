"""Tests for the scenario registry/runtime flow."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from tensnap.bindings import (
    BindParameterConfig,
    BindParametersConfig,
    action,
    agent,
    agent_layer,
    chart,
    env,
    grid_layer,
    monitor,
    params,
    scene_restore,
)
from tensnap.models import (
    ChartGroupMetadata,
    ChartMetadata,
    EnvironmentBinding,
    LayerBinding,
    MonitorMetadata,
)
from tensnap.protocol import compute_chart_deltas
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
        env_changes = scenario.add_environment_binding(
            EnvironmentBinding(id="world", type="2d")
        )
        layer_changes = scenario.add_layer_binding(
            "world",
            LayerBinding(
                layer_id="agents",
                layer_type="agent",
                item_keys=("id",),
                items_projector=lambda layer: list(layer),
            ),
            agents,
        )

        assert env_changes == {"environments": ["world"]}
        assert layer_changes == {"layers": ["world.agents"]}
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

        changes = scenario.add_environment(Aviary())

        assert changes == {
            "environments": ["aviary"],
            "layers": ["aviary.birds", "aviary.grid"],
        }
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

        changes = scenario.add_parameters(Config())

        assert set(changes["parameters"]) == {"speed", "enabled"}
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
        chart_changes = scenario.add_charts(model)
        action_changes = scenario.add_actions(model)

        assert chart_changes == {"charts": ["population"]}
        assert action_changes == {"actions": ["tick"]}
        assert set(scenario.charts) == {"population"}
        assert set(scenario.actions) >= {"start", "step", "reset", "tick"}

        scenario._action_handlers["tick"]()
        assert model.calls == 1

    @pytest.mark.asyncio
    async def test_declarative_monitors_and_restore_hooks(
        self, scenario: SimulationScenario
    ):
        @scene_restore(
            "restore",
            checkpoint_capture="capture",
            checkpoint_restore="restore_checkpoint",
        )
        class Model:
            def __init__(self):
                self.value = 2
                self.restored = None

            @monitor("status", "Status", render_hint="tree")
            def status(self):
                return {"value": self.value}

            def restore(self, payload):
                self.restored = payload

            def capture(self):
                return {"value": self.value}

            def restore_checkpoint(self, data):
                self.value = data["value"]

        model = Model()
        changes = scenario.add_all(model)

        assert changes["monitors"] == ["status"]
        assert scenario.server.simulator_info_payload["capabilities"] == [
            "monitor",
            "scene.restore.checkpoint",
            "scene.restore.projected",
        ]
        assert scenario._scene_restore is not None
        scenario._scene_restore({"time": 4})
        assert model.restored == {"time": 4}

        ws = object()
        scenario.server.send = AsyncMock()  # type: ignore[method-assign]
        await scenario.broadcast_monitors(ws)
        scenario.server.send.assert_awaited_once_with(
            ws,
            MT.MONITOR_UPDATE,
            {"id": "status", "value": {"value": 2}},
        )

        scenario.server.send.reset_mock()
        await scenario._on_scene_capture(ws, {"request_id": "capture-1"})
        capture_payload = scenario.server.send.await_args.args[2]
        assert capture_payload["checkpoint"]["encoding"] == "application/msgpack"

        scenario.server.send.reset_mock()
        await scenario._on_scene_restore(
            ws,
            {
                "request_id": "restore-1",
                "model_id": scenario.model_id,
                "checkpoint": capture_payload["checkpoint"],
                "time": 7,
            },
        )
        assert model.value == 2
        assert model.restored["time"] == 7
        message_types = [call.args[1] for call in scenario.server.send.await_args_list]
        assert MT.CHART_CREATE not in message_types
        assert MT.CHART_UPDATE not in message_types
        assert MT.CHART_DELETE not in message_types

    @pytest.mark.asyncio
    async def test_checkpoint_only_restore_receives_decoded_model_data(
        self, scenario: SimulationScenario
    ):
        @scene_restore(
            None,
            checkpoint_capture="capture",
            checkpoint_restore="restore_checkpoint",
        )
        class Model:
            def __init__(self):
                self.value = 2

            def capture(self):
                return {"value": self.value}

            def restore_checkpoint(self, data):
                self.value = data["value"]

        model = Model()
        scenario.add_all(model)
        assert scenario.server.simulator_info_payload["capabilities"] == [
            "scene.restore.checkpoint"
        ]

        scenario.server.send = AsyncMock()  # type: ignore[method-assign]
        ws = object()
        await scenario._on_scene_capture(ws, {"request_id": "capture-only"})
        checkpoint = scenario.server.send.await_args.args[2]["checkpoint"]
        model.value = 9
        await scenario._on_scene_restore(
            ws,
            {
                "request_id": "restore-only",
                "model_id": scenario.model_id,
                "checkpoint": checkpoint,
            },
        )

        assert model.value == 2
        scenario.server.send.assert_any_await(
            ws,
            MT.SCENE_RESTORE_END,
            {"request_id": "restore-only", "status": "ok"},
        )

    def test_chart_sync_preserves_flat_group_inventory(self):
        group = ChartGroupMetadata(
            id="population-group",
            label="Population group",
            data_list=[
                ChartMetadata(id="population", label="Population"),
                ChartMetadata(id="happy", label="Happy"),
            ],
        )

        deltas = compute_chart_deltas(
            {"population-group": (group, lambda: None)},
            [
                {"id": "population", "label": "old renderer label"},
                {"id": "happy", "label": "Happy"},
                {"id": "stale", "label": "Stale"},
            ],
        )

        assert deltas == {"added": [], "removed": ["stale"], "updated": []}

    def test_add_all_returns_changes_and_accepts_targets_without_environment(
        self, scenario: SimulationScenario
    ):
        class Model:
            def __init__(self):
                self.speed = 1
                self.size = 2

            @chart("population", "Population")
            def population(self):
                return 42

            @action("tick", "Tick")
            def tick(self):
                pass

        changes = scenario.add_all(Model(), BindParametersConfig(include=["speed"]))

        assert changes == {
            "environments": [],
            "layers": [],
            "parameters": ["speed"],
            "actions": ["tick"],
            "charts": ["population"],
        }

    def test_add_all_dry_run_reports_changes_without_mutating_state(
        self, scenario: SimulationScenario
    ):
        @grid_layer(width="width", height="height")
        @env(id="world")
        class Model:
            def __init__(self):
                self.width = 10
                self.height = 8
                self.speed = 1

            @chart("population", "Population")
            def population(self):
                return 42

            @action("tick", "Tick")
            def tick(self):
                pass

        changes = scenario.add_all(Model(), dry_run=True)

        assert changes == {
            "environments": ["world"],
            "layers": ["world.grid"],
            "parameters": [],
            "actions": ["tick"],
            "charts": ["population"],
        }
        assert scenario.environments == {}
        assert scenario.parameters == {}
        assert set(scenario.actions) == {"start", "step", "reset"}
        assert scenario.charts == {}

    def test_add_all_uses_attached_params_with_default_exclude_all(
        self, scenario: SimulationScenario
    ):
        @params(include=["speed"])
        class Model:
            def __init__(self):
                self.speed = 1
                self.size = 2

        changes = scenario.add_all(Model())

        assert changes == {
            "environments": [],
            "layers": [],
            "parameters": ["speed"],
            "actions": [],
            "charts": [],
        }
        assert set(scenario.parameters) == {"speed"}

    def test_add_all_default_registers_explicit_params_only(
        self, scenario: SimulationScenario
    ):
        class Model:
            def __init__(self):
                self._speed = 1
                self.size = 2

            @BindParameterConfig("number", id="speed", min=0, max=10, step=1)
            def speed(self):
                return self._speed

            def set_speed(self, value):
                self._speed = value

            speed = speed.setter(set_speed)

        changes = scenario.add_all(Model())

        assert changes == {
            "environments": [],
            "layers": [],
            "parameters": ["speed"],
            "actions": [],
            "charts": [],
        }
        assert set(scenario.parameters) == {"speed"}

    def test_remove_all_returns_changes_without_removing_builtin_actions(
        self, scenario: SimulationScenario
    ):
        class Model:
            def __init__(self):
                self.speed = 1

            @action("tick", "Tick")
            def tick(self):
                pass

        scenario.add_environment_binding(EnvironmentBinding(id="world", type="2d"))
        scenario.add_layer_binding(
            "world",
            LayerBinding(
                layer_id="agents",
                layer_type="agent",
                item_keys=("id",),
                items_projector=lambda layer: list(layer),
            ),
            [],
        )
        scenario.add_parameters(Model())
        scenario.add_actions(Model())

        changes = scenario.remove_all()

        assert changes == {
            "charts": [],
            "actions": ["tick"],
            "parameters": ["speed"],
            "environments": ["world"],
            "layers": ["world.agents"],
        }
        assert {"start", "step", "reset"}.issubset(scenario.actions)
        assert "tick" not in scenario.actions

    def test_remove_by_dict_ignores_missing_entries(self, scenario: SimulationScenario):
        class Model:
            def __init__(self):
                self.speed = 1

            @chart("population", "Population")
            def population(self):
                return 42

            @action("tick", "Tick")
            def tick(self):
                pass

        model = Model()
        scenario.add_environment_binding(EnvironmentBinding(id="world", type="2d"))
        scenario.add_layer_binding(
            "world",
            LayerBinding(
                layer_id="agents",
                layer_type="agent",
                item_keys=("id",),
                items_projector=lambda layer: list(layer),
            ),
            [],
        )
        scenario.add_parameters(model)
        scenario.add_charts(model)
        scenario.add_actions(model)

        changes = scenario.remove_by_dict(
            {
                "charts": ["population", "missing"],
                "actions": ["tick", "missing"],
                "parameters": ["speed", "missing"],
                "layers": ["world.agents", "world.missing", "missing"],
                "environments": ["world", "missing"],
            }
        )

        assert changes == {
            "charts": ["population"],
            "actions": ["tick"],
            "parameters": ["speed"],
            "layers": ["world.agents"],
            "environments": ["world"],
        }
        assert "population" not in scenario.charts
        assert "tick" not in scenario.actions
        assert "speed" not in scenario.parameters
        assert "world" not in scenario.environments

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
    async def test_state_sync_replace_replays_objects_despite_stale_inventory(
        self, scenario: SimulationScenario
    ):
        scenario.add_environment_binding(EnvironmentBinding(id="world", type="2d"))
        scenario.server.send = AsyncMock()
        ws = object()

        await scenario._on_state_sync(
            ws,
            {
                "request_id": "sync-replace",
                "model_id": scenario.model_id,
                "instance_id": "stale-instance",
                "actions": [],
                "parameters": [],
                "envs": [{"id": "world", "type": "2d", "layers": []}],
                "charts": [],
                "monitors": [],
            },
        )

        scenario.server.send.assert_any_await(
            ws,
            MT.STATE_SYNC_BEGIN,
            {
                "request_id": "sync-replace",
                "model_id": scenario.model_id,
                "instance_id": scenario.instance_id,
                "mode": "replace",
            },
        )
        scenario.server.send.assert_any_await(
            ws, MT.ENV_CREATE, {"id": "world", "type": "2d"}
        )

    @pytest.mark.asyncio
    async def test_state_sync_replaces_changed_monitor_metadata(
        self, scenario: SimulationScenario
    ):
        class Model:
            @monitor("status", "Status", render_hint="tree")
            def status(self):
                return {"ok": True}

        scenario.add_monitors(Model())
        scenario.server.send = AsyncMock()
        ws = object()
        await scenario._on_state_sync(
            ws,
            {
                "request_id": "sync-monitor",
                "model_id": scenario.model_id,
                "instance_id": scenario.instance_id,
                "actions": [action.to_dict() for action in scenario.actions.values()],
                "parameters": [],
                "envs": [],
                "charts": [],
                "monitors": [{"id": "status", "label": "Old"}],
            },
        )

        calls = [
            (call.args[1], call.args[2])
            for call in scenario.server.send.await_args_list
        ]
        delete_index = calls.index((MT.MONITOR_DELETE, {"id": "status"}))
        create_index = calls.index(
            (
                MT.MONITOR_CREATE,
                {"id": "status", "label": "Status", "render_hint": "tree"},
            )
        )
        assert delete_index < create_index

    @pytest.mark.asyncio
    async def test_reset_replaces_changed_monitor_metadata_without_duplicate_create(
        self, scenario: SimulationScenario
    ):
        class Model:
            @monitor("status", "Status")
            def status(self):
                return {"ok": True}

        model = Model()
        scenario.add_monitors(model)
        handler = AsyncMock()
        handler.on_registered = AsyncMock()

        async def replace_monitor() -> None:
            scenario.monitors["status"] = (
                MonitorMetadata("status", "Updated", "tree"),
                model.status,
            )

        handler.on_reset = AsyncMock(side_effect=replace_monitor)
        await scenario.register_handler(handler)
        scenario.server.broadcast = AsyncMock()
        scenario.server.broadcast_metadata_update = AsyncMock()

        await scenario._fire_reset()

        calls = [
            (call.args[0], call.args[1])
            for call in scenario.server.broadcast.await_args_list
        ]
        delete_index = calls.index((MT.MONITOR_DELETE, {"id": "status"}))
        create = (
            MT.MONITOR_CREATE,
            {
                "id": "status",
                "label": "Updated",
                "render_hint": "tree",
            },
        )
        assert calls.count(create) == 1
        assert delete_index < calls.index(create)

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
            scenario._on_action_invoke(object(), {"id": "slow", "request_id": "a"}),
            scenario._on_action_invoke(object(), {"id": "slow", "request_id": "b"}),
        )

        assert model.calls == 2
        assert model.max_active == 1
        assert [
            call.kwargs["request_id"]
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
