# tensnap/models/environment.py
"""Environment models for TenSnap simulations"""

from collections.abc import Callable
from typing import (
    TypeAlias,
    Any,
    Generic,
    NotRequired,
    Protocol,
    TypedDict,
    TypeVar,
    Union,
    cast,
    Tuple,
    Dict,
)

import networkx as nx

from tensnap.utils.attr import make_dict_accessor

from .agent import (
    GraphAgentAccessorNXDict,
    GraphAgentAccessorDict,
    GraphAgentModelDict,
    GridAgentAccessorDict,
    GridAgentModelDict,
    UniformAgentAccessorDict,
    UniformAgentModelDict,
    make_graph_agent_accessor,
    make_graph_agent_accessor_nx,
    make_grid_agent_accessor,
    make_uniform_agent_accessor,
)


# region Environment Model Dicts
class GraphEdgeDict(TypedDict):
    """Type definition for GraphEdge dictionary representation"""

    source: str | int
    target: str | int
    directed: NotRequired[bool]
    style: NotRequired[str]
    width: NotRequired[float]
    color: NotRequired[str]


class PureGridEnvironmentModel(TypedDict):
    """Type definition for pure grid environment model dictionary representation"""

    width: int
    height: int
    background: NotRequired[str | None]  # base64 encoded


class PureGraphEnvironmentModel(TypedDict):
    """Type definition for pure graph environment model dictionary representation"""

    edges: list[GraphEdgeDict]


class PureUniformEnvironmentModel(TypedDict):
    """Type definition for pure uniform environment model dictionary representation"""

    pass


PureEnvironmentModel = Union[
    PureUniformEnvironmentModel,
    PureGridEnvironmentModel,
    PureGraphEnvironmentModel,
]


class UniformEnvironmentAccessorDict(TypedDict):
    """Type definition for uniform environment accessor parameters"""

    id: str


# TypedDicts for accessor parameters
class GridEnvironmentAccessorDict(UniformEnvironmentAccessorDict):
    """Type definition for grid environment accessor parameters"""

    id: str
    width: str
    height: str
    background: NotRequired[str | bool | None]


class GraphEnvironmentAccessorDict(UniformEnvironmentAccessorDict):
    """Type definition for graph environment accessor parameters"""

    id: str
    edges: str


class GraphEdgeAccessorNXDict(TypedDict):
    """Type definition for graph edge accessor parameters"""

    directed: NotRequired[bool]
    style: NotRequired[str | bool | None]
    width: NotRequired[str | bool | None]
    color: NotRequired[str | bool | None]


# endregion

# region Accessors


def make_grid_environment_accessor(
    id: str,
    width: str = "width",
    height: str = "height",
    background: str | bool | None = None,
) -> Callable[[Any], PureGridEnvironmentModel]:
    """Create a function that accesses fields from a GridEnvironmentModel"""
    map_fields: dict[str, str] = {}
    map_fields["width"] = width
    map_fields["height"] = height
    if background is not None and background is not False:
        map_fields["background"] = "background" if background is True else background
    return make_dict_accessor(
        [],
        map_fields,
        {
            "id": id,
            "type": "grid",
        },
    )  # type: ignore


def make_graph_environment_accessor(
    id: str,
    edges: str = "edges",
) -> Callable[[Any], PureGraphEnvironmentModel]:
    """Create a function that accesses fields from a GraphEnvironmentModel"""
    map_fields: dict[str, str] = {}
    map_fields["edges"] = edges
    return make_dict_accessor(
        [],
        map_fields,
        {
            "id": id,
            "type": "graph",
        },
    )  # type: ignore


def make_uniform_environment_accessor(
    id: str,
) -> Callable[[Any], PureUniformEnvironmentModel]:
    """Create a function that accesses fields from a UniformEnvironmentModel"""
    map_fields: dict[str, str] = {}
    return make_dict_accessor(
        [],
        map_fields,
        {
            "id": id,
            "type": "uniform",
        },
    )  # type: ignore


NXEdge: TypeAlias = Tuple[str | int, str | int, Dict[str, Any]]


def make_graph_edge_accessor_nx(
    directed: bool = False,
    style: str | bool | None = None,
    width: str | bool | None = None,
    color: str | bool | None = None,
):
    """Create a function that accesses fields from a GraphEdge in a NetworkX graph"""
    map_fields: dict[str, str] = {}
    if style is not None and style is not False:
        map_fields["style"] = "style" if style is True else style
    if width is not None and width is not False:
        map_fields["width"] = "width" if width is True else width
    if color is not None and color is not False:
        map_fields["color"] = "color" if color is True else color

    def f(edge: NXEdge) -> GraphEdgeDict:
        source, target, edge_data = edge
        obj: GraphEdgeDict = {
            "source": source,
            "target": target,
            "directed": directed,
        }
        for field, mapped_field in map_fields.items():
            if mapped_field in edge_data:
                obj[field] = edge_data[mapped_field]
        return obj  # type: ignore

    return f


# endregion

# region Binders

T = TypeVar("T")
TEnv = TypeVar("TEnv")
TEdge = TypeVar("TEdge")


class EnvironmentBinderProtocol(Protocol):
    id: str

    def get_model_dict(self) -> dict[str, Any]: ...

    def get_agent_list(self, is_update=True) -> list[dict[str, Any]]: ...


class BindAccessorConfigProtocol(Protocol):
    def get_accessor(self) -> Callable[[Any], Any]: ...


class BindAccessorConfigWithIdProtocol(Protocol):
    def get_accessor(self, id: str) -> Callable[[Any], Any]: ...


class UniformEnvironmentBinder(Generic[T, TEnv]):

    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_accessor: (
            Callable[[Any], PureUniformEnvironmentModel]
            | UniformEnvironmentAccessorDict
            | None
        ) = None,
        agent_accessor: (
            Callable[[Any], UniformAgentModelDict] | UniformAgentAccessorDict | None
        ) = None,
    ):
        self.id = id
        self.environment = environment

        # Handle environment_accessor
        if environment_accessor is None:
            self.environment_accessor = self._get_environment_accessor(environment)
        elif callable(environment_accessor):
            self.environment_accessor = environment_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.environment_accessor = make_uniform_environment_accessor(
                **environment_accessor
            )

        # Handle agent_accessor
        if agent_accessor is None:
            self.agent_accessor = None
        elif callable(agent_accessor):
            self.agent_accessor = agent_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.agent_accessor = make_uniform_agent_accessor(**agent_accessor)

        self.agents: list[T] = []

    def get_model_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization"""
        return cast(dict[str, Any], self.environment_accessor(self.environment))

    def get_agent_list(self, is_update=True) -> list[dict[str, Any]]:
        if not self.agents:
            return []
        assert self.agent_accessor is not None, "Agent accessor is not defined"
        ret: list[dict[str, Any]] = []
        for agent in self.agents:
            agent_dict = cast(dict[str, Any], self.agent_accessor(agent))
            if is_update:
                agent_dict = {"id": agent_dict["id"], "data": agent_dict}
            ret.append(agent_dict)
        return ret

    def _get_config_key(self, env: TEnv) -> str:
        return "_tensnap_bind_accessor_config_uniform"

    def _get_agent_config_key(self, agent: T) -> str:
        return "_tensnap_bind_accessor_config_uniform"

    def _get_default_agent_accessor(self):
        return make_uniform_agent_accessor(id="id")

    def _get_default_environment_accessor(self):
        return make_uniform_environment_accessor(id=self.id)

    def _get_environment_accessor(self, env: TEnv):
        cfg_key = self._get_config_key(env)
        if hasattr(env, cfg_key):
            accessor_config = cast(
                BindAccessorConfigWithIdProtocol, getattr(env, cfg_key)
            )
            return accessor_config.get_accessor(self.id)
        return self._get_default_environment_accessor()

    def add_agent(self, agent: T) -> None:
        """Add an agent to the environment"""
        self.agents.append(agent)

        if self.agent_accessor is None:
            cfg_key = self._get_agent_config_key(agent)
            if hasattr(agent, cfg_key):
                accessor_config = cast(
                    BindAccessorConfigProtocol, getattr(agent, cfg_key)
                )
                self.agent_accessor = accessor_config.get_accessor()
            else:
                self.agent_accessor = self._get_default_agent_accessor()

    def remove_agent(self, agent: T) -> None:
        """Remove an agent from the environment"""
        self.agents = [a for a in self.agents if a is not agent]

    def clear_agents(self) -> None:
        """Clear all agents from the environment"""
        self.agents = []

    def set_environment(self, environment: TEnv) -> None:
        """Set the environment object"""
        self.environment = environment


class GridEnvironmentBinder(UniformEnvironmentBinder[T, TEnv]):
    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_accessor: (
            Callable[[Any], PureGridEnvironmentModel]
            | GridEnvironmentAccessorDict
            | None
        ) = None,
        agent_accessor: (
            Callable[[Any], GridAgentModelDict] | GridAgentAccessorDict | None
        ) = None,
    ):
        # Handle environment_accessor
        if environment_accessor is None:
            env_acc = None
        elif callable(environment_accessor):
            env_acc = environment_accessor
        else:
            env_acc = make_grid_environment_accessor(**environment_accessor)

        # Handle agent_accessor
        if agent_accessor is None:
            agent_acc = None
        elif callable(agent_accessor):
            agent_acc = agent_accessor
        else:
            agent_acc = make_grid_agent_accessor(**agent_accessor)

        super().__init__(id, environment, env_acc, agent_acc)

    def _get_config_key(self, env: TEnv) -> str:
        return "_tensnap_bind_accessor_config_grid"

    def _get_agent_config_key(self, agent: T) -> str:
        return "_tensnap_bind_accessor_config_grid"

    def _get_default_agent_accessor(self):
        return make_grid_agent_accessor(id="id")

    def _get_default_environment_accessor(self):
        return make_grid_environment_accessor(id=self.id)


class GraphEnvironmentBinder(UniformEnvironmentBinder[T, TEnv]):
    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_accessor: (
            Callable[[Any], PureGraphEnvironmentModel]
            | GraphEnvironmentAccessorDict
            | None
        ) = None,
        agent_accessor: (
            Callable[[Any], GraphAgentModelDict] | GraphAgentAccessorDict | None
        ) = None,
        edge_accessor: (
            Callable[[Any], GraphEdgeDict] | GraphEdgeAccessorNXDict | None
        ) = None,
    ):
        # Handle environment_accessor
        if environment_accessor is None:
            env_acc = None
        elif callable(environment_accessor):
            env_acc = environment_accessor
        else:
            env_acc = make_graph_environment_accessor(**environment_accessor)

        # Handle agent_accessor
        if agent_accessor is None:
            agent_acc = None
        elif callable(agent_accessor):
            agent_acc = agent_accessor
        else:
            agent_acc = make_graph_agent_accessor(**agent_accessor)

        # Handle edge_accessor
        self.is_nx_edge_accessor = False
        if edge_accessor is None:
            # Get from config or use default
            self.edge_accessor = self._get_edge_accessor(environment)
        elif callable(edge_accessor):
            self.is_nx_edge_accessor = False
            self.edge_accessor = edge_accessor
        else:
            self.is_nx_edge_accessor = True
            self.edge_accessor = make_graph_edge_accessor_nx(**edge_accessor)

        super().__init__(id, environment, env_acc, agent_acc)

    def _get_config_key(self, env: TEnv) -> str:
        return "_tensnap_bind_accessor_config_graph"

    def _get_agent_config_key(self, agent: T) -> str:
        return "_tensnap_bind_accessor_config_graph"

    def _get_default_agent_accessor(self):
        return make_graph_agent_accessor(id="id")

    def _get_default_environment_accessor(self):
        return make_graph_environment_accessor(id=self.id)

    def get_model_dict(self) -> dict[str, Any]:
        model_dict = super().get_model_dict()
        model_edges = model_dict.get("edges", None)
        if self.is_nx_edge_accessor:
            if isinstance(model_edges, nx.classes.reportviews.EdgeView):
                model_dict["edges"] = [self.edge_accessor(x) for x in model_edges(data=True)]
        elif model_edges:
            model_dict["edges"] = [self.edge_accessor(x) for x in model_edges]
        return model_dict

    def _get_edge_accessor(self, env: TEnv):
        cfg_key = self._get_config_key(env)
        if hasattr(env, cfg_key):
            accessor_config = getattr(env, cfg_key)
            if hasattr(accessor_config, "get_edge_accessor"):
                if hasattr(accessor_config, "edge_accessor") and accessor_config.edge_accessor is True:
                    self.is_nx_edge_accessor = True
                else:
                    self.is_nx_edge_accessor = False
                return accessor_config.get_edge_accessor()
        self.is_nx_edge_accessor = True
        return make_graph_edge_accessor_nx()


class GraphEnvironmentBinderNX:

    def __init__(
        self,
        id: str,
        graph: nx.Graph | nx.DiGraph,
        agent_accessor: (
            Callable[[str | int, dict[str, Any]], GraphAgentModelDict]
            | GraphAgentAccessorNXDict
            | None
        ) = None,
        edge_accessor: (
            Callable[[NXEdge], GraphEdgeDict] | GraphEdgeAccessorNXDict | None
        ) = None,
    ):
        self.id = id
        self.graph = graph
        self.environment_accessor = make_graph_environment_accessor(id=id)

        # Handle agent_accessor
        if agent_accessor is None:
            self.agent_accessor = make_graph_agent_accessor_nx()
        elif callable(agent_accessor):
            self.agent_accessor = agent_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.agent_accessor = make_graph_agent_accessor_nx(**agent_accessor)

        if edge_accessor is None:
            self.edge_accessor = make_graph_edge_accessor_nx(
                directed=isinstance(graph, nx.DiGraph)
            )
        elif callable(edge_accessor):
            self.edge_accessor = edge_accessor
        else:
            # It's a TypedDict, create accessor from it
            self.edge_accessor = make_graph_edge_accessor_nx(**edge_accessor)

    def get_model_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": "graph",
            "edges": [self.edge_accessor(x) for x in self.graph.edges(data=True)],
        }

    def get_agent_list(self, is_update=True) -> list[dict[str, Any]]:
        ret: list[dict[str, Any]] = []
        for node_id, node_data in self.graph.nodes(data=True):
            agent_dict = cast(dict[str, Any], self.agent_accessor(node_id, node_data))
            if is_update:
                agent_dict = {"id": agent_dict["id"], "data": agent_dict}
            ret.append(agent_dict)
        return ret


# endregion
