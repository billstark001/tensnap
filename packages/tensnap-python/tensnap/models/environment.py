# tensnap/models/environment.py
"""Environment models for TenSnap simulations"""

from dataclasses import dataclass, field
from typing import (
    Generic,
    Protocol,
    TypeVar,
    Never,
    cast,
    Any,
    Dict,
    Tuple, 
    List,
    Optional,
    Union,
    Literal,
    TypeAlias,
    Callable,
    TypedDict,
    NotRequired,
)
import numpy as np
import networkx as nx
import base64
import io

from .agent import (
    AgentModelDict, 
    GraphAgentModelDict, 
    GridAgentModelDict, 
    UniformAgentModelDict, 
    UniformAgentAccessorDict,
    GridAgentAccessorDict,
    GraphAgentAccessorDict,
    make_graph_agent_accessor_nx, 
    make_grid_agent_accessor, 
    make_uniform_agent_accessor
)


from tensnap.utils.attr import make_dict_accessor

# region Environment Model Dicts
class GraphEdgeDict(TypedDict):
    """Type definition for GraphEdge dictionary representation"""

    source: Union[str, int]
    target: Union[str, int]
    directed: NotRequired[bool]
    style: NotRequired[str]
    width: NotRequired[float]
    color: NotRequired[str]


class PureGridEnvironmentModel(TypedDict):
    """Type definition for pure grid environment model dictionary representation"""

    width: int
    height: int
    background: NotRequired[Optional[str]]  # base64 encoded


class PureGraphEnvironmentModel(TypedDict):
    """Type definition for pure graph environment model dictionary representation"""

    edges: List[GraphEdgeDict]
    

class PureUniformEnvironmentModel(TypedDict):
    """Type definition for pure uniform environment model dictionary representation"""
    pass

PureEnvironmentModel = Union[
    PureUniformEnvironmentModel,
    PureGridEnvironmentModel,
    PureGraphEnvironmentModel,
]


# TypedDicts for accessor parameters
class GridEnvironmentAccessorDict(TypedDict, total=False):
    """Type definition for grid environment accessor parameters"""
    id: str
    width: str
    height: str
    background: Union[str, bool, None]


class GraphEnvironmentAccessorDict(TypedDict, total=False):
    """Type definition for graph environment accessor parameters"""
    id: str
    edges: str


class UniformEnvironmentAccessorDict(TypedDict, total=False):
    """Type definition for uniform environment accessor parameters"""
    id: str


# endregion

# region Accessors


def make_grid_environment_accessor(
    id: str,
    width: str = "width",
    height: str = "height",
    background: str | bool | None = None,
) -> Callable[[Any], PureGridEnvironmentModel]:
    """Create a function that accesses fields from a GridEnvironmentModel"""
    map_fields: Dict[str, str] = {}
    map_fields["width"] = width
    map_fields["height"] = height
    if background is not None and background is not False:
        map_fields["background"] = 'background' if background is True else background
    return make_dict_accessor([], map_fields, {
        "id": id,
        "type": "grid",
    })  # type: ignore

def make_graph_environment_accessor(
    id: str,
    edges: str = "edges",
) -> Callable[[Any], PureGraphEnvironmentModel]:
    """Create a function that accesses fields from a GraphEnvironmentModel"""
    map_fields: Dict[str, str] = {}
    map_fields["edges"] = edges
    return make_dict_accessor([], map_fields, {
        "id": id,
        "type": "graph",
    })  # type: ignore
    
def make_uniform_environment_accessor(
    id: str,
) -> Callable[[Any], PureUniformEnvironmentModel]:
    """Create a function that accesses fields from a UniformEnvironmentModel"""
    map_fields: Dict[str, str] = {}
    return make_dict_accessor([], map_fields, {
        "id": id,
        "type": "uniform",
    })  # type: ignore

def make_graph_edge_accessor_nx(
    directed: bool = False,
    style: str | bool | None = None,
    width: str | bool | None = None,
    color: str | bool | None = None,
):
    """Create a function that accesses fields from a GraphEdge in a NetworkX graph"""
    map_fields: Dict[str, str] = {}
    if style is not None and style is not False:
        map_fields["style"] = 'style' if style is True else style
    if width is not None and width is not False:
        map_fields["width"] = 'width' if width is True else width
    if color is not None and color is not False:
        map_fields["color"] = 'color' if color is True else color

    def f(source: Union[str, int], target: Union[str, int], edge_data: Dict[str, Any]) -> GraphEdgeDict:
        obj: GraphEdgeDict = {
            "source": source,
            "target": target,
            "directed": directed,
        }
        for field, mapped_field in map_fields.items():
            if mapped_field in edge_data:
                obj[field] = edge_data[mapped_field]
        return obj # type: ignore

    return f


# endregion

# region Binders

T = TypeVar("T")
TEnv = TypeVar("TEnv")

class EnvironmentModel(Protocol):
    id: str
    
    def get_model_dict(self) -> Dict[str, Any]:
        ...

    def get_agent_list(self, is_update = True) -> List[Dict[str, Any]]:
        ...

class UniformEnvironmentBinder(Generic[T, TEnv]):

    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_accessor: Union[Callable[[Any], PureUniformEnvironmentModel], UniformEnvironmentAccessorDict, None] = None,
        agent_accessor: Union[Callable[[Any], UniformAgentModelDict], UniformAgentAccessorDict, None] = None,
    ):
        self.id = id
        self.environment = environment
        
        # Handle environment_accessor
        if environment_accessor is None:
            self.environment_accessor = make_uniform_environment_accessor(id=id)
        elif callable(environment_accessor):
            self.environment_accessor = environment_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.environment_accessor = make_uniform_environment_accessor(**environment_accessor)
        
        # Handle agent_accessor
        if agent_accessor is None:
            self.agent_accessor = make_uniform_agent_accessor(id=id)
        elif callable(agent_accessor):
            self.agent_accessor = agent_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.agent_accessor = make_uniform_agent_accessor(**agent_accessor)
        
        self.agents: List[T] = []


    def get_model_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return cast(Dict[str, Any], self.environment_accessor(self.environment))

    def get_agent_list(self, is_update=True) -> List[Dict[str, Any]]:
        ret: List[Dict[str, Any]] = []
        for agent in self.agents:
            agent_dict = cast(Dict[str, Any], self.agent_accessor(agent))
            if is_update:
                agent_dict = {"id": agent_dict["id"], "data": agent_dict}
            ret.append(agent_dict)
        return ret
    
    
    def add_agent(self, agent: T) -> None:
        """Add an agent to the environment"""
        self.agents.append(agent)

    def remove_agent(self, agent: T) -> None:
        """Remove an agent from the environment"""
        self.agents = [a for a in self.agents if a is not agent]

class GridEnvironmentBinder(UniformEnvironmentBinder[T, TEnv]):
    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_accessor: Union[Callable[[Any], PureGridEnvironmentModel], GridEnvironmentAccessorDict, None] = None,
        agent_accessor: Union[Callable[[Any], GridAgentModelDict], GridAgentAccessorDict, None] = None,
    ):
        # Handle environment_accessor
        if environment_accessor is None:
            env_acc = make_grid_environment_accessor(id=id)
        elif callable(environment_accessor):
            env_acc = environment_accessor
        else:
            env_acc = make_grid_environment_accessor(**environment_accessor)
        
        # Handle agent_accessor
        if agent_accessor is None:
            agent_acc = make_grid_agent_accessor()
        elif callable(agent_accessor):
            agent_acc = agent_accessor
        else:
            agent_acc = make_grid_agent_accessor(**agent_accessor)
        
        super().__init__(id, environment, env_acc, agent_acc)

class NXGraphEnvironmentBinder:
    
    def __init__(
        self,
        id: str,
        graph: nx.Graph | nx.DiGraph,
        agent_accessor: Union[Callable[[str | int, Dict[str, Any]], GraphAgentModelDict], GraphAgentAccessorDict, None] = None,
        edge_accessor: Union[Callable[[str | int, str | int, Dict[str, Any]], GraphEdgeDict], None] = None,

    ):
        self.id = id
        self.graph = graph
        self.environment_accessor = make_graph_environment_accessor(id=id)
        
        # Handle agent_accessor
        if agent_accessor is None:
            self.agent_accessor = make_graph_agent_accessor_nx(auto_collect_data=True)
        elif callable(agent_accessor):
            self.agent_accessor = agent_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.agent_accessor = make_graph_agent_accessor_nx(**agent_accessor)
        
        self.edge_accessor = edge_accessor or make_graph_edge_accessor_nx(directed=isinstance(graph, nx.DiGraph))
        
    def get_model_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'type': "graph",
            'edges': [self.edge_accessor(source, target, data) for source, target, data in self.graph.edges(data=True)],
        }

    def get_agent_list(self, is_update=True) -> List[Dict[str, Any]]:
        ret: List[Dict[str, Any]] = []
        for node_id, node_data in self.graph.nodes(data=True):
            agent_dict = cast(Dict[str, Any], self.agent_accessor(node_id, node_data))
            if is_update:
                agent_dict = {"id": agent_dict["id"], "data": agent_dict}
            ret.append(agent_dict)
        return ret

# endregion

