import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from tensnap import (
    SimulationScenario,
    agent,
    agent_layer,
    env,
    map_agent_layer,
    matrix_agent_layer,
)
from tensnap.bindings.basic.layer import _make_inferred_item_dynamic_projector
from tensnap.handler import DefaultSimulationHandler
from tensnap.models.environment import EnvironmentBinding, EnvironmentRegistration
from tensnap.models.layer import LayerBinding, LayerRegistration
from tensnap.utils.attr import make_attr_projector, make_dict_projector
from tensnap.utils.projection_ownership import configure_projector, owned_projector


class CopyProbe(dict):
    copies = 0

    def __deepcopy__(self, memo):
        type(self).copies += 1
        result = type(self)()
        memo[id(self)] = result
        result.update({key: deepcopy(value, memo) for key, value in self.items()})
        return result


@pytest.mark.parametrize(
    "mode", ["builtin", "boundary", "custom", "owned", "double", "borrow"]
)
def test_projection_and_publication_copy_policy(mode):
    model = SimpleNamespace(id="a", data=CopyProbe(count=0, values=[0]))
    projector = make_attr_projector(["id", "data"])
    if mode == "custom":

        def projector(item):
            return {"id": item.id, "data": item.data}

    if mode == "owned":

        def projector(item):
            return {"id": item.id, "data": deepcopy(item.data)}

    binding = LayerBinding(
        "agents",
        "agent",
        ("id",),
        iterable_getter=lambda item: [item],
        item_projector=projector,
        projector_owns_values=True if mode == "owned" else None,
        projector_deep_copy=mode not in ("borrow", "boundary"),
        deep_copy=True if mode == "double" else False if mode == "borrow" else None,
    )
    CopyProbe.copies = 0
    first = binding.build_item_list(model)
    assert CopyProbe.copies == (2 if mode == "double" else 0 if mode == "borrow" else 1)
    model.data["count"] = 1
    model.data["values"][0] = 1
    _, updates, _, _ = binding.build_item_list_diff_naive(model, {("a",): first[0]})
    assert first[0]["data"]["count"] == (1 if mode == "borrow" else 0)
    assert len(updates) == (0 if mode == "borrow" else 1)
    if updates:
        model.data["count"] = 2
        assert updates[0]["data"]["count"] == 1


def test_internal_seed_can_retain_already_published_items():
    model = SimpleNamespace(id="a", data=CopyProbe(count=0))
    binding = LayerBinding(
        "agents",
        "agent",
        ("id",),
        iterable_getter=lambda item: [item],
        item_projector=make_attr_projector(["id", "data"]),
    )
    registration = LayerRegistration(binding=binding, target=model)
    state = registration.build_state()
    CopyProbe.copies = 0
    registration.seed_item_deltas_from_state(state, False)
    assert CopyProbe.copies == 0
    registration.seed_item_deltas_from_state(state)
    assert CopyProbe.copies == 1


@pytest.mark.parametrize("kind", ["map", "matrix"])
def test_custom_owned_source_fields_do_not_borrow_injected_model_values(kind):
    decorator = map_agent_layer if kind == "map" else matrix_agent_layer
    project = (
        (lambda _m, _key, _value: {})
        if kind == "map"
        else (lambda _m, _row, _col, _value: {})
    )

    @decorator("items", source="items", project=project, projector_owns_values=True)
    @env("world")
    class Model:
        def __init__(self):
            self.value = {"count": 0}
            self.items = {"a": self.value} if kind == "map" else [[self.value]]

    model = Model()
    scenario = SimulationScenario(model_id="ownership")
    scenario.add_environment(model)
    registration = scenario.environments["world"].layers["items"]
    first = registration.binding.build_item_list(model)[0]
    model.value["count"] = 1
    assert first["data"]["value"]["count"] == 0


@pytest.mark.parametrize("kind", ["map", "matrix"])
@pytest.mark.parametrize("owned", [None, True])
def test_builtin_source_detaches_once_even_with_explicit_ownership(kind, owned):
    decorator = map_agent_layer if kind == "map" else matrix_agent_layer

    @decorator("items", source="items", projector_owns_values=owned)
    @env("world")
    class Model:
        def __init__(self):
            self.value = CopyProbe(count=0)
            self.items = {"a": self.value} if kind == "map" else [[self.value]]

    model = Model()
    scenario = SimulationScenario(model_id="ownership")
    scenario.add_environment(model)
    binding = scenario.environments["world"].layers["items"].binding
    CopyProbe.copies = 0
    published = binding.build_item_list(model)
    assert CopyProbe.copies == 1
    model.value["count"] = 1
    assert published[0]["data"]["value"]["count"] == 0


@pytest.mark.parametrize("mode", ["builtin", "boundary", "owned", "double", "borrow"])
def test_layer_decorator_forwards_copy_options(mode):
    projector = make_dict_projector(["id", "data"])
    if mode == "owned":

        def projector(item):
            return {"id": item["id"], "data": deepcopy(item["data"])}

    @agent_layer(
        "agents",
        item_projector=projector,
        projector_owns_values=True if mode == "owned" else None,
        projector_deep_copy=mode not in ("borrow", "boundary"),
        deep_copy=True if mode == "double" else False if mode == "borrow" else None,
    )
    @env("world")
    class Model:
        def __init__(self):
            self.data = CopyProbe(count=0)
            self.agents = [{"id": "a", "data": self.data}]

    model = Model()
    scenario = SimulationScenario(model_id="ownership")
    scenario.add_environment(model)
    binding = scenario.environments["world"].layers["agents"].binding
    CopyProbe.copies = 0
    published = binding.build_item_list(model)
    assert CopyProbe.copies == (2 if mode == "double" else 0 if mode == "borrow" else 1)
    model.data["count"] = 1
    assert published[0]["data"]["count"] == (1 if mode == "borrow" else 0)


@pytest.mark.parametrize("kind", ["static", "dynamic", "inferred", "map", "matrix"])
def test_builtin_scan_reuses_owned_values_before_copying(kind):
    probe = CopyProbe(count=0, values=[0])
    if kind in ("map", "matrix"):
        decorator = map_agent_layer if kind == "map" else matrix_agent_layer

        @decorator("items", source="items")
        @env("world")
        class Model:
            def __init__(self):
                self.items = {"a": probe} if kind == "map" else [[probe]]

        model = Model()
        scenario = SimulationScenario(model_id="reuse")
        scenario.add_environment(model)
        registration = scenario.environments["world"].layers["items"]
    elif kind == "inferred":

        @agent(data="data")
        class Item:
            def __init__(self):
                self.id, self.x, self.y, self.data = "a", 0, 0, probe

        @agent_layer("items")
        @env("world")
        class Model:
            def __init__(self):
                self.items = [Item()]

        model = Model()
        scenario = SimulationScenario(model_id="reuse")
        scenario.add_environment(model)
        registration = scenario.environments["world"].layers["items"]
    else:
        model = SimpleNamespace(id="a", x=0, data=probe)
        projector = make_attr_projector(["id", "x", "data"])
        if kind == "dynamic":
            projector = owned_projector(
                lambda _layer, item: {"id": item.id, "x": item.x, "data": item.data}
            )
        binding = LayerBinding(
            "items",
            "agent",
            ("id",),
            iterable_getter=lambda model: [model],
            **(
                {"item_dynamic_projector": projector}
                if kind == "dynamic"
                else {"item_projector": projector}
            ),
        )
        registration = LayerRegistration(binding=binding, target=model)

    environment = EnvironmentRegistration(EnvironmentBinding("world", "2d"))
    environment.add_layer(registration)
    handler = DefaultSimulationHandler()
    handler.scenario = SimpleNamespace(environments={"world": environment})
    CopyProbe.copies = 0
    asyncio.run(handler._prime_env_states())
    assert CopyProbe.copies == 1
    initial = next(iter(registration.last_items.values()))
    CopyProbe.copies = 0
    registration.build_item_deltas()
    assert CopyProbe.copies == 0
    probe["values"][0] = 1
    _, updates, _ = registration.build_item_deltas()
    assert len(updates) == 1
    assert CopyProbe.copies == 1
    retained_probe = (
        initial["data"] if kind not in ("map", "matrix") else initial["data"]["value"]
    )
    assert retained_probe["values"] == [0]


@pytest.mark.parametrize("precise", [False, True])
def test_builtin_scan_reuses_nested_fields_when_only_a_scalar_changes(precise):
    model = SimpleNamespace(id="a", x=0, data=CopyProbe(count=0))
    binding = LayerBinding(
        "items",
        "agent",
        ("id",),
        iterable_getter=lambda m: [m],
        item_projector=make_attr_projector(["id", "x", "data"]),
        item_id_getter=(lambda m: m.id) if precise else None,
        item_changed_getter=(lambda m: True) if precise else None,
    )
    first = binding.build_item_list(model)[0]
    diff = (
        binding.build_item_list_diff if precise else binding.build_item_list_diff_naive
    )
    cache_key = "a" if precise else ("a",)
    model.x = 1
    CopyProbe.copies = 0
    _, updates, _, current = diff(model, {cache_key: first})
    assert updates == (
        [{"id": "a", "x": 1, "data": first["data"]}]
        if precise
        else [{"id": "a", "x": 1}]
    )
    assert current[cache_key]["data"] is first["data"]
    assert CopyProbe.copies == 0
    # A selector's runtime value can change shape; no scalar-only inference.
    model.data = {"nested": [1]}
    _, updates, _, _ = diff(model, current)
    model.data["nested"][0] = 2
    assert updates[0]["data"]["nested"] == [1]


def test_configuring_an_owned_dispatcher_preserves_its_outer_record_isolation():
    model = {"id": "a", "data": CopyProbe(count=0)}
    projector = _make_inferred_item_dynamic_projector((), lambda item: item)
    configured = configure_projector(projector, True)
    assert configured is projector
    projected = configured(None, model)
    assert projected is not model
    assert projected["data"] is not model["data"]
    model["data"]["count"] = 1
    assert projected["data"]["count"] == 0
