"""Tests for the new environment/layer binding surface."""

from tensnap import bindings as binding_api
from tensnap.bindings import agent, agent_layer, env, grid_layer
from tensnap.bindings.mesa.helper import build_default_layered_binder
from tensnap.models import EnvironmentBinding, EnvironmentRegistration, LayerBinding, LayerRegistration


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
        binding = LayerBinding(
            layer_id="agents",
            layer_type="agent",
            item_keys=("id",),
            items_projector=lambda items: list(items),
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
        binding = LayerBinding(
            layer_id="agents",
            layer_type="agent",
            item_keys=("id",),
            items_projector=lambda layer: list(layer),
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


class TestMesaDefaults:
    def test_default_mesa_bindings_produce_grid_and_agent_layers(self):
        class Agent:
            def __init__(self, agent_id: int, pos: tuple[int, int]):
                self.unique_id = agent_id
                self.pos = pos

        class Grid:
            width = 8
            height = 6

        class Model:
            def __init__(self):
                self.grid = Grid()
                self.agents = [Agent(1, (2, 3))]

        model = Model()
        environment_binding, layer_bindings = build_default_layered_binder(model)
        registrations = [LayerRegistration(binding=binding, target=model) for binding in layer_bindings]

        assert environment_binding.id == "Model"
        assert environment_binding.type == "2d"
        assert {binding.layer_id for binding in layer_bindings} == {"grid", "agents"}
        states = {registration.id: registration.build_state() for registration in registrations}
        assert states["grid"]["data"] == {"width": 8, "height": 6}
        assert states["agents"]["agents"] == [{"id": 1, "x": 2, "y": 3}]
