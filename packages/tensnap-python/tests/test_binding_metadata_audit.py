"""Issue #38/#41/#42 reproductions supplied by the binding metadata audit."""

from threading import Lock
from types import ModuleType
from typing import Annotated

import pytest

from tensnap import (
    BindParameterConfig,
    EnumParameter,
    NumberParameter,
    SimulationScenario,
    bind_kwargs,
    chart,
    get_bind_kwargs,
    monitor,
    params,
)
from tensnap.bindings import parameters


@pytest.mark.parametrize(
    "surface", ["dict", "module", "class", "instance", "property", "kwargs"]
)
def test_custom_enum_overrides_scalar_inference(surface):
    cfg = params(
        include=["mode"],
        custom_bindings={
            "mode": EnumParameter(
                "modeChoice",
                label="Decision backend",
                options=["a", "b"],
                allow_runtime_change=False,
            )
        },
    )
    if surface == "dict":
        discovered = parameters({"mode": "a"}, cfg)
    elif surface == "module":
        target = ModuleType("fixture")
        target.mode = "a"
        discovered = parameters(target, cfg)
    elif surface == "kwargs":

        @bind_kwargs(custom_bindings=cfg.custom_bindings)
        class Constructor:
            def __init__(self, mode: str = "a"):
                self.mode = mode

        discovered = [
            (binding.name, binding.parameter)
            for binding in get_bind_kwargs(Constructor)
        ]
    else:

        @cfg
        class Model:
            pass

        if surface == "class":
            Model.mode = "a"
        elif surface == "property":
            Model.mode = property(lambda self: "a")
        target = Model()
        if surface == "instance":
            target.mode = "a"
        discovered = parameters(target)
    assert discovered[0][1].type == "enum"
    assert discovered[0][1].id == "modeChoice"
    assert discovered[0][1].label == "Decision backend"
    assert discovered[0][1].value == "a"
    assert discovered[0][1].options == ["a", "b"]
    assert discovered[0][1].allow_runtime_change is False


def test_stacked_custom_bindings_do_not_reintroduce_type_keyword():
    low = params(custom_bindings={"speed": NumberParameter("", max=10)})
    high = params(custom_bindings={"speed": NumberParameter("", max=20)})
    found = parameters({"speed": 1}, low, high)
    assert len(found) == 1
    assert found[0][1].max == 20


def test_annotated_class_default_has_one_explicit_declaration():
    @params(include=["mode"])
    class Model:
        mode: Annotated[
            str, BindParameterConfig("enum", id="modeChoice", options=["a", "b"])
        ] = "a"

    scenario = SimulationScenario()
    scenario.add_all(Model())
    assert list(scenario.parameters) == ["modeChoice"]
    assert scenario.parameters["modeChoice"].type == "enum"


def test_init_annotated_metadata_survives_a_class_scalar_default():
    @params(include=["mode"])
    class Model:
        mode = "a"

        def __init__(
            self,
            mode: Annotated[
                str, BindParameterConfig("enum", id="modeChoice", options=["a", "b"])
            ] = "a",
        ):
            self.mode = mode

    found = parameters(Model())
    assert [(name, value.id, value.type) for name, value in found] == [
        ("mode", "modeChoice", "enum")
    ]


@pytest.mark.parametrize("surface", ["class", "instance"])
def test_decorator_include_private_overrides_default_filter(surface):
    @params(include=["_count"], include_private=True)
    class Model:
        pass

    if surface == "class":
        Model._count = 2
    target = Model()
    if surface == "instance":
        target._count = 2
    assert [name for name, _ in parameters(target)] == ["_count"]
    scenario = SimulationScenario()
    scenario.add_all(target)
    assert scenario.get_parameter("_count") == 2


def test_custom_bound_accessors_keep_the_original_owner():
    class Model:
        def __init__(self):
            self.count = 2

        def get_count(self):
            return self.count

        def set_count(self, value):
            self.count = value

    model = Model()
    params(
        include=["count"],
        custom_bindings={
            "count": NumberParameter("", getter=model.get_count, setter=model.set_count)
        },
    )(Model)
    scenario = SimulationScenario()
    scenario.add_all(model)
    scenario.set_parameter("count", 9)
    assert model.count == 9
    assert scenario.get_parameter("count") == 9
    assert scenario.parameters["count"].getter.__self__ is model
    assert scenario.parameters["count"].setter.__self__ is model


def test_parameter_serialization_omits_callbacks_without_copying_their_owner():
    class Model:
        def __init__(self):
            self.lock = Lock()

        def get_count(self):
            return 2

    parameter = NumberParameter("count", getter=Model().get_count)
    metadata = parameter.to_dict()
    assert "getter" not in metadata


def test_property_monitor_is_not_also_discovered_as_an_editable_parameter():
    @params()
    class Model:
        @monitor("count")
        @property
        def count(self):
            return 3

    scenario = SimulationScenario()
    scenario.add_all(Model())
    assert "count" in scenario.monitors
    assert "count" not in scenario.parameters


def test_chart_property_already_has_the_corresponding_exclusion():
    @params()
    class Model:
        @chart("count")
        @property
        def count(self):
            return 3

    assert parameters(Model()) == []


def test_suggested_include_private_is_a_working_control():
    class Model:
        _count = 2

    assert [name for name, _ in parameters(Model(), params(include_private=True))] == [
        "_count"
    ]


def test_custom_closure_accessors_are_a_working_control():
    state = {"count": 2}
    cfg = params(
        custom_bindings={
            "count": NumberParameter(
                "",
                getter=lambda: state["count"],
                setter=lambda value: state.update(count=value),
            )
        }
    )
    scenario = SimulationScenario()
    scenario.add_parameters(state, cfg)
    scenario.set_parameter("count", 9)
    assert scenario.get_parameter("count") == state["count"] == 9
