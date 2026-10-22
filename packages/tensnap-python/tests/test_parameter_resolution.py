"""Public parameter discovery, ownership, and lifecycle contracts."""

from dataclasses import dataclass
from functools import wraps
from threading import Lock
from typing import Annotated
from unittest.mock import AsyncMock

import pytest
from mesa import Model as MesaModel

from tensnap import (
    BindParameterConfig,
    BindParametersConfig,
    EnumParameter,
    NumberParameter,
    SimulationScenario,
    bind_kwargs,
    get_bind_kwargs,
    monitor,
    params,
)
from tensnap.bindings import parameters
from tensnap.bindings.basic.restore import encode_checkpoint
from tensnap.server import ServerToClientMessageType as MessageType


@pytest.mark.parametrize("dataclass_model", [False, True])
def test_field_declaration_reads_current_instance_not_class_default(dataclass_model):
    class Model:
        mode: Annotated[
            str, BindParameterConfig("enum", id="choice", options=["a", "b"])
        ] = "a"

    model_type = dataclass(Model) if dataclass_model else Model
    model = model_type()
    model.mode = "b"
    found = parameters(model)
    assert [(name, p.id, p.type, p.value) for name, p in found] == [
        ("mode", "choice", "enum", "b")
    ]
    assert parameters(model_type)[0][1].value == "a"


def test_scalar_discovery_reads_the_instance_value():
    class Model:
        count = 1

    model = Model()
    model.count = 7
    assert parameters(model)[0][1].value == 7
    assert parameters(Model)[0][1].value == 1


def test_field_declaration_wins_over_constructor_annotation():
    class Model:
        mode: Annotated[
            str, BindParameterConfig("enum", id="choice", options=["a", "b"])
        ] = "a"

        def __init__(
            self, mode: Annotated[str, BindParameterConfig("string", id="input")] = "a"
        ):
            self.mode = mode

    assert [(name, p.id, p.type) for name, p in parameters(Model("b"))] == [
        ("mode", "choice", "enum")
    ]


def test_wrapped_constructor_uses_original_declarations_for_every_discovery_path():
    class Model:
        count = 1

        def __init__(
            self,
            count: Annotated[int, BindParameterConfig("number", id="population")] = 3,
        ):
            self.count = count

    original = Model.__init__

    @wraps(original)
    def wrapper(self, *args, **kwargs):
        original(self, *args, **kwargs)

    # A decorator need not copy annotations, including Python 3.14 wraps when
    # annotations were assigned directly rather than deferred by the compiler.
    wrapper.__annotations__ = {}
    Model.__init__ = wrapper
    bind_kwargs()(Model)

    assert [
        (binding.name, binding.parameter.id) for binding in get_bind_kwargs(Model)
    ] == [("count", "population")]
    model = Model(count=5)
    assert [(name, p.id, p.value) for name, p in parameters(model)] == [
        ("count", "population", 5)
    ]
    scenario = SimulationScenario()
    scenario.add_all(model)
    assert scenario.dump_parameters() == {"population": 5}
    scenario.set_parameter("population", 9)
    assert model.count == 9


def test_custom_override_applies_to_explicit_field_and_constructor_declarations():
    custom = {"mode": EnumParameter("choice", options=["a", "b"], label="Mode")}

    @params(custom_bindings=custom)
    @bind_kwargs(custom_bindings=custom)
    class Model:
        mode: Annotated[str, BindParameterConfig("string")] = "a"

        def __init__(self, mode: Annotated[str, BindParameterConfig("string")] = "a"):
            self.mode = mode

    for p in (parameters(Model())[0][1], get_bind_kwargs(Model)[0].parameter):
        assert (p.id, p.type, p.label, p.options) == (
            "choice",
            "enum",
            "Mode",
            ["a", "b"],
        )


def test_compatible_annotated_declarations_merge_only_supplied_fields():
    class Model:
        speed: Annotated[
            float,
            BindParameterConfig("number", min=5, allow_runtime_change=False),
            BindParameterConfig("number", max=20),
        ] = 7

    p = parameters(Model())[0][1]
    assert (p.min, p.max, p.allow_runtime_change) == (5, 20, False)


def test_invalid_parameter_decorator_targets_are_rejected():
    declaration = BindParameterConfig("number")
    with pytest.raises(TypeError, match="callable getter"):
        declaration(property(lambda _: 1))
    declaration(lambda _: 1)
    with pytest.raises(ValueError, match="already has a getter"):
        declaration(lambda _: 2)


@pytest.mark.parametrize("constructor", [False, True])
@pytest.mark.parametrize("conflict", ["type", "id"])
def test_ambiguous_explicit_declarations_fail_before_registration(
    constructor, conflict
):
    first = BindParameterConfig("number", id="count")
    second = (
        BindParameterConfig("enum", id="count", options=["1"])
        if conflict == "type"
        else BindParameterConfig("number", id="other")
    )

    class Model:
        count = 1

        def __init__(self, count=1):
            self.count = count

    annotation = Annotated[int, first, second]
    if constructor:
        Model.__init__.__annotations__["count"] = annotation
        bind_kwargs()(Model)
        with pytest.raises(ValueError, match=r"Ambiguous.*count"):
            get_bind_kwargs(Model)
    else:
        Model.__annotations__ = {"count": annotation}
    scenario = SimulationScenario()
    scenario.add_parameters({"existing": 2})
    with pytest.raises(ValueError, match=r"Ambiguous.*count"):
        scenario.add_parameters(Model())
    assert scenario.dump_parameters() == {"existing": 2}


@pytest.mark.parametrize("dry_run", [False, True])
def test_duplicate_ids_do_not_partially_register_a_batch(dry_run):
    cfg = params(
        custom_bindings={"one": NumberParameter("same"), "two": NumberParameter("same")}
    )
    scenario = SimulationScenario()
    scenario.add_parameters({"existing": 3})
    with pytest.raises(ValueError, match=r"id conflict.*one.*two.*same"):
        scenario.add_parameters({"one": 1, "two": 2}, cfg, dry_run=dry_run)
    assert scenario.dump_parameters() == {"existing": 3}


def test_complete_custom_definitions_include_defaults_and_replace_incompatible_types():
    low = params(
        custom_bindings={
            "speed": NumberParameter("", min=5, allow_runtime_change=False)
        }
    )
    high = params(custom_bindings={"speed": NumberParameter("", max=20)})
    p = parameters({"speed": 7}, low, high)[0][1]
    assert (p.min, p.max, p.allow_runtime_change) == (0, 20, True)
    enum = params(custom_bindings={"speed": EnumParameter("", options=["7"])})
    p = parameters({"speed": "7"}, low, enum)[0][1]
    assert p.to_dict() == {
        "id": "speed",
        "type": "enum",
        "label": "Speed",
        "allow_runtime_change": True,
        "value": "7",
        "options": ["7"],
    }


def test_class_and_outer_decorator_configs_have_priority_over_suggestions():
    @params(custom_bindings={"count": NumberParameter("", max=30)})
    @params(custom_bindings={"count": NumberParameter("", max=20)})
    class Model:
        count = 7

    suggestion = params(custom_bindings={"count": NumberParameter("", max=10)})
    assert parameters(Model(), suggestion)[0][1].max == 30


def test_private_policy_is_resolved_separately_from_field_selectors():
    @params(include_private=True)
    @params()
    class Included:
        _count = 2

    assert [name for name, _ in parameters(Included())] == ["_count"]
    assert parameters(Included(), params(include_private=False))[0][0] == "_count"

    @params(include_private=False)
    class Excluded:
        _count = 2

    assert parameters(Excluded(), params(include_private=True)) == []
    assert parameters(Included(), params(exclude=["_count"])) == []
    assert parameters({"_count": 2}) == []


def test_explicit_mesa_fields_override_builtin_discovery_exclusions():
    class Model(MesaModel):
        running: Annotated[bool, BindParameterConfig("boolean", id="active")]

    found = dict(parameters(Model()))
    assert found["running"].id == "active"
    assert "steps" not in found and "time" not in found
    assert "running" not in dict(parameters(Model(), params(exclude=["running"])))


def test_explicit_only_selects_custom_and_annotated_controls():
    class Model:
        incidental = 1
        declared: Annotated[int, BindParameterConfig("number")] = 2

    suggestion = params(custom_bindings={"incidental": NumberParameter("selected")})
    found = parameters(Model(), suggestion, BindParametersConfig.EXPLICIT_ONLY)
    assert [(name, p.id) for name, p in found] == [
        ("incidental", "selected"),
        ("declared", "declared"),
    ]
    assert parameters(Model(), params(include_explicit=False, exclude=".*")) == []


def test_binding_clones_keep_callback_identity_and_isolate_mutable_metadata():
    class Model:
        def __init__(self):
            self.lock = Lock()
            self.mode = "a"

        def get_mode(self):
            return self.mode

        def set_mode(self, value):
            self.mode = value

    model = Model()
    getter, setter = model.get_mode, model.set_mode
    template = EnumParameter(
        "choice",
        getter=getter,
        setter=setter,
        options=["a", "b"],
        labels={"a": "A"},
    )
    first, second = template.instantiate(), template.instantiate()
    assert first.getter is second.getter is getter
    assert first.setter is second.setter is setter
    first.options.append("c")
    first.labels["a"] = "changed"
    assert second.options == template.options == ["a", "b"]
    assert second.labels == template.labels == {"a": "A"}
    wire = template.to_dict()
    wire["options"].append("d")
    wire["labels"]["a"] = "wire"
    assert template.options == ["a", "b"] and template.labels == {"a": "A"}
    assert "getter" not in wire and "setter" not in wire
    assert template.instantiate(getter=None, setter=None).getter is None
    assert template.instantiate(getter=None, setter=None).setter is None

    def replacement():
        return "b"

    assert template.instantiate(getter=replacement).getter is replacement

    cfg = params(custom_bindings={"mode": template})
    scenario = SimulationScenario()
    scenario.add_parameters(model, cfg)
    assert scenario.parameters["choice"].getter is getter
    assert scenario.parameters["choice"].setter is setter
    scenario.set_parameter("choice", "b")
    assert model.mode == scenario.get_parameter("choice") == "b"
    scenario.parameters["choice"].options.append("e")
    assert parameters(model, cfg)[0][1].options == ["a", "b"]


@pytest.mark.parametrize("property_first", [False, True])
@pytest.mark.parametrize("value", [3, 1.5, True, "ok", None])
def test_monitor_roles_are_checked_without_evaluating_properties(property_first, value):
    calls = []

    def getter(self):
        calls.append(self)
        return value

    member = (
        property(monitor("status")(getter))
        if property_first
        else monitor("status")(property(getter))
    )

    @params(include=["status"])
    class Model:
        status = member

    model = Model()
    assert parameters(model) == []
    assert calls == []
    scenario = SimulationScenario()
    scenario.add_all(model)
    assert list(scenario.monitors) == ["status"] and not scenario.parameters
    assert calls == []
    assert scenario.monitors["status"][1]() == value
    assert calls == [model]


def test_inherited_monitor_and_field_declarations_keep_their_owners():
    @params(include=["count", "status"])
    class Base:
        count: Annotated[int, BindParameterConfig("number", id="population")] = 2

        @monitor("status")
        @property
        def status(self):
            return self.count

    @params(custom_bindings={"count": NumberParameter("population", max=20)})
    class Model(Base):
        count = 7

    scenario = SimulationScenario()
    model = Model()
    scenario.add_all(model)
    assert list(scenario.parameters) == ["population"]
    assert scenario.parameters["population"].max == 20
    assert scenario.monitors["status"][1]() == 7
    assert parameters(Base())[0][1].value == 2


@pytest.mark.parametrize("explicit", ["custom", "annotated"])
def test_explicit_parameter_can_share_a_monitor_with_a_writable_property(explicit):
    @params(include=["count"])
    class Model:
        def __init__(self):
            self._count = 3

        @monitor("count")
        @property
        def count(self):
            return self._count

        @count.setter
        def count(self, value):
            self._count = value

    if explicit == "custom":
        params(custom_bindings={"count": NumberParameter("population")})(Model)
    else:
        Model.__annotations__ = {
            "count": Annotated[int, BindParameterConfig("number", id="population")]
        }
    model = Model()
    scenario = SimulationScenario()
    scenario.add_all(model)
    assert list(scenario.parameters) == ["population"]
    assert list(scenario.monitors) == ["count"]
    scenario.set_parameter("population", 9)
    assert model.count == scenario.monitors["count"][1]() == 9


@pytest.mark.parametrize("runtime_change", [False, True])
def test_readonly_properties_are_not_editable_parameters(runtime_change):
    class Model:
        @property
        def count(self):
            return 3

    assert parameters(Model()) == []
    params(
        custom_bindings={
            "count": NumberParameter("population", allow_runtime_change=runtime_change)
        }
    )(Model)
    scenario = SimulationScenario()
    with pytest.raises(ValueError, match=r"population.*count.*no setter"):
        scenario.add_all(Model())
    assert scenario.parameters == {}


def test_explicit_setter_makes_a_getter_only_monitor_editable():
    @params()
    class Model:
        def __init__(self):
            self._count = 3

        @monitor("count")
        @property
        def count(self):
            return self._count

    model = Model()
    cfg = params(
        custom_bindings={
            "count": NumberParameter(
                "population", setter=lambda value: setattr(model, "_count", value)
            )
        }
    )
    scenario = SimulationScenario()
    scenario.add_all(model, cfg)
    scenario.set_parameter("population", 9)
    assert model.count == scenario.get_parameter("population") == 9
    assert scenario.monitors["count"][1]() == 9


def test_generated_accessors_are_scoped_to_each_registered_instance():
    @params(include=["count"])
    class Model:
        count = 2

    first, second = Model(), Model()
    left, right = SimulationScenario(), SimulationScenario()
    left.add_all(first)
    right.add_all(second)
    left.set_parameter("count", 9)
    assert first.count == left.get_parameter("count") == 9
    assert second.count == right.get_parameter("count") == 2


def test_unresolved_annotations_are_not_silently_replaced_by_inference():
    class Model:
        count = 3

    Model.__annotations__ = {"count": "UndefinedParameterType"}
    with pytest.raises(NameError, match="UndefinedParameterType"):
        parameters(Model())


def test_constructor_annotation_resolution_is_limited_to_selected_controls():
    @bind_kwargs(include=["count"])
    class Model:
        def __init__(
            self,
            count: int = 3,
            resource: "UndefinedResource" = None,  # noqa: F821 — intentionally unresolved
        ):
            self.count = count
            self.resource = object() if resource is None else resource

    assert [
        (binding.name, binding.parameter.type) for binding in get_bind_kwargs(Model)
    ] == [("count", "number")]
    assert [(name, parameter.value) for name, parameter in parameters(Model())] == [
        ("count", 3)
    ]


def test_excluded_class_annotations_are_not_evaluated():
    @params(include=["count"])
    class Model:
        count: int = 3
        resource: "UndefinedResource"  # noqa: F821 — intentionally unresolved

    assert [(name, parameter.value) for name, parameter in parameters(Model())] == [
        ("count", 3)
    ]


@pytest.mark.asyncio
async def test_lifecycle_planning_matches_explicit_only_registration():
    @bind_kwargs()
    class Model:
        def __init__(
            self,
            count: Annotated[int, BindParameterConfig("number", id="population")] = 3,
            seed: Annotated[int, BindParameterConfig("number", min=0)] = 7,
        ):
            self.count = count
            self._seed_seen = seed

    model = Model(count=5, seed=11)
    standalone = SimulationScenario()
    standalone.add_all(model)
    assert set(standalone.parameters) == {"population"}
    scenario = SimulationScenario()
    await scenario.register_model(model)
    assert set(scenario.parameters) == {"population", "seed"}
    assert scenario.get_parameter("population") == 5
    assert scenario.parameters["population"].allow_runtime_change is True
    assert scenario.parameters["seed"].allow_runtime_change is False
    scenario.set_parameter("population", 9)
    scenario.set_parameter("seed", 23)
    assert model.count == 9 and model._seed_seen == 11
    await scenario.reset()
    assert model.count == 9 and model._seed_seen == 23


@pytest.mark.asyncio
async def test_reset_and_restore_keep_runtime_accessors_and_staged_controls():
    @params(include=["mode", "population"])
    @bind_kwargs(
        include=["mode", "seed"],
        custom_bindings={
            "mode": EnumParameter(
                "choice", options=["a", "b"], allow_runtime_change=False
            )
        },
    )
    class Model:
        mode: Annotated[
            str, BindParameterConfig("enum", id="choice", options=["a", "b"])
        ] = "a"

        def __init__(self, mode="a", seed=1):
            self.mode = mode
            self.population = seed

        def capture(self):
            return {"mode": self.mode, "population": self.population}

        def restore(self, saved):
            self.__init__(saved["mode"], saved["population"])

        @monitor("status")
        @property
        def status(self):
            return self.population

    model = Model()

    def getter():
        return model.population

    def setter(value):
        model.population = value

    params(
        custom_bindings={
            "population": NumberParameter("population", getter=getter, setter=setter)
        }
    )(Model)
    scenario = SimulationScenario(
        checkpoint_capture=model.capture, checkpoint_restore=model.restore
    )
    scenario.server.send = AsyncMock()
    await scenario.register_model(model)
    assert set(scenario.parameters) == {"choice", "population", "seed"}
    assert scenario.parameters["seed"].allow_runtime_change is False
    saved = model.capture()
    scenario.set_parameter("seed", 7)
    assert model.population == 1 and scenario.get_parameter("seed") == 7
    await scenario.reset()
    assert model.population == 7
    scenario.set_parameter("population", 9)
    assert model.population == scenario.get_parameter("population") == 9
    assert scenario.parameters["population"].getter is getter
    assert scenario.parameters["population"].setter is setter
    await scenario._on_scene_restore(
        None,
        {
            "request_id": "restore",
            "model_id": scenario.model_id,
            "checkpoint": encode_checkpoint(saved, use_msgpack=False),
        },
    )
    assert scenario._scene_restore_results["restore"]["status"] == "ok"
    assert model.population == scenario.get_parameter("population") == 1
    assert scenario.parameters["population"].getter is getter
    assert scenario.parameters["population"].setter is setter
    assert scenario.get_parameter("seed") == 7
    scenario.server.send.reset_mock()
    await scenario.broadcast_monitors(ws=object())
    assert scenario.server.send.call_args.args[1:] == (
        MessageType.MONITOR_UPDATE,
        {"id": "status", "value": 1},
    )
    scenario.set_parameter("population", 4)
    assert model.population == 4
