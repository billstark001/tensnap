import importlib

import pytest

import tensnap.bindings as binding_api
from mesa import Model
from tensnap import SimulationScenario
from tensnap.bindings.lifecycle import (
    BoundModelReinitializer,
    KwargBinding,
    bind_kwargs,
    default_cleanup_for_model,
    get_bind_kwargs,
)
from tensnap.models import create_parameter


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


def test_bound_model_reinitializer_aliases_same_source_custom_parameter_ids():
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

    registered = reinitializer.register_model(scenario)

    assert set(registered["parameters"]) == {"gridWidth", "height"}
    assert set(scenario.parameters) == {"gridWidth", "height"}

    model._width = 11
    scenario.set_parameter("height", 7)
    reinitializer.reinitialize_model()

    assert model._width == 11
    assert model.height == 7


def test_bound_model_reinitializer_rejects_parameter_id_conflicts_by_default():
    @binding_api.params(include=["width"])
    class Model:
        def __init__(self, width: int = 8, height: int = 6):
            self._width = width
            self.height = height

        @binding_api.BindParameterConfig("number", id="gridWidth")
        def width(self):
            return self._width

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

    with pytest.raises(ValueError, match="parameter id conflict"):
        reinitializer.register_model(SimulationScenario())


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

    reinitializer.register_model(scenario)
    if explicit_none:
        reinitializer.configure_reinit(scenario, cleanup=None)
    else:
        reinitializer.configure_reinit(scenario)

    for _ in range(5):
        model.step()

    assert CountingMesaModel.step_calls == 5
    if hasattr(model, "time"):
        assert model.time == 5

    await reinitializer.model_reset()

    if hasattr(model, "time"):
        assert model.time == 0

    model.step()

    assert CountingMesaModel.step_calls == 6
    if hasattr(model, "time"):
        assert model.time == 1


def test_old_mesa_package_lifecycle_exports_warn_and_point_to_new_path():
    mesa_bindings = importlib.import_module("tensnap.bindings.mesa")

    with pytest.warns(
        DeprecationWarning, match="import BoundModelReinitializer from tensnap.bindings.lifecycle"
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
        DeprecationWarning, match="import get_bind_kwargs from tensnap.bindings.lifecycle"
    ):
        assert model_reinit.get_bind_kwargs is get_bind_kwargs

    with pytest.warns(
        DeprecationWarning,
        match="import default_cleanup_for_model from tensnap.bindings.lifecycle",
    ):
        assert model_reinit.default_cleanup_for_model is default_cleanup_for_model
