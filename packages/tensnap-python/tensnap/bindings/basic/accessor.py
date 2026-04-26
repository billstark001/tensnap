from collections.abc import Callable
from typing import Any, cast

from tensnap.models.agent import (
    AgentAccessorDict,
    GraphAgentAccessorDict,
    GraphAgentAccessorNXDict,
    GraphAgentModelDict,
    GridAgentAccessorDict,
    UniformAgentAccessorDict,
    make_agent_accessor,
    make_graph_agent_accessor,
    make_graph_agent_accessor_nx,
    make_grid_agent_accessor,
    make_uniform_agent_accessor,
)
from tensnap.models.environment import (
    EnvironmentBindingBuilder,
    EnvironmentBindingConfig,
    GraphEdgeAccessorNXDict,
    GraphEdgeDict,
    GraphEnvironmentAccessorDict,
    GridEnvironmentAccessorDict,
    LayerBinding,
    make_graph_edge_accessor_nx,
    make_graph_environment_accessor,
    make_grid_environment_accessor,
    make_uniform_environment_accessor,
)
from tensnap.utils.attr import make_dict_accessor, make_identifier_getter

__all__ = [
    "Bind2DEnvironmentConfig",
    "BindAgentConfig",
    "BindAgentLayerConfig",
    "BindEdgeLayerConfig",
    "BindGraphAgentConfig",
    "BindGraphAgentNXConfig",
    "BindGraphEnvironmentConfig",
    "BindGridAgentConfig",
    "BindGridEnvironmentConfig",
    "BindGridLayerConfig",
    "BindLayerConfig",
    "BindTrajectoryLayerConfig",
    "BindUniformAgentConfig",
    "BindUniformEnvironmentConfig",
    "EnvironmentBindingBuilder",
    "GraphAgentAccessorDict",
    "GraphAgentAccessorNXDict",
    "GraphEdgeAccessorNXDict",
    "GraphEdgeDict",
    "GraphEnvironmentAccessorDict",
    "GridAgentAccessorDict",
    "GridEnvironmentAccessorDict",
    "UniformAgentAccessorDict",
    "bind_2d_env",
    "bind_agent",
    "bind_agent_layer",
    "bind_edge_layer",
    "bind_graph_agent",
    "bind_graph_agent_nx",
    "bind_graph_environment",
    "bind_grid_agent",
    "bind_grid_environment",
    "bind_grid_layer",
    "bind_layer",
    "bind_trajectory_layer",
    "bind_uniform_agent",
    "bind_uniform_environment",
]


def _make_metadata_accessor(
    metadata_accessor: Callable[[Any], dict[str, Any]] | dict[str, str] | None,
) -> Callable[[Any], dict[str, Any]] | None:
    if metadata_accessor is None:
        return None
    if callable(metadata_accessor):
        return metadata_accessor
    return make_dict_accessor([], metadata_accessor, {})


def _make_iterable_accessor(
    item_iterable_accessor: str | bool | Callable[[Any], Any] | None,
    default_name: str,
) -> Callable[[Any], Any] | None:
    if item_iterable_accessor is None or item_iterable_accessor is False:
        return None
    if callable(item_iterable_accessor):
        return item_iterable_accessor
    getter = make_identifier_getter(
        default_name if item_iterable_accessor is True else item_iterable_accessor
    )

    def iterable_accessor(target: Any) -> Any:
        value = getter(target)
        return value() if callable(value) else value

    return iterable_accessor


def _append_layer_binding(cls: type[Any], binding: LayerBinding) -> type[Any]:
    bindings = list(getattr(cls, "_tensnap_layer_binding_configs", []))
    bindings.append(binding)
    cls._tensnap_layer_binding_configs = bindings
    return cls

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

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_uniform = self
        return cls

    def get_accessor(self) -> Callable[[Any], dict[str, Any]]:
        return cast(
            Callable[[Any], dict[str, Any]],
            make_uniform_agent_accessor(**self.accessor_dict),
        )


bind_uniform_agent = BindUniformAgentConfig


class BindAgentConfig:

    def __init__(
        self,
        id: str = "id",
        x: str | bool | None = None,
        y: str | bool | None = None,
        heading: str | bool | None = None,
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        self.accessor_dict: AgentAccessorDict = {
            "id": id,
            "x": x,
            "y": y,
            "heading": heading,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
        }

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_item = self
        return cls

    def get_accessor(self) -> Callable[[Any], dict[str, Any]]:
        return cast(
            Callable[[Any], dict[str, Any]],
            make_agent_accessor(**self.accessor_dict),
        )


bind_agent = BindAgentConfig


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
        }

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_grid = self
        return cls

    def get_accessor(self) -> Callable[[Any], dict[str, Any]]:
        return cast(
            Callable[[Any], dict[str, Any]],
            make_grid_agent_accessor(**self.accessor_dict),
        )


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

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_graph_nx = self
        return cls

    def get_accessor(
        self,
    ) -> Callable[[str | int, dict[str, Any]], GraphAgentModelDict]:
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

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_graph = self
        return cls

    def get_accessor(self) -> Callable[[Any], dict[str, Any]]:
        return cast(
            Callable[[Any], dict[str, Any]],
            make_graph_agent_accessor(**self.accessor_dict),
        )


bind_graph_agent = BindGraphAgentConfig

# endregion

# region Environment Accessor Bindings


class BindUniformEnvironmentConfig:

    def __init__(
        self,
    ) -> None:
        pass

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_uniform = self
        return cls

    def get_accessor(self, id: str) -> Callable[[Any], dict[str, Any]]:
        return cast(
            Callable[[Any], dict[str, Any]],
            make_uniform_environment_accessor(id=id),
        )


bind_uniform_environment = BindUniformEnvironmentConfig


class Bind2DEnvironmentConfig:

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_environment_binding_config = EnvironmentBindingConfig(
            environment_type="2d"
        )
        return cls


bind_2d_env = Bind2DEnvironmentConfig


class BindLayerConfig:

    def __init__(
        self,
        layer_id: str,
        layer_type: str,
        *,
        metadata_accessor:
        Callable[[Any], dict[str, Any]] | dict[str, str] | None = None,
        metadata: dict[str, Any] | None = None,
        item_iterable_accessor: str | bool | Callable[[Any], Any] | None = None,
        item_accessor: Callable[[Any], dict[str, Any]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> None:
        default_iterable_name = {
            "agent": "agents",
            "edge": "edges",
        }.get(layer_type, layer_id)
        self.binding = LayerBinding(
            layer_id=layer_id,
            layer_type=layer_type,
            metadata_accessor=_make_metadata_accessor(metadata_accessor),
            metadata=dict(metadata or {}),
            item_iterable_accessor=_make_iterable_accessor(
                item_iterable_accessor,
                default_iterable_name,
            ),
            item_accessor=item_accessor,
            dependency_layer_ids=dict(dependency_layer_ids or {}),
        )

    def __call__(self, cls: type[Any]) -> type[Any]:
        return _append_layer_binding(cls, self.binding)


bind_layer = BindLayerConfig


class BindAgentLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "agents",
        *,
        metadata_accessor:
        Callable[[Any], dict[str, Any]] | dict[str, str] | None = None,
        metadata: dict[str, Any] | None = None,
        item_iterable_accessor: str | bool | Callable[[Any], Any] | None = "agents",
        item_accessor:
        Callable[[Any], dict[str, Any]] | AgentAccessorDict | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> None:
        compiled_item_accessor = (
            cast(Callable[[Any], dict[str, Any]], make_agent_accessor(**item_accessor))
            if isinstance(item_accessor, dict)
            else item_accessor
        )
        super().__init__(
            layer_id,
            "agent",
            metadata_accessor=metadata_accessor,
            metadata=metadata,
            item_iterable_accessor=item_iterable_accessor,
            item_accessor=compiled_item_accessor,
            dependency_layer_ids=dependency_layer_ids,
        )


bind_agent_layer = BindAgentLayerConfig


class BindGridLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "grid",
        *,
        width: str = "width",
        height: str = "height",
        coord_offset: str | bool | None = None,
        background: str | bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        raw_accessor = make_grid_environment_accessor(
            id="_grid_layer",
            width=width,
            height=height,
            coord_offset=coord_offset,
            background=background,
        )

        def metadata_accessor(environment: Any) -> dict[str, Any]:
            return {
                key: value
                for key, value in raw_accessor(environment).items()
                if key not in ("id", "type")
            }

        super().__init__(
            layer_id,
            "grid",
            metadata_accessor=metadata_accessor,
            metadata=metadata,
        )


bind_grid_layer = BindGridLayerConfig


class BindEdgeLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "edges",
        *,
        metadata_accessor:
        Callable[[Any], dict[str, Any]] | dict[str, str] | None = None,
        metadata: dict[str, Any] | None = None,
        item_iterable_accessor: str | bool | Callable[[Any], Any] | None = "edges",
        edge_accessor:
        Callable[[Any], GraphEdgeDict] | GraphEdgeAccessorNXDict | bool = True,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> None:
        compiled_item_accessor: Callable[[Any], dict[str, Any]] | None
        if edge_accessor is True:
            compiled_item_accessor = cast(
                Callable[[Any], dict[str, Any]],
                make_graph_edge_accessor_nx(),
            )
        elif edge_accessor is False:
            compiled_item_accessor = None
        elif isinstance(edge_accessor, dict):
            compiled_item_accessor = cast(
                Callable[[Any], dict[str, Any]],
                make_graph_edge_accessor_nx(**edge_accessor),
            )
        else:
            compiled_item_accessor = cast(
                Callable[[Any], dict[str, Any]],
                edge_accessor,
            )

        super().__init__(
            layer_id,
            "edge",
            metadata_accessor=metadata_accessor,
            metadata=metadata,
            item_iterable_accessor=item_iterable_accessor,
            item_accessor=compiled_item_accessor,
            dependency_layer_ids=dependency_layer_ids or {"agent": "agents"},
        )


bind_edge_layer = BindEdgeLayerConfig


class BindTrajectoryLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "trails",
        *,
        metadata_accessor:
        Callable[[Any], dict[str, Any]] | dict[str, str] | None = None,
        metadata: dict[str, Any] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            layer_id,
            "trajectory",
            metadata_accessor=metadata_accessor,
            metadata=metadata,
            dependency_layer_ids=dependency_layer_ids or {"agent": "agents"},
        )


bind_trajectory_layer = BindTrajectoryLayerConfig


class BindGridEnvironmentConfig:

    def __init__(
        self,
        width: str = "width",
        height: str = "height",
        coord_offset: str | bool | None = None,
        background: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GridEnvironmentAccessorDict = {
            "id": "id",
            "width": width,
            "height": height,
            "coord_offset": coord_offset,
            "background": background,
        }

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_grid = self
        return cls

    def get_accessor(self, id: str) -> Callable[[Any], dict[str, Any]]:
        self.accessor_dict["id"] = id
        return cast(
            Callable[[Any], dict[str, Any]],
            make_grid_environment_accessor(**self.accessor_dict),
        )


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

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_bind_accessor_config_graph = self
        return cls

    def get_accessor(self, id: str) -> Callable[[Any], dict[str, Any]]:
        self.accessor_dict["id"] = id
        return cast(
            Callable[[Any], dict[str, Any]],
            make_graph_environment_accessor(**self.accessor_dict),
        )

    def get_edge_accessor(self) -> Callable[[Any], GraphEdgeDict]:
        if self.edge_accessor is True:
            # Create a default edge accessor
            return cast(
                Callable[[Any], GraphEdgeDict],
                make_graph_edge_accessor_nx(**self.edge_accessor_dict),
            )
        elif self.edge_accessor is False:
            # No edge accessor, return identity function
            return lambda x: cast(GraphEdgeDict, x)
        else:
            # Use the provided edge accessor
            return self.edge_accessor


bind_graph_environment = BindGraphEnvironmentConfig
