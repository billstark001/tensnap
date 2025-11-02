# tensnap/models/environment.py
"""Environment models for TenSnap simulations"""

from dataclasses import dataclass, field
from typing import (
    cast,
    Any,
    Dict,
    List,
    Optional,
    Union,
    Literal,
    TypeAlias,
    Callable,
    TypedDict,
)
import numpy as np
import networkx as nx
import base64
import io

from .agent import AgentModel, AgentModelDict


class GridEnvironmentModelDict(TypedDict):
    """Type definition for GridEnvironmentModel dictionary representation"""

    id: Union[str, int]
    type: Literal["grid"]
    width: int
    height: int
    agents: List[AgentModelDict]
    background: Optional[str]  # base64 encoded


class GraphNodeDict(TypedDict):
    """Type definition for GraphNode dictionary representation"""

    id: Union[str, int]
    x: Optional[float]
    y: Optional[float]
    color: Optional[str]
    icon: Literal["circle", "square", "triangle"]
    size: float
    data: Dict[str, Any]


class GraphEdgeDict(TypedDict):
    """Type definition for GraphEdge dictionary representation"""

    source: Union[str, int]
    target: Union[str, int]
    directed: bool
    style: Literal["solid", "dashed", "dotted"]
    width: float
    color: Optional[str]


class GraphEnvironmentModelDict(TypedDict):
    """Type definition for GraphEnvironmentModel dictionary representation"""

    id: Union[str, int]
    type: Literal["graph"]
    nodes: List[GraphNodeDict]
    edges: List[GraphEdgeDict]


@dataclass
class GridEnvironmentModel:
    """Grid-based environment model for TenSnap visualization (not simulation logic)"""

    id: Union[str, int]
    width: int
    height: int
    agents: List[AgentModel] = field(default_factory=list)
    background: Optional[np.ndarray] = None
    update_func: Optional[Callable[["GridEnvironmentModel", Any], None]] = field(
        default=None, repr=False
    )
    update_source: Optional[Any] = field(default=None, repr=False)

    def to_dict(self) -> GridEnvironmentModelDict:
        """Convert to dictionary for serialization"""
        result: GridEnvironmentModelDict = {
            "id": self.id,
            "type": "grid",
            "width": self.width,
            "height": self.height,
            "agents": [agent.to_dict() for agent in self.agents],
            "background": None,
        }

        if self.background is not None:
            # Convert numpy array to base64 encoded string
            buffer = io.BytesIO()
            np.save(buffer, self.background)
            result["background"] = base64.b64encode(buffer.getvalue()).decode("utf-8")

        return result

    def update_env_params(self, source: Optional[Any] = None) -> None:
        """Update this model from a real environment instance"""
        actual_source = source if source is not None else self.update_source

        if self.update_func and actual_source is not None:
            self.update_func(self, actual_source)
        elif actual_source is not None:
            # Default update logic - try to copy common attributes
            if hasattr(actual_source, "width"):
                self.width = actual_source.width
            if hasattr(actual_source, "height"):
                self.height = actual_source.height
            if hasattr(actual_source, "background"):
                self.background = actual_source.background

    def update(self) -> List[Dict[str, Any]]:
        """Generate batch updates for all agents in this environment"""
        updates = []
        for agent in self.agents:
            agent.update()  # Update agent from its source
            updates.append(
                {
                    "id": agent.id,
                    "data": {"x": agent.x, "y": agent.y, "heading": agent.heading},
                }
            )
        return updates

    def add_agent(self, agent: AgentModel) -> None:
        """Add an agent to the environment"""
        self.agents.append(agent)

    def remove_agent(self, agent_id: Union[str, int]) -> None:
        """Remove an agent from the environment"""
        self.agents = [a for a in self.agents if a.id != agent_id]

    def get_agent(self, agent_id: Union[str, int]) -> Optional[AgentModel]:
        """Get an agent by ID"""
        for agent in self.agents:
            if agent.id == agent_id:
                return agent
        return None


@dataclass
class GraphNode:
    """Node in a graph environment"""

    id: Union[str, int]
    x: Optional[float] = None
    y: Optional[float] = None
    color: Optional[str] = None
    icon: Literal["circle", "square", "triangle"] = "circle"
    size: float = 10
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> GraphNodeDict:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "color": self.color,
            "icon": self.icon,
            "size": self.size,
            "data": self.data,
        }


@dataclass
class GraphEdge:
    """Edge in a graph environment"""

    source: Union[str, int]
    target: Union[str, int]
    directed: bool = False
    style: Literal["solid", "dashed", "dotted"] = "solid"
    width: float = 1
    color: Optional[str] = None

    def to_dict(self) -> GraphEdgeDict:
        return {
            "source": self.source,
            "target": self.target,
            "directed": self.directed,
            "style": self.style,
            "width": self.width,
            "color": self.color,
        }


@dataclass
class GraphEnvironmentModel:
    """Graph-based environment model for TenSnap visualization (not simulation logic)"""

    id: Union[str, int]
    nodes: List[GraphNode] = field(default_factory=list)
    edges: List[GraphEdge] = field(default_factory=list)
    update_func: Optional[Callable[["GraphEnvironmentModel", Any], None]] = field(
        default=None, repr=False
    )
    update_source: Optional[Any] = field(default=None, repr=False)

    def to_dict(self) -> GraphEnvironmentModelDict:
        """Convert to dictionary for serialization"""
        return {
            "id": self.id,
            "type": "graph",
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
        }

    def update(self, source: Optional[Any] = None) -> Dict[str, Any]:
        """Update this model from a real environment instance"""
        actual_source = source if source is not None else self.update_source

        if self.update_func and actual_source is not None:
            self.update_func(self, actual_source)
        elif actual_source is not None:
            # Default update logic - try to copy common attributes
            if hasattr(actual_source, "graph") and hasattr(actual_source.graph, "nodes"):
                # Update from NetworkX graph
                self.update_from_networkx(actual_source.graph)
            elif hasattr(actual_source, "nodes") and hasattr(actual_source, "edges"):
                # Update from another GraphEnvironmentModel
                self.nodes = actual_source.nodes.copy() if hasattr(actual_source.nodes, 'copy') else list(actual_source.nodes)
                self.edges = actual_source.edges.copy() if hasattr(actual_source.edges, 'copy') else list(actual_source.edges)

        return cast(Dict[str, Any], self.to_dict())

    def from_networkx(self, graph: nx.Graph) -> None:
        """Import from NetworkX graph"""
        self.nodes = []
        self.edges = []

        for node_id, node_data in graph.nodes(data=True):
            node = GraphNode(
                id=node_id,
                x=node_data.get("x"),
                y=node_data.get("y"),
                color=node_data.get("color"),
                icon=node_data.get("icon", "circle"),
                size=node_data.get("size", 10),
                data={
                    k: v
                    for k, v in node_data.items()
                    if k not in ["x", "y", "color", "icon", "size"]
                },
            )
            self.nodes.append(node)

        for source, target, edge_data in graph.edges(data=True):
            edge = GraphEdge(
                source=source,
                target=target,
                directed=isinstance(graph, nx.DiGraph),
                style=edge_data.get("style", "solid"),
                width=edge_data.get("width", 1),
                color=edge_data.get("color"),
            )
            self.edges.append(edge)

    def update_from_networkx(self, graph: nx.Graph) -> None:
        """Update existing nodes/edges from NetworkX graph, more efficient than from_networkx"""
        # Create lookup dictionaries for existing nodes and edges
        existing_nodes = {node.id: node for node in self.nodes}
        existing_edges = {(edge.source, edge.target): edge for edge in self.edges}
        
        # Update or create nodes
        new_nodes = []
        for node_id, node_data in graph.nodes(data=True):
            if node_id in existing_nodes:
                # Update existing node
                node = existing_nodes[node_id]
                node.x = node_data.get("x", node.x)
                node.y = node_data.get("y", node.y) 
                node.color = node_data.get("color", node.color)
                node.icon = node_data.get("icon", node.icon)
                node.size = node_data.get("size", node.size)
                node.data.update({
                    k: v
                    for k, v in node_data.items()
                    if k not in ["x", "y", "color", "icon", "size"]
                })
            else:
                # Create new node
                node = GraphNode(
                    id=node_id,
                    x=node_data.get("x"),
                    y=node_data.get("y"),
                    color=node_data.get("color"),
                    icon=node_data.get("icon", "circle"),
                    size=node_data.get("size", 10),
                    data={
                        k: v
                        for k, v in node_data.items()
                        if k not in ["x", "y", "color", "icon", "size"]
                    },
                )
            new_nodes.append(node)
        self.nodes = new_nodes
        
        # Update or create edges
        new_edges = []
        for source, target, edge_data in graph.edges(data=True):
            edge_key = (source, target)
            if edge_key in existing_edges:
                # Update existing edge
                edge = existing_edges[edge_key]
                edge.style = edge_data.get("style", edge.style)
                edge.width = edge_data.get("width", edge.width)
                edge.color = edge_data.get("color", edge.color)
            else:
                # Create new edge
                edge = GraphEdge(
                    source=source,
                    target=target,
                    directed=isinstance(graph, nx.DiGraph),
                    style=edge_data.get("style", "solid"),
                    width=edge_data.get("width", 1),
                    color=edge_data.get("color"),
                )
            new_edges.append(edge)
        self.edges = new_edges


# Type alias for environments
EnvironmentModel: TypeAlias = Union[GraphEnvironmentModel, GridEnvironmentModel]
