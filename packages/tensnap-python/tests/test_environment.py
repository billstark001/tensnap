"""Tests for canonical v0.2 layered environment binders."""

from tensnap.bindings.basic import (
    EnvironmentBindingBuilder,
    bind_env,
    bind_agent,
    bind_agent_layer,
    bind_background_layer,
    bind_edge_layer,
    bind_grid_layer,
    bind_trajectory_item,
    bind_trajectory_layer,
)
from tensnap.models import LayeredEnvironmentBinder, UniformEnvironmentBinder


class TestUniformEnvironmentBinder:
    def test_basic_initialization(self):
        class SimpleEnv:
            def __init__(self):
                self.agents = []

        env = SimpleEnv()
        binder = UniformEnvironmentBinder(id="test_env", environment=env)

        assert binder.id == "test_env"
        assert binder.environment == env

    def test_get_state_exposes_agent_layer(self):
        class SimpleEnv:
            def __init__(self):
                self.agents = []

        state = UniformEnvironmentBinder(id="test_env", environment=SimpleEnv()).get_state()

        assert state == {
            "id": "test_env",
            "type": "uniform",
            "layers": [{"layer_id": "agents", "layer_type": "agent"}],
        }


class TestLayeredBindings:
    def test_declarative_2d_environment_builds_grid_agent_and_trajectory_layers(self):
        @bind_agent(x="position[0]", y="position[1]", color=True)
        class Bird:
            def __init__(self, bird_id: int, position: tuple[int, int]):
                self.id = bird_id
                self.position = position
                self.color = "#3498db"

        @bind_trajectory_layer(metadata={"length": 5}, dependency_layer_ids={"agent": "birds"})
        @bind_agent_layer("birds", item_iterable_accessor="birds")
        @bind_grid_layer(width="width", height="height")
        @bind_env()
        class Aviary:
            def __init__(self):
                self.width = 20
                self.height = 10
                self.birds = [Bird(1, (2, 3)), Bird(2, (4, 5))]

        state = LayeredEnvironmentBinder(id="aviary", environment=Aviary()).get_state()

        assert state["type"] == "2d"
        assert [layer["layer_type"] for layer in state["layers"]] == [
            "grid",
            "agent",
            "trajectory",
        ]
        assert state["layers"][0].get("data") == {"width": 20, "height": 10}
        assert state["layers"][1].get("agents") == [
            {"id": 1, "x": 2, "y": 3, "color": "#3498db"},
            {"id": 2, "x": 4, "y": 5, "color": "#3498db"},
        ]
        assert state["layers"][2].get("data") == {"length": 5}
        assert state["layers"][2].get("dependency_layer_ids") == {
            "agent": "birds"
        }

    def test_background_layer_binds_metadata(self):
        @bind_background_layer(metadata={"source": "asset:terrain", "z_index": 0})
        @bind_grid_layer(width="width", height="height")
        @bind_env()
        class Scene:
            width = 8
            height = 6

        state = LayeredEnvironmentBinder(id="scene", environment=Scene()).get_state()
        assert [layer["layer_type"] for layer in state["layers"]] == ["grid", "background"]
        assert state["layers"][1]["data"] == {"source": "asset:terrain", "z_index": 0}

    def test_trajectory_layer_supports_item_level_binding(self):
        @bind_trajectory_item(length=True, color=True, width=True)
        class TrailConfig:
            def __init__(self, item_id: str, length: int, color: str, width: float):
                self.id = item_id
                self.length = length
                self.color = color
                self.width = width

        @bind_trajectory_layer(item_iterable_accessor="trail_configs")
        @bind_env()
        class Scene:
            def __init__(self):
                self.trail_configs = [TrailConfig("a1", 12, "#f00", 2.0)]

        state = LayeredEnvironmentBinder(id="scene", environment=Scene()).get_state()
        layer = state["layers"][0]

        assert layer["layer_type"] == "trajectory"
        assert layer["items"] == [{"id": "a1", "length": 12, "width": 2.0, "color": "#f00"}]

    def test_edge_layer_with_networkx_style_triples(self):
        class GraphEnv:
            def __init__(self):
                self.edge_triples = [
                    ("a", "b", {"weight": 1}),
                    ("b", "c", {"weight": 2}),
                ]

        @bind_edge_layer(
            item_iterable_accessor="edge_triples",
            edge_accessor=True,
            dependency_layer_ids={"agent": "agents"},
        )
        @bind_agent_layer("agents", item_iterable_accessor=False)
        @bind_env()
        class Scene(GraphEnv):
            pass

        state = LayeredEnvironmentBinder(id="g", environment=Scene()).get_state()
        edge_layer = state["layers"][1]

        assert edge_layer["layer_type"] == "edge"
        assert edge_layer["dependency_layer_ids"] == {"agent": "agents"}
        assert edge_layer["edges"] == [
            {"source": "a", "target": "b", "directed": False},
            {"source": "b", "target": "c", "directed": False},
        ]

    def test_layer_items_accessor_supports_environment_level_fast_path(self):
        @bind_agent_layer("birds", items_accessor="build_birds")
        @bind_env()
        class Aviary:
            def __init__(self):
                self.birds = [
                    {"id": 1, "x": 2, "y": 3, "color": "#3498db"},
                    {"id": 2, "x": 4, "y": 5, "color": "#f59e0b"},
                ]

            def build_birds(self):
                return list(self.birds)

        state = LayeredEnvironmentBinder(id="aviary", environment=Aviary()).get_state()
        assert state["layers"][0]["agents"] == [
            {"id": 1, "x": 2, "y": 3, "color": "#3498db"},
            {"id": 2, "x": 4, "y": 5, "color": "#f59e0b"},
        ]

    def test_layer_item_accessor_supports_instance_methods(self):
        class Bird:
            def __init__(self, bird_id: int, position: tuple[int, int]):
                self.id = bird_id
                self.position = position

        @bind_agent_layer(
            "birds",
            item_iterable_accessor="birds",
            item_accessor="build_bird",
        )
        @bind_env()
        class Aviary:
            def __init__(self):
                self.birds = [Bird(1, (2, 3)), Bird(2, (4, 5))]

            def build_bird(self, bird: Bird):
                return {"id": bird.id, "x": bird.position[0], "y": bird.position[1]}

        state = LayeredEnvironmentBinder(id="aviary", environment=Aviary()).get_state()
        assert state["layers"][0]["agents"] == [
            {"id": 1, "x": 2, "y": 3},
            {"id": 2, "x": 4, "y": 5},
        ]

    def test_imperative_environment_binding_builder_creates_layered_binder(self):
        class Particle:
            def __init__(self, particle_id: int, x: int, y: int):
                self.id = particle_id
                self.x = x
                self.y = y

        class ParticleEnv:
            def __init__(self):
                self.width = 8
                self.height = 6
                self.particles = [Particle(1, 1, 2)]

        builder = EnvironmentBindingBuilder(environment_type="2d")
        builder.add_grid_layer(metadata_accessor=lambda env: {"width": env.width, "height": env.height})
        builder.add_agent_layer(
            layer_id="particles",
            item_iterable_accessor=lambda env: env.particles,
            item_accessor=lambda item: {"id": item.id, "x": item.x, "y": item.y},
        )

        binder = builder.build(id="particles", environment=ParticleEnv())
        state = binder.get_state()

        assert state == {
            "id": "particles",
            "type": "2d",
            "layers": [
                {"layer_id": "grid", "layer_type": "grid", "data": {"width": 8, "height": 6}},
                {
                    "layer_id": "particles",
                    "layer_type": "agent",
                    "agents": [{"id": 1, "x": 1, "y": 2}],
                },
            ],
        }
