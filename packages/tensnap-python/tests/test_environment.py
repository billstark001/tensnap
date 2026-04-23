"""Tests for canonical environment binders."""

import networkx as nx

from tensnap.models import (
    GraphEnvironmentBinder,
    GraphEnvironmentBinderNX,
    GridEnvironmentBinder,
    UniformEnvironmentBinder,
)


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

    def test_get_state_serializes_agents(self):
        class SimpleAgent:
            def __init__(self, agent_id, x, y):
                self.id = agent_id
                self.x = x
                self.y = y

        class SimpleEnv:
            def __init__(self):
                self.agents = [SimpleAgent(1, 10, 20), SimpleAgent(2, 30, 40)]

        state = UniformEnvironmentBinder(id="test_env", environment=SimpleEnv()).get_state()
        agents = state["layers"][0].get("agents", [])

        assert len(agents) == 2
        assert agents[0]["id"] == 1

    def test_set_environment(self):
        class SimpleAgent:
            def __init__(self, agent_id):
                self.id = agent_id

        class SimpleEnv:
            def __init__(self, agent_id):
                self.agents = [SimpleAgent(agent_id)]

        binder = UniformEnvironmentBinder(id="test_env", environment=SimpleEnv(1))
        binder.set_environment(SimpleEnv(2))

        state = binder.get_state()
        agents = state["layers"][0].get("agents", [])
        assert agents[0]["id"] == 2


class TestGridEnvironmentBinder:
    def test_grid_state_includes_metadata(self):
        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 15
                self.agents = []

        state = GridEnvironmentBinder(id="grid_env", environment=GridEnv()).get_state()
        layer = state["layers"][0]

        assert state["id"] == "grid_env"
        assert state["type"] == "2d"
        assert layer["layer_id"] == "grid"
        assert layer["layer_type"] == "grid"
        assert layer.get("data") == {"width": 10, "height": 15}

    def test_grid_state_serializes_agents(self):
        class GridAgent:
            def __init__(self, agent_id, x, y):
                self.id = agent_id
                self.x = x
                self.y = y

        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 10
                self.agents = [GridAgent(1, 5, 5), GridAgent(2, 8, 3)]

        state = GridEnvironmentBinder(id="grid_env", environment=GridEnv()).get_state()
        agents = state["layers"][0].get("agents", [])

        assert len(agents) == 2
        assert agents[0]["x"] == 5
        assert agents[0]["y"] == 5


class TestGraphEnvironmentBinder:
    def test_graph_state_includes_agent_and_edge_layers(self):
        class GraphEnv:
            def __init__(self):
                self.edges = [{"source": 1, "target": 2}, {"source": 2, "target": 3}]
                self.agents = []

        state = GraphEnvironmentBinder(id="graph_env", environment=GraphEnv()).get_state()

        assert state["id"] == "graph_env"
        assert state["type"] == "2d"
        assert [layer["layer_type"] for layer in state["layers"]] == ["agent", "edge"]
        assert len(state["layers"][1].get("edges", [])) == 2

    def test_graph_state_serializes_agents(self):
        class GraphAgent:
            def __init__(self, agent_id):
                self.id = agent_id

        class GraphEnv:
            def __init__(self):
                self.edges = []
                self.agents = [GraphAgent(1), GraphAgent(2), GraphAgent(3)]

        state = GraphEnvironmentBinder(id="graph_env", environment=GraphEnv()).get_state()
        agents = state["layers"][0].get("agents", [])

        assert len(agents) == 3
        assert agents[0]["id"] == 1


class TestGraphEnvironmentBinderNX:
    def test_initialization_with_graph(self):
        graph = nx.Graph()
        graph.add_edge(1, 2)
        graph.add_edge(2, 3)

        binder = GraphEnvironmentBinderNX(id="nx_graph", graph=graph)

        assert binder.id == "nx_graph"
        assert binder.graph == graph

    def test_networkx_state_includes_nodes_and_edges(self):
        graph = nx.Graph()
        graph.add_node(1, x=10, y=20)
        graph.add_node(2, x=30, y=40)
        graph.add_edge(1, 2)

        state = GraphEnvironmentBinderNX(id="nx_graph", graph=graph).get_state()

        assert state["id"] == "nx_graph"
        assert state["type"] == "2d"
        assert len(state["layers"][0].get("agents", [])) == 2
        assert len(state["layers"][1].get("edges", [])) == 1

    def test_directed_graph_edges_marked_directed(self):
        graph = nx.DiGraph()
        graph.add_edge(1, 2)
        graph.add_edge(2, 3)

        state = GraphEnvironmentBinderNX(id="directed_graph", graph=graph).get_state()
        edges = state["layers"][1].get("edges", [])

        assert all(edge.get("directed", False) for edge in edges)


class TestEnvironmentAccessorDicts:
    def test_grid_environment_with_accessor_dict(self):
        class GridEnv:
            def __init__(self):
                self.w = 10
                self.h = 15
                self.agents = []

        state = GridEnvironmentBinder(
            id="grid_env",
            environment=GridEnv(),
            environment_accessor={"id": "grid_env", "width": "w", "height": "h"},
        ).get_state()

        assert state["layers"][0].get("data") == {"width": 10, "height": 15}

    def test_graph_environment_with_accessor_dict(self):
        class GraphEnv:
            def __init__(self):
                self.connections = [{"source": 1, "target": 2}]
                self.agents = []

        state = GraphEnvironmentBinder(
            id="graph_env",
            environment=GraphEnv(),
            environment_accessor={"id": "graph_env", "edges": "connections"},
        ).get_state()

        assert state["layers"][1].get("edges") == [{"source": 1, "target": 2}]

    def test_agent_accessor_dict(self):
        class Agent:
            def __init__(self, agent_id, pos_x, pos_y):
                self.agent_id = agent_id
                self.pos_x = pos_x
                self.pos_y = pos_y

        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 10
                self.agents = [Agent(1, 5, 5)]

        state = GridEnvironmentBinder(
            id="grid_env",
            environment=GridEnv(),
            agent_accessor={"id": "agent_id", "x": "pos_x", "y": "pos_y"},
        ).get_state()
        agents = state["layers"][0].get("agents", [])

        assert len(agents) == 1
        assert agents[0]["id"] == 1
        assert agents[0]["x"] == 5
        assert agents[0]["y"] == 5
