

# tensnap/models.py
"""Data models for TenSnap"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union, Literal, Callable, TypeAlias
import numpy as np
import networkx as nx


@dataclass
class Agent:
    """Agent in the simulation"""
    id: Union[str, int]
    x: float = 0
    y: float = 0
    heading: float = 0
    color: Optional[str] = None
    icon: Literal["arrow", "circle", "square", "triangle"] = "circle"
    size: float = 10
    data: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "heading": self.heading,
            "color": self.color,
            "icon": self.icon,
            "size": self.size,
            "data": self.data
        }


@dataclass
class GridEnvironment:
    """Grid-based environment"""
    id: Union[str, int]
    width: int
    height: int
    agents: List[Agent] = field(default_factory=list)
    background: Optional[np.ndarray] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        result = {
            "id": self.id,
            "type": "grid",
            "width": self.width,
            "height": self.height,
            "agents": [agent.to_dict() for agent in self.agents]
        }
        
        if self.background is not None:
            # Convert numpy array to base64 encoded npy format
            import io
            buffer = io.BytesIO()
            np.save(buffer, self.background)
            result["background"] = buffer.getvalue().hex()
            
        return result
        
    def add_agent(self, agent: Agent) -> None:
        """Add an agent to the environment"""
        self.agents.append(agent)
        
    def remove_agent(self, agent_id: Union[str, int]) -> None:
        """Remove an agent from the environment"""
        self.agents = [a for a in self.agents if a.id != agent_id]
        
    def get_agent(self, agent_id: Union[str, int]) -> Optional[Agent]:
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
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "color": self.color,
            "icon": self.icon,
            "size": self.size,
            "data": self.data
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
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "target": self.target,
            "directed": self.directed,
            "style": self.style,
            "width": self.width,
            "color": self.color
        }


@dataclass
class GraphEnvironment:
    """Graph-based environment"""
    id: Union[str, int]
    nodes: List[GraphNode] = field(default_factory=list)
    edges: List[GraphEdge] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "id": self.id,
            "type": "graph",
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges]
        }
        
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
                data={k: v for k, v in node_data.items() 
                      if k not in ["x", "y", "color", "icon", "size"]}
            )
            self.nodes.append(node)
            
        for source, target, edge_data in graph.edges(data=True):
            edge = GraphEdge(
                source=source,
                target=target,
                directed=isinstance(graph, nx.DiGraph),
                style=edge_data.get("style", "solid"),
                width=edge_data.get("width", 1),
                color=edge_data.get("color")
            )
            self.edges.append(edge)


@dataclass
class Parameter:
    """Simulation parameter"""
    id: str
    type: Literal["slider", "enum", "button"]
    label: str
    value: Optional[Union[float, str]] = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[List[str]] = None
    setter: Optional[Callable] = None
    getter: Optional[Callable] = None
    action: Optional[str] = None


@dataclass
class Chart:
    """Chart configuration"""
    id: str
    label: str
    getter: Callable
    color: Optional[str] = None
    data: List[Dict[str, float]] = field(default_factory=list)


Environment: TypeAlias = Union[GraphEnvironment, GridEnvironment]