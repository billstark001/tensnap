import pytest

from tensnap import SimulationScenario
from tensnap.bindings.mesa import MesaSimulationHandler

try:
    import mesa
except ImportError:  # pragma: no cover - optional dev dependency
    mesa = None


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


if mesa is not None:

    class CountingMesaModel(mesa.Model):  # type: ignore[misc]
        step_calls = 0

        def __init__(self):
            super().__init__()
            self.grid = mesa.space.SingleGrid(1, 1, torus=True)

        def step(self) -> None:
            type(self).step_calls += 1


@pytest.mark.asyncio
async def test_mesa_handler_reset_replays_model_and_runtime_parameters():
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
    assert handler.model.temperature == 42


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
    assert handler.model.time == 5

    await handler.on_reset()

    assert handler.model is not None
    assert handler.model.time == 0
    await handler._model_step_impl()
    assert CountingMesaModel.step_calls == 6
    assert handler.model.time == 1
