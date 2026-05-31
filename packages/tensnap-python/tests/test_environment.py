"""Tests for the new environment/layer binding surface."""

from typing import Any

from tensnap import bindings as binding_api
from tensnap.bindings import agent, agent_layer, env, grid_layer
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
