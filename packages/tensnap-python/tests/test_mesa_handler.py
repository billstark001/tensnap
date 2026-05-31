from typing import Any

import pytest

import tensnap.bindings as binding_api
from tensnap import SimulationScenario
from tensnap.bindings.mesa import (
    BoundModelReinitializer,
    MesaSimulationHandler,
    bind_datacollector,
    bind_kwargs,
    get_bind_kwargs,
)

try:
    import mesa as _mesa
except ImportError:  # pragma: no cover - optional dev dependency
    _mesa = None

mesa: Any = _mesa


class FakeGrid:
    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height


class FakeAgent:
    def __init__(self, unique_id: int, pos: tuple[int, int]):
        self.unique_id = unique_id
        self.pos = pos


class FakeMesaModel:
    def __init__(self, width: int = 5, height: int = 4, agent_count: int = 2):
        self.grid = FakeGrid(width, height)
        self.temperature = 20
        self.agents = [FakeAgent(index, (index, index)) for index in range(agent_count)]

    def step(self) -> None:
        pass


class WidthFieldMesaModel:
    def __init__(self, width: int = 5, height: int = 4):
        self.width = width
        self.grid = FakeGrid(width, height)
        self.agents = []

    def step(self) -> None:
        pass


class FakeDataCollector:
    def __init__(self):
        self.model_reporters = {"Temperature": "temperature"}
        self.model_vars = {"Temperature": [21, 22]}


@bind_datacollector()
class DataCollectorModel:
    def __init__(self):
        self.datacollector = FakeDataCollector()
        self.temperature = 22

    def step(self) -> None:
        pass


if mesa is not None:

    class CountingMesaModel(mesa.Model):  # type: ignore[misc]
        step_calls = 0

        def __init__(self):
            super().__init__()
            self.grid = mesa.space.SingleGrid(1, 1, torus=True)

        def step(self) -> None:
            type(self).step_calls += 1


@pytest.mark.asyncio
async def test_mesa_handler_reset_replays_constructor_kwargs():
    scenario = SimulationScenario()
    handler = MesaSimulationHandler(
        model_class=FakeMesaModel,
        model_init_kwargs={"width": 8, "height": 6, "agent_count": 3},
    )

    await scenario.register_handler(handler)

    assert handler.model is not None
    assert handler.model.grid.width == 8
    assert handler.model.temperature == 20
    assert len(handler.model.agents) == 3

    scenario.set_parameter("agent_count", 5)
    scenario.set_parameter("temperature", 42)

    await handler.on_reset()

    assert handler.model is not None
    assert handler.model.grid.width == 8
    assert handler.model.grid.height == 6
    assert len(handler.model.agents) == 5
    assert handler.model.temperature == 20


@pytest.mark.asyncio
async def test_mesa_handler_reset_uses_model_field_for_conflicting_kwarg():
    scenario = SimulationScenario()
    handler = MesaSimulationHandler(
        model_class=WidthFieldMesaModel,
        model_init_kwargs={"width": 8, "height": 6},
    )

    await scenario.register_handler(handler)

    assert handler.model is not None
    scenario.set_parameter("width", 11)
    await handler.on_reset()

    assert handler.model.grid.width == 11
    assert handler.model.width == 11
    assert handler.model.grid.height == 6


def test_bind_kwargs_uses_static_defaults_before_dynamic_defaults():
    @bind_kwargs()
    class ConfiguredModel:
        def __init__(self, count: int, rate: int, label: str = "static"):
            self.count = count
            self.rate = rate
            self.label = label

    ConfiguredModel(7, rate=9, label="dynamic")

    bindings = {binding.name: binding for binding in get_bind_kwargs(ConfiguredModel)}

    assert bindings["count"].default == 7
    assert bindings["rate"].default == 9
    assert bindings["label"].default == "static"


def test_bind_kwargs_honors_include_exclude_and_rejects_multiple_configs():
    @bind_kwargs(include=["width", "height"], exclude=["height"])
    class ConfiguredModel:
        def __init__(self, width: int = 5, height: int = 4, seed: int = 1):
            self.width = width
            self.height = height
            self.seed = seed

    bindings = [binding.name for binding in get_bind_kwargs(ConfiguredModel)]

    assert bindings == ["width"]
    with pytest.raises(ValueError):
        bind_kwargs()(ConfiguredModel)


def test_bound_model_reinitializer_registers_constructor_kwargs():
    class Model:
        def __init__(self, width: int = 5, agent_count: int = 2):
            self.width = width
            self.agent_count_seen = agent_count

    model = Model(width=8, agent_count=3)
    reinitializer = BoundModelReinitializer(
        model,
        init_kwargs={"width": 8, "agent_count": 3},
    )
    scenario = SimulationScenario()

    model_changes = scenario.add_parameters(model)
    kwarg_changes = scenario.add_parameters(reinitializer)

    assert "width" in model_changes["parameters"]
    assert kwarg_changes == {"parameters": ["width", "agent_count"]}

    scenario.set_parameter("width", 9)
    scenario.set_parameter("agent_count", 4)
    reinitializer.reinitialize_model()

    assert model.width == 9
    assert model.agent_count_seen == 4


def test_bound_model_reinitializer_supports_add_all_and_default_registration():
    class Model:
        def __init__(self, width: int, agent_count: int):
            self.width = width
            self._agent_count_seen = agent_count

    model = Model(width=8, agent_count=3)
    reinitializer = BoundModelReinitializer(
        model,
        init_kwargs={"width": 8, "agent_count": 3},
    )
    scenario = SimulationScenario()

    dry_run = scenario.add_all(reinitializer, dry_run=True)
    registered = reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)

    assert dry_run == {
        "environments": [],
        "layers": [],
        "parameters": [],
        "actions": [],
        "charts": [],
    }
    assert registered["parameters"] == ["width", "agent_count"]

    scenario.set_parameter("width", 10)
    scenario.set_parameter("agent_count", 5)
    reinitializer.reinitialize_model()

    assert model.width == 10
    assert model._agent_count_seen == 5


def test_bound_model_reinitializer_keeps_conflicting_kwargs_registered_by_model():
    @binding_api.params(include=["width", "height"])
    class Model:
        def __init__(self, width: int = 8, height: int = 6, agent_count: int = 3):
            self.width = width
            self.height = height
            self._agent_count_seen = agent_count

    model = Model()
    reinitializer = BoundModelReinitializer(model)
    scenario = SimulationScenario()

    registered = reinitializer.register_model(scenario)

    assert set(registered["parameters"]) == {"width", "height", "agent_count"}
    assert set(scenario.parameters) == {"width", "height", "agent_count"}

    scenario.set_parameter("width", 11)
    scenario.set_parameter("height", 7)
    scenario.set_parameter("agent_count", 4)
    reinitializer.reinitialize_model()

    assert model.width == 11
    assert model.height == 7
    assert model._agent_count_seen == 4


def test_bind_datacollector_injects_charts_after_model_init_without_handler_magic():
    model = DataCollectorModel()

    charts = binding_api.charts(model)

    assert [chart.id for _, _, chart in charts] == ["temperature"]
    _, getter, chart = charts[0]
    assert chart.data_list is not None
    assert chart.data_list[0].id == "temperature"
    assert getter() == 22


@pytest.mark.asyncio
async def test_mesa_handler_reset_uses_explicit_reset_hook_when_provided():
    scenario = SimulationScenario()

    async def on_model_reset(model: FakeMesaModel) -> None:
        model.temperature = 7

    handler = MesaSimulationHandler(
        model_class=FakeMesaModel,
        on_model_reset=on_model_reset,
    )

    await scenario.register_handler(handler)

    assert handler.model is not None
    handler.model.temperature = 99

    await handler.on_reset()

    assert handler.model is not None
    assert handler.model.temperature == 7


@pytest.mark.skipif(mesa is None, reason="mesa is not installed")
@pytest.mark.asyncio
async def test_mesa_handler_reset_does_not_replay_mesa_time():
    assert mesa is not None
    CountingMesaModel.step_calls = 0
    scenario = SimulationScenario()
    handler = MesaSimulationHandler(model_class=CountingMesaModel)

    await scenario.register_handler(handler)

    assert "time" not in scenario.parameters
    assert handler.model is not None
    for _ in range(5):
        await handler._model_step_impl()
    assert CountingMesaModel.step_calls == 5
    if hasattr(handler.model, "time"):
        assert handler.model.time == 5

    await handler.on_reset()

    assert handler.model is not None
    if hasattr(handler.model, "time"):
        assert handler.model.time == 0
    await handler._model_step_impl()
    assert CountingMesaModel.step_calls == 6
    if hasattr(handler.model, "time"):
        assert handler.model.time == 1
