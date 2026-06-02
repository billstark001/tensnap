"""Tests for the new environment/layer binding surface."""

from typing import Any

import pytest

from tensnap import bindings as binding_api
from tensnap.bindings.basic import layer_utils
from tensnap.handler import DefaultSimulationHandler
from tensnap.bindings import (
    agent,
    agent_layer,
    attr,
    edge,
    edge_layer,
    env,
    grid_layer,
    value,
)
from tensnap.models import (
    EnvironmentBinding,
    EnvironmentRegistration,
    LayerBinding,
    LayerRegistration,
)


class TestBindingsPackage:
    def test_unified_readback_returns_environment_and_layers(self):
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
                self.birds = [Bird(1, (2, 3)), Bird(2, (4, 5))]

        environment_binding = binding_api.environment_binding(Aviary)
        layer_binding_list = binding_api.layer_bindings(Aviary)
        bundle = binding_api.bindings(Aviary)

        assert environment_binding is not None
        assert environment_binding.id == "aviary"
        assert environment_binding.type == "2d"
        assert {binding.layer_id for binding in layer_binding_list} == {"birds", "grid"}
        assert bundle[0] == environment_binding
        assert {binding.layer_id for binding in bundle[1]} == {"birds", "grid"}


class TestEnvironmentRegistration:
    def test_environment_registration_builds_snapshot_from_layer_registrations(self):
        def project_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return list(items)

        binding: LayerBinding[list[dict[str, Any]], str, object, str] = LayerBinding(
            layer_id="agents",
            layer_type="agent",
            item_keys=("id",),
            items_projector=project_items,
        )
        registration = LayerRegistration(
            binding=binding,
            target=[{"id": "a1", "x": 1, "y": 2}],
        )
        environment = EnvironmentRegistration(
            binding=EnvironmentBinding(id="world", type="2d")
        )
        environment.add_layer(registration)

        state = environment.build_state()

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

    def test_layer_registration_tracks_naive_item_deltas(self):
        items = [{"id": "a1", "x": 1, "y": 2}]

        def project_items(layer: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return list(layer)

        binding: LayerBinding[list[dict[str, Any]], str, object, str] = LayerBinding(
            layer_id="agents",
            layer_type="agent",
            item_keys=("id",),
            items_projector=project_items,
        )
        registration = LayerRegistration(binding=binding, target=items)

        creates, updates, deletes = registration.build_item_deltas()
        assert creates == [{"id": "a1", "x": 1, "y": 2}]
        assert updates == []
        assert deletes == []

        items[0] = {"id": "a1", "x": 3, "y": 2}
        creates, updates, deletes = registration.build_item_deltas()
        assert creates == []
        assert updates == [{"id": "a1", "x": 3}]
        assert deletes == []

        items.clear()
        _, _, deleted_ids = registration.build_item_deltas()
        assert registration.build_item_delete_payloads(deleted_ids) == [{"id": "a1"}]

    def test_layer_registration_seeds_deltas_from_existing_snapshot(self):
        projected_calls = 0

        class Agent:
            def __init__(self, agent_id: str, x: int, changed: bool = False):
                self.id = agent_id
                self.x = x
                self.changed = changed

        agents = [Agent("a1", 1), Agent("a2", 2)]

        def project(agent: Agent) -> dict[str, Any]:
            nonlocal projected_calls
            projected_calls += 1
            return {"id": agent.id, "x": agent.x, "y": 0}

        binding: LayerBinding[list[Agent], str, Agent, str] = LayerBinding(
            layer_id="agents",
            layer_type="agent",
            item_keys=("id",),
            iterable_getter=lambda layer: layer,
            item_projector=project,
            item_id_getter=lambda agent: agent.id,
            item_changed_getter=lambda agent: agent.changed,
        )
        registration = LayerRegistration(binding=binding, target=agents)
        state = registration.build_state()

        registration.seed_item_deltas_from_state(state)
        projected_calls = 0
        agents[0].x = 3
        agents[0].changed = True

        creates, updates, deletes = registration.build_item_deltas()

        assert projected_calls == 1
        assert creates == []
        assert updates == [{"id": "a1", "x": 3, "y": 0}]
        assert deletes == []

    def test_agent_layer_decorator_accepts_incremental_diff_getters(self):
        class Agent:
            id = "a1"
            changed = False

        @agent_layer(
            item_iterable_projector="agents",
            item_id_getter="id",
            item_changed_getter="changed",
        )
        class Model:
            agents = [Agent()]

        binding = binding_api.layer_bindings(Model)[0]

        assert binding.item_id_getter is not None
        assert binding.item_changed_getter is not None
        assert binding.has_item_diffing

    def test_layer_bindings_resolve_literals_helpers_and_instance_only_fields(self):
        @agent(
            x=attr("position[0]"),
            y=attr("position[1]"),
            color=value("red"),
            icon="circle",
            size=lambda bird: bird.size,
        )
        class Bird:
            def __init__(self, bird_id: int, position: tuple[int, int], size: int):
                self.id = bird_id
                self.position = position
                self.size = size

        @agent_layer(
            "birds",
            item_iterable_projector="birds",
            width=None,
            height=None,
            coord_offset="float",
        )
        class Aviary:
            def __init__(self):
                self.width = 20
                self.height = 10
                self.birds = [Bird(1, (2, 3), 7)]

        model = Aviary()
        binding = binding_api.layer_bindings(model)[0]

        assert binding.build_metadata(model) == {
            "width": 20,
            "height": 10,
            "coord_offset": "float",
        }
        assert binding.build_item_list(model) == [
            {
                "id": 1,
                "x": 2,
                "y": 3,
                "color": "red",
                "icon": "circle",
                "size": 7,
            }
        ]

    def test_special_string_literals_do_not_make_invalid_selectors_look_valid(self):
        @agent(
            x=attr("position[0]"),
            y=attr("position[1]"),
            color="#3498db",
            data='{"species":"bird"}',
        )
        class Bird:
            def __init__(self):
                self.id = "bird-1"
                self.position = (2, 3)

        bird = Bird()
        projector = Bird._tensnap_bind_config_item_agent.get_projector()  # type: ignore

        assert projector(bird) == {
            "id": "bird-1",
            "x": 2,
            "y": 3,
            "color": "#3498db",
            "data": '{"species":"bird"}',
        }

        @agent(x="position[0", y="position[1]")
        class InvalidBird:
            def __init__(self):
                self.id = "invalid"
                self.position = (1, 2)

        with pytest.raises(ValueError, match="Invalid mapped source field name"):
            InvalidBird()

    def test_projector_string_selectors_detect_callable_descriptors(self):
        @agent(x=attr("position[0]"), y=attr("position[1]"), size="size_for")
        class Bird:
            def __init__(self):
                self.id = "bird-1"
                self.position = (2, 3)
                self.radius = 9

            @classmethod
            def size_for(cls, bird):
                return bird.radius

        bird = Bird()
        projector = Bird._tensnap_bind_config_item_agent.get_projector()  # type: ignore

        assert projector(bird)["size"] == 9

    def test_instance_field_discovery_stays_out_of_projection_hot_path(
        self, monkeypatch
    ):
        @agent(x=attr("position[0]"), y=attr("position[1]"))
        class Bird:
            def __init__(self):
                self.id = "bird-1"
                self.position = (2, 3)

        @agent_layer("birds", item_iterable_projector="birds", width=None, height=None)
        class Aviary:
            def __init__(self):
                self.width = 20
                self.height = 10
                self.birds = [Bird()]

        model = Aviary()
        binding = binding_api.layer_bindings(model)[0]

        def fail_dynamic_field_scan(_target):
            raise AssertionError("instance field discovery entered the hot path")

        monkeypatch.setattr(
            layer_utils,
            "_target_dynamic_field_names",
            fail_dynamic_field_scan,
        )

        assert binding.build_metadata(model) == {"width": 20, "height": 10}
        assert binding.build_item_list(model) == [{"id": "bird-1", "x": 2, "y": 3}]

    def test_edge_item_boolean_fields_treat_bool_as_literal(self):
        @edge(directed=False)
        class Link:
            def __init__(self, source: str, target: str):
                self.source = source
                self.target = target

        @edge_layer("links", item_iterable_projector="links")
        class Model:
            def __init__(self):
                self.links = [Link("a", "b")]

        model = Model()
        binding = binding_api.layer_bindings(model)[0]

        assert binding.build_item_list(model) == [
            {"source": "a", "target": "b", "directed": False}
        ]


class FakeServer:
    def __init__(self):
        self.messages: list[tuple[Any, Any]] = []

    async def broadcast(self, message_type: Any, payload: Any) -> None:
        self.messages.append((message_type, payload))


class FakeScenario:
    def __init__(self, environment: EnvironmentRegistration):
        self.environments = {environment.id: environment}
        self.server = FakeServer()

    async def broadcast_charts(self, _step: int) -> None:
        pass


@pytest.mark.asyncio
async def test_default_handler_step_does_not_project_items_twice():
    projected_calls = 0

    class Agent:
        def __init__(self, agent_id: str, x: int, changed: bool = False):
            self.id = agent_id
            self.x = x
            self.changed = changed

    agents = [Agent("a1", 1), Agent("a2", 2)]

    def project(agent: Agent) -> dict[str, Any]:
        nonlocal projected_calls
        projected_calls += 1
        return {"id": agent.id, "x": agent.x, "y": 0}

    layer_binding: LayerBinding[list[Agent], str, Agent, str] = LayerBinding(
        layer_id="agents",
        layer_type="agent",
        item_keys=("id",),
        iterable_getter=lambda layer: layer,
        item_projector=project,
        item_id_getter=lambda agent: agent.id,
        item_changed_getter=lambda agent: agent.changed,
    )
    environment = EnvironmentRegistration(EnvironmentBinding(id="world", type="2d"))
    environment.add_layer(LayerRegistration(binding=layer_binding, target=agents))
    scenario = FakeScenario(environment)
    handler = DefaultSimulationHandler()
    await handler.on_registered(scenario)  # type: ignore[arg-type]
    await handler._prime_env_states()

    assert projected_calls == 2

    projected_calls = 0
    agents[0].x = 3
    agents[0].changed = True
    await handler._push_env_updates()

    assert projected_calls == 1
