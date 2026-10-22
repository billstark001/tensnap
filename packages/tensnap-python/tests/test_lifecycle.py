import importlib
from typing import Annotated

import pytest

import tensnap.bindings as binding_api
from mesa import Agent, Model
from tensnap import SimulationScenario
from tensnap.bindings.mesa import prepare_mesa_model_reinit
from tensnap.bindings.lifecycle import (
    BoundModelReinitializer,
    KwargBinding,
    bind_kwargs,
    default_cleanup_for_model,
    get_bind_kwargs,
)
from tensnap.models import NumberParameter, create_parameter


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


def test_bind_kwargs_uses_annotated_param_metadata():
    @bind_kwargs(include=["threshold"])
    class ConfiguredModel:
        def __init__(
            self,
            threshold: Annotated[
                float,
                binding_api.param(
                    "number",
                    label="Threshold",
                    min=0.0,
                    max=1.0,
                    step=0.05,
                ),
            ] = 0.7,
        ):
            self.threshold = threshold

    bindings = {binding.name: binding for binding in get_bind_kwargs(ConfiguredModel)}
    threshold = bindings["threshold"].parameter

    assert isinstance(threshold, NumberParameter)
    assert threshold.label == "Threshold"
    assert threshold.value == 0.7
    assert threshold.min == 0.0
    assert threshold.max == 1.0
    assert threshold.step == 0.05


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


@pytest.mark.asyncio
async def test_bound_model_reinitializer_supports_add_all_and_default_registration():
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
    await scenario.register_model(model, reinitializer=reinitializer)

    assert dry_run == {
        "environments": [],
        "layers": [],
        "parameters": [],
        "actions": [],
        "charts": [],
    }
    assert set(scenario.parameters) == {"width", "agent_count"}

    scenario.set_parameter("width", 10)
    scenario.set_parameter("agent_count", 5)
    reinitializer.reinitialize_model()

    assert model.width == 10
    assert model._agent_count_seen == 5


@pytest.mark.asyncio
async def test_bound_model_reinitializer_keeps_conflicting_kwargs_registered_by_model():
    @binding_api.params(include=["width", "height"])
    class Model:
        def __init__(self, width: int = 8, height: int = 6, agent_count: int = 3):
            self.width = width
            self.height = height
            self._agent_count_seen = agent_count

    model = Model()
    reinitializer = BoundModelReinitializer(model)
    scenario = SimulationScenario()

    await scenario.register_model(model, reinitializer=reinitializer)

    assert set(scenario.parameters) == {"width", "height", "agent_count"}

    scenario.set_parameter("width", 11)
    scenario.set_parameter("height", 7)
    scenario.set_parameter("agent_count", 4)
    reinitializer.reinitialize_model()

    assert model.width == 11
    assert model.height == 7
    assert model._agent_count_seen == 4


@pytest.mark.asyncio
async def test_bound_model_reinitializer_uses_same_source_custom_parameter_ids():
    @binding_api.params(include=["width", "height"])
    class Model:
        def __init__(self, width: int = 8, height: int = 6):
            self._width = width
            self.height = height

        @binding_api.BindParameterConfig("number", id="gridWidth")
        def width(self):
            return self._width

    model = Model()
    reinitializer = BoundModelReinitializer(model)
    scenario = SimulationScenario()

    await scenario.register_model(model, reinitializer=reinitializer)

    assert set(scenario.parameters) == {"gridWidth", "height"}

    model._width = 11
    scenario.set_parameter("height", 7)
    reinitializer.reinitialize_model()

    assert model._width == 11
    assert model.height == 7


@pytest.mark.asyncio
async def test_bound_model_reinitializer_rejects_parameter_id_conflicts_by_default():
    @binding_api.params(include=["width"])
    class Model:
        def __init__(self, width: int = 8, height: int = 6):
            self._width = width
            self.height = height

        @binding_api.BindParameterConfig("number", id="gridWidth")
        def width(self):
            return self._width

    with pytest.raises(ValueError, match="parameter id conflict"):
        reinitializer = BoundModelReinitializer(
            Model(),
            kwarg_bindings=[
                KwargBinding(
                    name="height",
                    default=6,
                    required=False,
                    annotation=int,
                    parameter=create_parameter(id="gridWidth", type="number", value=6),
                )
            ],
        )


def test_default_cleanup_for_model_handles_mesa_models_in_lifecycle():
    class SimpleMesaModel(Model):
        def step(self) -> None:
            return None

    model = SimpleMesaModel()
    model.step = lambda: None

    cleanup = default_cleanup_for_model(model)

    assert cleanup is not None
    assert "step" in vars(model)

    cleanup()

    assert "step" not in vars(model)
    assert default_cleanup_for_model(object()) is None


def test_mesa_reinitialization_repeats_agent_ids_and_preserves_other_models():
    class OtherAgent(Agent):
        pass

    class PopulationModel(Model):
        def __init__(self):
            super().__init__(rng=7)
            for _ in range(3):
                Agent(self)
                OtherAgent(self)

    model, other = PopulationModel(), PopulationModel()
    initial_ids = [agent.unique_id for agent in model.agents]
    other_ids = [agent.unique_id for agent in other.agents]
    reinitializer = BoundModelReinitializer(model)
    for _ in range(2):
        Agent(model)
        reinitializer.reinitialize_model()
        assert [agent.unique_id for agent in model.agents] == initial_ids
        assert all(agent.model is model for agent in model.agents)
        assert [agent.unique_id for agent in other.agents] == other_ids

    assert OtherAgent(model).unique_id == max(initial_ids) + 1
    assert OtherAgent(other).unique_id == max(other_ids) + 1


def test_mesa_preparation_is_noop_without_instance_bookkeeping():
    model = object.__new__(Model)
    assert vars(model) == {}
    prepare_mesa_model_reinit(model)
    prepare_mesa_model_reinit(model)
    assert vars(model) == {}


def test_mesa_preparation_rejects_unrelated_objects_before_mutation():
    class UnrelatedModel:
        def __init__(self):
            self.step = lambda: None

    model = UnrelatedModel()
    step = model.step
    with pytest.raises(TypeError, match="mesa.Model instance"):
        prepare_mesa_model_reinit(model)
    assert model.step is step


def test_mesa_preparation_leaves_modern_id_allocation_untouched():
    if isinstance(getattr(Agent, "_ids", None), dict):
        pytest.skip("Mesa before 3.5 uses the legacy class-level ID allocator")
    model = Model(rng=7)
    first_id = Agent(model).unique_id
    prepare_mesa_model_reinit(model)
    prepare_mesa_model_reinit(model)
    assert Agent(model).unique_id == first_id + 1


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit_none", [False, True], ids=["omitted", "none"])
async def test_bound_model_reinitializer_auto_generates_default_cleanup_for_mesa_models(
    explicit_none: bool,
):
    class CountingMesaModel(Model):
        step_calls = 0

        def __init__(self) -> None:
            super().__init__()

        def step(self) -> None:
            type(self).step_calls += 1

    CountingMesaModel.step_calls = 0
    model = CountingMesaModel()
    reinitializer = BoundModelReinitializer(model)
    scenario = SimulationScenario()

    if explicit_none:
        reinitializer = BoundModelReinitializer(model, cleanup=None)
    await scenario.register_model(model, reinitializer=reinitializer)

    for _ in range(5):
        model.step()

    assert CountingMesaModel.step_calls == 5
    if hasattr(model, "time"):
        assert model.time == 5

    await scenario.reset()

    if hasattr(model, "time"):
        assert model.time == 0

    model.step()

    assert CountingMesaModel.step_calls == 6
    if hasattr(model, "time"):
        assert model.time == 1


@pytest.mark.asyncio
async def test_scenario_owns_registration_reset_and_optional_observation():
    @bind_kwargs(exclude=["collect_data"])
    @binding_api.params(include=["seed"])
    class Model:
        def __init__(self, seed: int = 7, collect_data: bool = True):
            self.seed = seed
            self.collect_data = collect_data
            self.tick = 0

        def step(self):
            self.tick += 1

    model = Model(collect_data=False)
    strategy = BoundModelReinitializer(model, init_kwargs={"collect_data": False})
    scenario = SimulationScenario()
    observations = []
    rebuilt = []

    async def observe(current):
        observations.append((current.seed, current.tick, current.collect_data))

    await scenario.register_model(
        model,
        reinitializer=strategy,
        model_time=lambda: model.tick,
        observe=observe,
        after_reinitialize=lambda: rebuilt.append(model.seed),
    )
    assert set(scenario.parameters) == {"seed"}
    assert observations == [(7, 0, False)]
    await scenario._advance_step()
    assert observations == [(7, 0, False), (7, 0, False), (7, 1, False)]
    scenario.set_parameter("seed", 42)
    await scenario.reset()
    assert observations[-1] == (42, 0, False)
    assert rebuilt == [7, 42]
    assert len(scenario._handlers) == 1


@pytest.mark.asyncio
async def test_scenario_rejects_duplicate_and_mismatched_model_registration():
    class Model:
        def step(self):
            pass

    scenario = SimulationScenario()
    model = Model()
    with pytest.raises(ValueError, match="must own"):
        await scenario.register_model(
            model, reinitializer=BoundModelReinitializer(Model())
        )
    assert not scenario._handlers
    await scenario.register_model(model)
    with pytest.raises(ValueError, match="already registered"):
        await scenario.register_model(model)
    assert len(scenario._handlers) == 1


def test_reinitializer_preserves_positional_construction_without_duplicate_kwargs():
    class Model:
        def __init__(self, resource, count: int = 2):
            self.resource = resource
            self.count = count

    resource = object()
    model = Model(resource, count=3)
    strategy = BoundModelReinitializer(model, init_args=(resource,))
    assert strategy.current_kwargs() == {"count": 3}
    strategy.reinitialize_model()
    assert model.resource is resource and model.count == 3


def test_old_mesa_package_lifecycle_exports_warn_and_point_to_new_path():
    mesa_bindings = importlib.import_module("tensnap.bindings.mesa")

    with pytest.warns(
        DeprecationWarning,
        match="import BoundModelReinitializer from tensnap.bindings.lifecycle",
    ):
        assert mesa_bindings.BoundModelReinitializer is BoundModelReinitializer

    with pytest.warns(
        DeprecationWarning, match="import bind_kwargs from tensnap.bindings.lifecycle"
    ):
        assert mesa_bindings.bind_kwargs is bind_kwargs

    with pytest.warns(
        DeprecationWarning,
        match="import default_cleanup_for_model from tensnap.bindings.lifecycle",
    ):
        assert mesa_bindings.default_cleanup_for_model is default_cleanup_for_model


def test_old_mesa_model_reinit_exports_warn_and_point_to_new_path():
    model_reinit = importlib.import_module("tensnap.bindings.mesa.model_reinit")

    with pytest.warns(
        DeprecationWarning,
        match="import get_bind_kwargs from tensnap.bindings.lifecycle",
    ):
        assert model_reinit.get_bind_kwargs is get_bind_kwargs

    with pytest.warns(
        DeprecationWarning,
        match="import default_cleanup_for_model from tensnap.bindings.lifecycle",
    ):
        assert model_reinit.default_cleanup_for_model is default_cleanup_for_model
