from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import tensnap.models.environment as environment_module
from tensnap import agent_layer, env, layer_restore, scene_restore
from tensnap.bindings import layer_bindings, layer_configs, scene_restore_binding
from tensnap.helper import send_env_snapshot
from tensnap.models.environment import EnvironmentBinding, EnvironmentRegistration
from tensnap.models.layer import LayerBinding, LayerRegistration
from tensnap.server import ServerToClientMessageType


def _registration(layer_id, layer_type, dependencies=None):
    binding = LayerBinding(
        layer_id=layer_id,
        layer_type=layer_type,
        item_keys=("id",),
        dependency_layer_ids=dependencies or {},
        items_projector=lambda _: [],
    )
    return LayerRegistration(binding=binding, target=object())


def test_environment_compiles_topology_once_per_registry_change(monkeypatch):
    calls = 0
    original = environment_module.order_layers

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(environment_module, "order_layers", counted)
    environment = EnvironmentRegistration(EnvironmentBinding("main", "2d"))
    environment.add_layer(_registration("edges", "edge", {"agent": "agents"}))
    environment.add_layer(_registration("agents", "agent"))
    assert [layer["layer_id"] for layer in environment.build_state()["layers"]] == [
        "agents",
        "edges",
    ]
    environment.build_state(include_items=False)
    assert calls == 1
    expected_calls = calls + 1
    environment.add_layer(_registration("trails", "trajectory", {"agent": "agents"}))
    environment.build_state(include_items=False)
    assert calls == expected_calls


def test_environment_rejects_missing_wrong_type_and_cycle():
    environment = EnvironmentRegistration(EnvironmentBinding("main", "2d"))
    environment.add_layer(_registration("edges", "edge", {"agent": "agents"}))
    with pytest.raises(ValueError, match="missing layer"):
        environment.build_state()
    environment.add_layer(_registration("agents", "grid"))
    with pytest.raises(ValueError, match="requires agent layer"):
        environment.build_state()
    environment.remove_layer("agents")
    environment.add_layer(_registration("agents", "agent", {"edge": "edges"}))
    with pytest.raises(ValueError, match="cyclic layer dependency"):
        environment.build_state()


def test_dependency_siblings_follow_declaration_order():
    environment = EnvironmentRegistration(EnvironmentBinding("main", "2d"))
    environment.add_layer(
        _registration("dependent", "grid", {"first": "first", "second": "second"})
    )
    environment.add_layer(_registration("second", "grid"))
    environment.add_layer(_registration("first", "grid"))
    assert [layer["layer_id"] for layer in environment.build_state()["layers"]] == [
        "second",
        "first",
        "dependent",
    ]


@pytest.mark.asyncio
async def test_state_sync_deletes_dependents_before_recreating_layers():
    server = SimpleNamespace(send=AsyncMock())
    ws = object()
    layers = [
        {"layer_id": "agents", "layer_type": "agent"},
        {
            "layer_id": "edges",
            "layer_type": "edge",
            "dependency_layer_ids": {"agent": "agents"},
        },
    ]
    state = {"id": "main", "type": "2d", "layers": layers}
    await send_env_snapshot(ws, server, state, state)
    events = [
        (call.args[1], call.args[2]["layer_id"]) for call in server.send.await_args_list
    ]
    assert events == [
        (ServerToClientMessageType.ENV_LAYER_DELETE, "edges"),
        (ServerToClientMessageType.ENV_LAYER_DELETE, "agents"),
        (ServerToClientMessageType.ENV_LAYER_CREATE, "agents"),
        (ServerToClientMessageType.ENV_LAYER_CREATE, "edges"),
    ]


def test_restore_metadata_is_class_owned_and_requires_local_layer():
    with pytest.raises(TypeError, match="only decorate a class"):
        scene_restore()(lambda: None)

    @scene_restore(None)
    @agent_layer("agents", items_projector=lambda _: [])
    @env("main")
    class Base:
        pass

    class Child(Base):
        pass

    assert scene_restore_binding(Child()) is scene_restore_binding(Base)
    with pytest.raises(ValueError, match="exactly one matching layer"):
        layer_restore(replace="restore_items")(Child)


def test_layer_restore_requires_an_unambiguous_local_target():
    @agent_layer("left", items_projector=lambda _: [])
    @agent_layer("right", items_projector=lambda _: [])
    class Model:
        pass

    with pytest.raises(ValueError, match="specify layer_id"):
        layer_restore(replace="restore_items")(Model)
    layer_restore(layer_id="left", replace="restore_items")(Model)
    specs = {config.layer_id: config.restore for config in layer_configs(Model)}
    assert specs["left"] is not None
    assert specs["right"] is None

    @agent_layer("same", items_projector=lambda _: [])
    @agent_layer("same", items_projector=lambda _: [])
    class Duplicated:
        pass

    with pytest.raises(ValueError, match="duplicate layer id"):
        layer_bindings(Duplicated)
