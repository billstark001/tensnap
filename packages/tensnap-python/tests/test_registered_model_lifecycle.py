"""Lifecycle transactions and ownership of constructor-backed controls."""

import importlib
import random
from unittest.mock import AsyncMock

import pytest

from tensnap import BoundModelReinitializer, SimulationScenario, bind_kwargs
from tensnap.bindings.basic.restore import encode_checkpoint
from tensnap.models import NumberParameter
from tensnap.utils.init_hook import install_once_init_hook


def tuples(value):
    return tuple(tuples(item) for item in value) if isinstance(value, list) else value


@bind_kwargs()
class Model:
    def __init__(self, width=5, seed=7):
        self.width = width
        self.seed = seed
        self.tick = 0
        self.value = 0
        self.rng = random.Random(seed)

    def step(self):
        self.tick += 1
        self.value = self.rng.randrange(1_000_000)

    def capture(self):
        return {
            "width": self.width,
            "seed": self.seed,
            "tick": self.tick,
            "value": self.value,
            "rng": self.rng.getstate(),
        }

    def restore(self, saved):
        if saved.get("bad"):
            raise ValueError("invalid model checkpoint")
        self.__init__(saved["width"], saved["seed"])
        self.tick, self.value = saved["tick"], saved["value"]
        self.rng.setstate(tuples(saved["rng"]))


async def registered():
    model = Model()
    scenario = SimulationScenario(
        checkpoint_capture=model.capture,
        checkpoint_restore=model.restore,
    )
    scenario.server.send = AsyncMock()

    def projected(payload):
        for change in payload.get("parameters", []):
            scenario.set_parameter(change["id"], change["value"])

    scenario.configure_scene_restore(
        projected,
        checkpoint_capture=model.capture,
        checkpoint_restore=model.restore,
    )
    await scenario.register_model(model, model_time=lambda: model.tick)
    return scenario, model


async def capture(scenario):
    await scenario._on_scene_capture(None, {"request_id": "capture"})
    return dict(scenario.server.send.call_args.args[2])


async def restore(scenario, checkpoint, request_id="restore", **projection):
    await scenario._on_scene_restore(
        None,
        {
            **checkpoint,
            **projection,
            "model_id": scenario.model_id,
            "request_id": request_id,
        },
    )
    return scenario._scene_restore_results[request_id]


@pytest.mark.asyncio
@pytest.mark.parametrize("use_msgpack", [False, True])
async def test_checkpoint_keeps_model_data_and_replays_active_rng(
    use_msgpack,
):
    scenario, model = await registered()
    scenario.server.use_msgpack = use_msgpack
    await scenario._advance_step()
    scenario.set_parameter("width", 8)
    scenario.set_parameter("seed", 42)
    saved = await capture(scenario)
    assert saved["checkpoint"] == encode_checkpoint(
        model.capture(), use_msgpack=use_msgpack
    )
    await scenario._advance_step()
    expected = model.capture()
    scenario.set_parameter("width", 9)
    scenario.set_parameter("seed", 99)
    assert (await restore(scenario, saved))["status"] == "ok"
    assert scenario.dump_parameters() == {"width": 5, "seed": 7}
    assert (model.width, model.seed) == (5, 7)
    await scenario._advance_step()
    assert model.capture() == expected
    await scenario.reset()
    assert (model.width, model.seed) == (5, 7)


@pytest.mark.asyncio
@pytest.mark.parametrize("use_msgpack", [False, True])
async def test_scene_parameters_explicitly_restore_pending_constructor_values(
    use_msgpack,
):
    scenario, model = await registered()
    scenario.server.use_msgpack = use_msgpack
    scenario.set_parameter("width", 8)
    scenario.set_parameter("seed", 42)
    saved = await capture(scenario)
    parameters = [
        {"id": name, "value": value}
        for name, value in scenario.dump_parameters().items()
    ]
    scenario.set_parameter("width", 9)
    scenario.set_parameter("seed", 99)
    await scenario.reset()
    assert (await restore(scenario, saved, parameters=parameters))["status"] == "ok"
    assert (model.width, model.seed) == (5, 7)
    assert scenario.dump_parameters() == {"width": 8, "seed": 42}
    await scenario.reset()
    assert (model.width, model.seed) == (8, 42)


@pytest.mark.asyncio
async def test_projection_after_checkpoint_can_override_pending_constructor_values():
    scenario, _ = await registered()
    saved = await capture(scenario)
    assert (await restore(scenario, saved, parameters=[{"id": "width", "value": 12}]))[
        "status"
    ] == "ok"
    assert scenario.get_parameter("width") == 12
    await scenario.reset()
    assert scenario._registered_model.width == 12


@pytest.mark.asyncio
async def test_model_checkpoint_is_independent_of_constructor_control_inventory():
    source, original = await registered()
    await source._advance_step()
    saved = await capture(source)
    expected = original.capture()

    model = Model(width=9, seed=99)
    scenario = SimulationScenario(
        checkpoint_capture=model.capture,
        checkpoint_restore=model.restore,
    )
    scenario.server.send = AsyncMock()
    await scenario.register_model(
        model,
        reinitializer=BoundModelReinitializer(model, kwarg_bindings=[]),
        model_time=lambda: model.tick,
    )
    assert (await restore(scenario, saved))["status"] == "ok"
    assert model.capture() == expected
    assert scenario.parameters == {}


@pytest.mark.asyncio
async def test_failed_restore_preserves_pending_values_clock_and_initialization():
    scenario, model = await registered()
    scenario.set_parameter("width", 11)
    scenario.set_parameter("seed", 42)
    before = model.capture()
    invalid = {"checkpoint": encode_checkpoint({"bad": True}, use_msgpack=False)}
    assert (await restore(scenario, invalid))["status"] == "failed"
    assert model.capture() == before
    assert scenario.dump_parameters() == {"width": 11, "seed": 42}
    assert not scenario._initialized and scenario._time_step == 0


@pytest.mark.asyncio
async def test_failed_projection_after_checkpoint_rolls_back_live_and_staged_state():
    scenario, model = await registered()
    saved = await capture(scenario)
    await scenario._advance_step()
    scenario.set_parameter("width", 11)
    scenario.set_parameter("seed", 42)
    before = model.capture()
    projected = scenario._scene_restore

    def fail_after_apply(payload):
        projected(payload)
        raise ValueError("projection failed after parameter mutation")

    scenario.configure_scene_restore(
        fail_after_apply,
        checkpoint_capture=model.capture,
        checkpoint_restore=model.restore,
    )
    result = await restore(scenario, saved, parameters=[{"id": "width", "value": 12}])
    assert result["status"] == "failed"
    assert model.capture() == before
    assert scenario.dump_parameters() == {"width": 11, "seed": 42}
    assert scenario._initialized and scenario._time_step == 1


def test_removed_reinitializer_lifecycle_apis_have_no_forwarding_aliases():
    strategy = BoundModelReinitializer(Model())
    for name in (
        "register_model",
        "configure_reinit",
        "reinitialize",
        "model_init",
        "model_reset",
        "parameter_values",
        "restore_parameter_values",
    ):
        assert not hasattr(strategy, name)
    for name in (
        "tensnap.bindings.lifecycle",
        "tensnap.bindings.mesa",
        "tensnap.bindings.mesa.model_reinit",
    ):
        assert not hasattr(
            importlib.import_module(name), "reinitialize_registered_model"
        )


@pytest.mark.asyncio
async def test_failed_registration_can_be_retried_without_inventory_or_handlers():
    model = Model()
    scenario = SimulationScenario()

    async def fail(_):
        raise ValueError("observer failed")

    with pytest.raises(ValueError, match="observer failed"):
        await scenario.register_model(model, observe=fail)
    assert not scenario._handlers and not scenario.parameters
    assert scenario._registered_model is None
    await scenario.register_model(model)
    assert len(scenario._handlers) == 1


@pytest.mark.asyncio
async def test_registration_cannot_take_over_an_unrelated_parameter():
    scenario = SimulationScenario()
    scenario.add_parameters({"width": 37})
    with pytest.raises(ValueError, match="already registered"):
        await scenario.register_model(Model())
    assert scenario.dump_parameters() == {"width": 37}
    assert not scenario._handlers


def test_constructor_names_do_not_overwrite_strategy_attributes():
    @bind_kwargs()
    class NamedModel:
        def __init__(self, model=3, current_kwargs=4, init_args=5):
            self.received = (model, current_kwargs, init_args)

    model = NamedModel()
    strategy = BoundModelReinitializer(model)
    strategy.reinitialize_model()
    assert model.received == (3, 4, 5)
    assert strategy.model is model


@pytest.mark.asyncio
async def test_required_constructor_values_belong_to_the_constructed_instance():
    @bind_kwargs()
    class RequiredModel:
        def __init__(self, count):
            self._count_seen = count

    first = RequiredModel(3)
    second = RequiredModel(9)
    scenario = SimulationScenario()
    await scenario.register_model(first)
    assert scenario.get_parameter("count") == 3
    await scenario.reset()
    assert first._count_seen == 3
    second_strategy = BoundModelReinitializer(second)
    assert second_strategy.current_kwargs() == {"count": 9}
    second_strategy.reinitialize_model()
    assert second._count_seen == 9


@pytest.mark.asyncio
async def test_native_model_time_is_the_published_step_time():
    class ClockModel:
        def __init__(self):
            self.tick = 0

        def step(self):
            self.tick += 2

    model = ClockModel()
    scenario = SimulationScenario()
    scenario.server.broadcast_metadata_update = AsyncMock()
    await scenario.register_model(model, model_time=lambda: model.tick)
    await scenario._advance_step()
    assert scenario._time_step == 2
    assert scenario.server.broadcast_metadata_update.call_args.args == ({"time": 2},)


@pytest.mark.asyncio
async def test_async_callable_observer_is_awaited_and_lifecycle_apis_cannot_be_mixed():
    class Observer:
        def __init__(self):
            self.ticks = []

        async def __call__(self, model):
            self.ticks.append(model.tick)

    model = Model()
    observer = Observer()
    scenario = SimulationScenario()
    await scenario.register_model(model, observe=observer)
    await scenario._advance_step()
    assert observer.ticks == [0, 0, 1]
    with pytest.raises(ValueError, match="already registered"):
        await scenario.register_model_handler(model_step=model.step)
    assert len(scenario._handlers) == 1


@pytest.mark.asyncio
async def test_constructor_failure_keeps_controls_available_for_retry():
    @bind_kwargs()
    class RejectingModel:
        def __init__(self, width=5):
            if width < 1:
                raise ValueError("width must be positive")
            self.width = width

    model = RejectingModel()
    scenario = SimulationScenario()
    await scenario.register_model(model)
    scenario.set_parameter("width", 0)
    with pytest.raises(ValueError, match="positive"):
        await scenario.reset()
    assert scenario.get_parameter("width") == 0
    scenario.set_parameter("width", 8)
    await scenario.reset()
    assert model.width == 8
    assert len(scenario._handlers) == 1


def test_dynamic_constructor_controls_are_isolated_between_instances():
    @bind_kwargs()
    class DynamicModel:
        def __init__(self, **kwargs):
            pass

    first = DynamicModel(width=3)
    second = DynamicModel(height=9)
    strategy = BoundModelReinitializer(first)
    assert strategy.current_kwargs() == {"width": 3}
    assert BoundModelReinitializer(second).current_kwargs() == {"height": 9}


@pytest.mark.parametrize("bind_first", [False, True])
@pytest.mark.parametrize("timing", ["before", "after"])
def test_per_instance_capture_preserves_other_binding_init_hooks(bind_first, timing):
    class Model:
        def __init__(self, count):
            self.seen = count

    once_calls = []
    if bind_first:
        bind_kwargs()(Model)
    handle = install_once_init_hook(
        Model,
        lambda instance, args, kwargs: once_calls.append(args),
        timing=timing,
    )
    if not bind_first:
        bind_kwargs()(Model)
    first, second = Model(3), Model(9)
    assert once_calls == [(3,)]
    assert not handle.active
    assert BoundModelReinitializer(first).current_kwargs() == {"count": 3}
    assert BoundModelReinitializer(second).current_kwargs() == {"count": 9}


@pytest.mark.asyncio
async def test_parameter_provider_owns_constructor_values_without_matching_attributes():
    @bind_kwargs()
    class Provider:
        def __init__(self, width=5):
            self._value = width

        def __tensnap_parameter_metadata__(self, *configs):
            return [
                (
                    "width",
                    NumberParameter(
                        "gridWidth",
                        getter=lambda: self._value,
                        setter=lambda value: setattr(self, "_value", value),
                    ),
                )
            ]

    model = Provider()
    scenario = SimulationScenario()
    await scenario.register_model(model)
    assert set(scenario.parameters) == {"gridWidth"}
    scenario.set_parameter("gridWidth", 8)
    assert model._value == scenario.get_parameter("gridWidth") == 8
    await scenario.reset()
    assert model._value == 8
