from abc import ABC

from typing import Any, cast, Callable

from tensnap.models.agent import (
    UniformAgentAccessorDict,
    GridAgentAccessorDict,
    GraphAgentAccessorNXDict,
    GraphAgentAccessorDict,
    make_uniform_agent_accessor,
    make_grid_agent_accessor,
    make_graph_agent_accessor_nx,
    make_graph_agent_accessor,
)

from tensnap.models.environment import (
    GridEnvironmentAccessorDict,
    GraphEnvironmentAccessorDict,
    GraphEdgeAccessorNXDict,
    GraphEdgeDict,
    make_uniform_environment_accessor,
    make_grid_environment_accessor,
    make_graph_environment_accessor,
    make_graph_edge_accessor_nx,
)

# region Agent Accessor Bindings


class BindUniformAgentConfig:

    def __init__(
        self,
        id: str = "id",
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        self.accessor_dict: UniformAgentAccessorDict = {
            "id": id,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
        }

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_uniform = self
        return cls

    def get_accessor(self) -> Any:
        return make_uniform_agent_accessor(**self.accessor_dict)


bind_uniform_agent = BindUniformAgentConfig


class BindGridAgentConfig:

    def __init__(
        self,
        id: str = "id",
        x: str = "x",
        y: str = "y",
        heading: str | bool | None = None,
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
        trajectory_length: str | bool | None = None,
        trajectory_color: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GridAgentAccessorDict = {
            "id": id,
            "x": x,
            "y": y,
            "heading": heading,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
            "trajectory_length": trajectory_length,
            "trajectory_color": trajectory_color,
        }

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_grid = self
        return cls

    def get_accessor(self) -> Any:
        return make_grid_agent_accessor(**self.accessor_dict)


bind_grid_agent = BindGridAgentConfig


class BindGraphAgentNXConfig:

    def __init__(
        self,
        x: str | bool | None = None,
        y: str | bool | None = None,
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GraphAgentAccessorNXDict = {
            "x": x,
            "y": y,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
        }

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_graph_nx = self
        return cls

    def get_accessor(self) -> Any:
        return make_graph_agent_accessor_nx(**self.accessor_dict)


bind_graph_agent_nx = BindGraphAgentNXConfig


class BindGraphAgentConfig:

    def __init__(
        self,
        id: str = "id",
        x: str | bool | None = None,
        y: str | bool | None = None,
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GraphAgentAccessorDict = {
            "id": id,
            "x": x,
            "y": y,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
        }

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_graph = self
        return cls

    def get_accessor(self) -> Any:
        return make_graph_agent_accessor(**self.accessor_dict)


bind_graph_agent = BindGraphAgentConfig

# endregion

# region Environment Accessor Bindings


class BindUniformEnvironmentConfig:

    def __init__(
        self,
    ) -> None:
        pass

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_uniform = self
        return cls

    def get_accessor(self, id: str) -> Any:
        return make_uniform_environment_accessor(id=id)


bind_uniform_environment = BindUniformEnvironmentConfig


class BindGridEnvironmentConfig:

    def __init__(
        self,
        width: str = "width",
        height: str = "height",
        coord_offset: str | bool | None = None,
        background: str | bool | None = None,
        trajectory_length: str | bool | None = None,
        trajectory_color: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GridEnvironmentAccessorDict = {
            "id": "id",
            "width": width,
            "height": height,
            "coord_offset": coord_offset,
            "background": background,
            "trajectory_length": trajectory_length,
            "trajectory_color": trajectory_color,
        }

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_grid = self
        return cls

    def get_accessor(self, id: str) -> Any:
        self.accessor_dict["id"] = id
        return make_grid_environment_accessor(**self.accessor_dict)


bind_grid_environment = BindGridEnvironmentConfig


class BindGraphEnvironmentConfig:

    def __init__(
        self,
        edges: str = "edges",
        directed: bool = False,
        style: str | bool | None = None,
        width: str | bool | None = None,
        color: str | bool | None = None,
        edge_accessor: Callable[[Any], "GraphEdgeDict"] | bool = True,
    ) -> None:
        self.accessor_dict: GraphEnvironmentAccessorDict = {
            "id": "id",
            "edges": edges,
        }
        self.edge_accessor_dict: GraphEdgeAccessorNXDict = {
            "directed": directed,
            "style": style,
            "width": width,
            "color": color,
        }
        self.edge_accessor = edge_accessor

    def __call__(self, cls):
        cls._tensnap_bind_accessor_config_graph = self
        return cls

    def get_accessor(self, id: str) -> Any:
        self.accessor_dict["id"] = id
        return make_graph_environment_accessor(**self.accessor_dict)

    def get_edge_accessor(self) -> Any:
        if self.edge_accessor is True:
            # Create a default edge accessor
            return make_graph_edge_accessor_nx(**self.edge_accessor_dict)
        elif self.edge_accessor is False:
            # No edge accessor, return identity function
            return lambda x: x
        else:
            # Use the provided edge accessor
            return self.edge_accessor


bind_graph_environment = BindGraphEnvironmentConfig
