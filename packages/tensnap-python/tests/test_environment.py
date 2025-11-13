"""Tests for environment binders"""

import pytest
import networkx as nx
from tensnap.models import (
    UniformEnvironmentBinder,
    GridEnvironmentBinder,
    GraphEnvironmentBinder,
    GraphEnvironmentBinderNX,
)


class TestUniformEnvironmentBinder:
    """Test UniformEnvironmentBinder functionality"""

    def test_basic_initialization(self):
        """Test basic uniform environment initialization"""

        class SimpleEnv:
            def __init__(self):
                self.agents = []

        env = SimpleEnv()
        binder = UniformEnvironmentBinder(
            id="test_env",
            environment=env,
        )

        assert binder.id == "test_env"
        assert binder.environment == env

    def test_get_model_dict(self):
        """Test getting model dictionary"""

        class SimpleEnv:
            def __init__(self):
                self.agents = []

        env = SimpleEnv()
        binder = UniformEnvironmentBinder(
            id="test_env",
            environment=env,
        )

        model_dict = binder.get_model_dict()
        assert model_dict["id"] == "test_env"
        assert model_dict["type"] == "uniform"

    def test_get_agent_list(self):
        """Test getting agent list"""

        class SimpleAgent:
            def __init__(self, id, x, y):
                self.id = id
                self.x = x
                self.y = y

        class SimpleEnv:
            def __init__(self):
                self.agents = [
                    SimpleAgent(1, 10, 20),
                    SimpleAgent(2, 30, 40),
                ]

        env = SimpleEnv()
        binder = UniformEnvironmentBinder(
            id="test_env",
            environment=env,
        )

        agent_list = binder.get_agent_list()
        assert len(agent_list) == 2
        assert agent_list[0]["id"] == 1

    def test_set_environment(self):
        """Test setting a new environment"""

        class SimpleEnv:
            def __init__(self, value):
                self.value = value
                self.agents = []

        env1 = SimpleEnv(1)
        binder = UniformEnvironmentBinder(
            id="test_env",
            environment=env1,
        )

        assert binder.environment.value == 1

        env2 = SimpleEnv(2)
        binder.set_environment(env2)

        assert binder.environment.value == 2


class TestGridEnvironmentBinder:
    """Test GridEnvironmentBinder functionality"""

    def test_initialization(self):
        """Test grid environment initialization"""

        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 10
                self.agents = []

        env = GridEnv()
        binder = GridEnvironmentBinder(
            id="grid_env",
            environment=env,
        )

        assert binder.id == "grid_env"

    def test_get_model_dict_with_grid(self):
        """Test getting grid model dictionary"""

        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 15
                self.agents = []

        env = GridEnv()
        binder = GridEnvironmentBinder(
            id="grid_env",
            environment=env,
        )

        model_dict = binder.get_model_dict()
        assert model_dict["id"] == "grid_env"
        assert model_dict["type"] == "grid"
        assert model_dict["width"] == 10
        assert model_dict["height"] == 15

    def test_grid_agents_with_position(self):
        """Test grid agents with position information"""

        class GridAgent:
            def __init__(self, id, x, y):
                self.id = id
                self.x = x
                self.y = y

        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 10
                self.agents = [
                    GridAgent(1, 5, 5),
                    GridAgent(2, 8, 3),
                ]

        env = GridEnv()
        binder = GridEnvironmentBinder(
            id="grid_env",
            environment=env,
        )

        agent_list = binder.get_agent_list()
        assert len(agent_list) == 2
        assert agent_list[0]["x"] == 5
        assert agent_list[0]["y"] == 5


class TestGraphEnvironmentBinder:
    """Test GraphEnvironmentBinder functionality"""

    def test_initialization(self):
        """Test graph environment initialization"""

        class GraphEnv:
            def __init__(self):
                self.edges = []
                self.agents = []

        env = GraphEnv()
        binder = GraphEnvironmentBinder(
            id="graph_env",
            environment=env,
        )

        assert binder.id == "graph_env"

    def test_get_model_dict_with_edges(self):
        """Test getting graph model with edges"""

        class GraphEnv:
            def __init__(self):
                self.edges = [
                    {"source": 1, "target": 2},
                    {"source": 2, "target": 3},
                ]
                self.agents = []

        env = GraphEnv()
        binder = GraphEnvironmentBinder(
            id="graph_env",
            environment=env,
        )

        model_dict = binder.get_model_dict()
        assert model_dict["id"] == "graph_env"
        assert model_dict["type"] == "graph"
        assert len(model_dict["edges"]) == 2

    def test_graph_agents(self):
        """Test graph agents"""

        class GraphAgent:
            def __init__(self, id):
                self.id = id

        class GraphEnv:
            def __init__(self):
                self.edges = []
                self.agents = [
                    GraphAgent(1),
                    GraphAgent(2),
                    GraphAgent(3),
                ]

        env = GraphEnv()
        binder = GraphEnvironmentBinder(
            id="graph_env",
            environment=env,
        )

        agent_list = binder.get_agent_list()
        assert len(agent_list) == 3
        assert agent_list[0]["id"] == 1


class TestGraphEnvironmentBinderNX:
    """Test NetworkX graph binder functionality"""

    def test_initialization_with_graph(self):
        """Test initialization with NetworkX graph"""
        G = nx.Graph()
        G.add_edge(1, 2)
        G.add_edge(2, 3)

        binder = GraphEnvironmentBinderNX(
            id="nx_graph",
            graph=G,
        )

        assert binder.id == "nx_graph"
        assert binder.graph == G

    def test_get_model_dict_with_nx_graph(self):
        """Test getting model dict from NetworkX graph"""
        G = nx.Graph()
        G.add_edge(1, 2)
        G.add_edge(2, 3)

        binder = GraphEnvironmentBinderNX(
            id="nx_graph",
            graph=G,
        )

        model_dict = binder.get_model_dict()
        assert model_dict["id"] == "nx_graph"
        assert model_dict["type"] == "graph"
        assert len(model_dict["edges"]) == 2

    def test_directed_graph(self):
        """Test with directed graph"""
        G = nx.DiGraph()
        G.add_edge(1, 2)
        G.add_edge(2, 3)

        binder = GraphEnvironmentBinderNX(
            id="directed_graph",
            graph=G,
        )

        model_dict = binder.get_model_dict()
        edges = model_dict["edges"]
        # Directed edges should have directed=True
        assert all(edge.get("directed", False) for edge in edges)

    def test_get_agent_list_from_nodes(self):
        """Test getting agents from graph nodes"""
        G = nx.Graph()
        G.add_node(1, x=10, y=20)
        G.add_node(2, x=30, y=40)
        G.add_edge(1, 2)

        binder = GraphEnvironmentBinderNX(
            id="nx_graph",
            graph=G,
        )

        agent_list = binder.get_agent_list()
        assert len(agent_list) == 2
        assert agent_list[0]["id"] == 1

    def test_edge_attributes(self):
        """Test edges with custom attributes"""
        G = nx.Graph()
        G.add_edge(1, 2, weight=5.0, color="red")

        binder = GraphEnvironmentBinderNX(
            id="nx_graph",
            graph=G,
        )

        model_dict = binder.get_model_dict()
        edges = model_dict["edges"]
        assert len(edges) == 1
        assert edges[0]["source"] == 1
        assert edges[0]["target"] == 2


class TestEnvironmentAccessorDicts:
    """Test environment accessor dictionary configurations"""

    def test_grid_environment_with_accessor_dict(self):
        """Test grid environment with accessor dictionary"""

        class GridEnv:
            def __init__(self):
                self.w = 10
                self.h = 15
                self.agents = []

        env = GridEnv()
        binder = GridEnvironmentBinder(
            id="grid_env",
            environment=env,
            environment_accessor={
                "id": "grid_env",
                "width": "w",
                "height": "h",
            },
        )

        model_dict = binder.get_model_dict()
        assert model_dict["width"] == 10
        assert model_dict["height"] == 15

    def test_graph_environment_with_accessor_dict(self):
        """Test graph environment with accessor dictionary"""

        class GraphEnv:
            def __init__(self):
                self.connections = []
                self.agents = []

        env = GraphEnv()
        binder = GraphEnvironmentBinder(
            id="graph_env",
            environment=env,
            environment_accessor={
                "id": "graph_env",
                "edges": "connections",
            },
        )

        model_dict = binder.get_model_dict()
        assert "edges" in model_dict

    def test_agent_accessor_dict(self):
        """Test agent accessor dictionary"""

        class Agent:
            def __init__(self, agent_id, pos_x, pos_y):
                self.agent_id = agent_id
                self.pos_x = pos_x
                self.pos_y = pos_y

        class GridEnv:
            def __init__(self):
                self.width = 10
                self.height = 10
                self.agents = [
                    Agent(1, 5, 5),
                ]

        env = GridEnv()
        binder = GridEnvironmentBinder(
            id="grid_env",
            environment=env,
            agent_accessor={
                "id": "agent_id",
                "x": "pos_x",
                "y": "pos_y",
            },
        )

        agent_list = binder.get_agent_list()
        assert len(agent_list) == 1
        assert agent_list[0]["id"] == 1
        assert agent_list[0]["x"] == 5
        assert agent_list[0]["y"] == 5
