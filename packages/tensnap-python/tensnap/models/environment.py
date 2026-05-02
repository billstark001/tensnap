"""Environment models for TenSnap simulations"""

from collections.abc import Callable
from dataclasses import dataclass, field
import inspect
from typing import (
    Any,
    Generic,
    Literal,
    Protocol,
    TypeAlias,
    TypedDict,
    TypeVar,
    cast,
)

from typing_extensions import NotRequired

from tensnap.models.layer import LayerBinding
from tensnap.utils.attr import (
    make_attr_projector,
    make_attr_getter,
)

from .agent import (
    UniformAgentProjectorDict,
    UniformAgentModelDict,
)

# region Environment Model Dicts
CanonicalEnvironmentType: TypeAlias = Literal["uniform", "2d"]


class GraphEdgeDict(TypedDict):
    """Type definition for GraphEdge dictionary representation"""

    source: str | int
    target: str | int
    directed: NotRequired[bool]
    style: NotRequired[str]
    width: NotRequired[float]
    color: NotRequired[str]


class EnvironmentLayerState(TypedDict):
    """Canonical v0.2 layer-oriented environment state."""

    layer_id: str
    layer_type: str
    dependency_layer_ids: NotRequired[dict[str, str]]
    data: NotRequired[dict[str, Any]]
    items: NotRequired[list[dict[str, Any]]]
    agents: NotRequired[list[dict[str, Any]]]
    edges: NotRequired[list[GraphEdgeDict]]


class EnvironmentState(TypedDict):
    """Canonical v0.2 environment state."""

    id: str
    type: CanonicalEnvironmentType
    layers: list[EnvironmentLayerState]


GridEnvironmentCoordOffset: TypeAlias = Literal["int", "float"]


class PureGridEnvironmentModel(TypedDict):
    """Type definition for pure grid environment model dictionary representation"""

    width: int
    height: int
    coord_offset: NotRequired[GridEnvironmentCoordOffset | None]
    background: NotRequired[str | None]  # base64 encoded


class PureGraphEnvironmentModel(TypedDict):
    """Type definition for pure graph environment model dictionary representation"""

    edges: list[GraphEdgeDict]


class PureUniformEnvironmentModel(TypedDict):
    """Type definition for pure uniform environment model dictionary representation"""

    pass


PureEnvironmentModel = (
    PureUniformEnvironmentModel | PureGridEnvironmentModel | PureGraphEnvironmentModel
)


class UniformEnvironmentProjectorDict(TypedDict):
    """Type definition for uniform environment projector parameters"""

    id: str


# TypedDicts for projector parameters


class GridEnvironmentProjectorDict(UniformEnvironmentProjectorDict):
    """Type definition for grid environment projector parameters"""

    width: str
    height: str
    coord_offset: NotRequired[str | bool | None]
    background: NotRequired[str | bool | None]


class GraphEnvironmentProjectorDict(UniformEnvironmentProjectorDict):
    """Type definition for graph environment projector parameters"""

    edges: str


class GraphEdgeProjectorNXDict(TypedDict):
    """Type definition for graph edge projector parameters"""

    directed: NotRequired[bool]
    style: NotRequired[str | bool | None]
    width: NotRequired[str | bool | None]
    color: NotRequired[str | bool | None]


# endregion

# region Projectors


def make_grid_environment_projector(
    id: str,
    width: str = "width",
    height: str = "height",
    coord_offset: str | bool | None = None,
    background: str | bool | None = None,
) -> Callable[[Any], PureGridEnvironmentModel]:
    """Create a function that accesses fields from a GridEnvironmentModel"""
    map_fields: dict[str, str] = {}
    map_fields["width"] = width
    map_fields["height"] = height
    if coord_offset:
        map_fields["coord_offset"] = (
            "coord_offset" if coord_offset is True else coord_offset
        )
    if background is not None and background is not False:
        map_fields["background"] = "background" if background is True else background
    return make_attr_projector(
        [],
        map_fields,
        {
            "id": id,
            "type": "grid",
        },
    )  # type: ignore


def make_graph_environment_projector(
    id: str,
    edges: str = "edges",
) -> Callable[[Any], PureGraphEnvironmentModel]:
    """Create a function that accesses fields from a GraphEnvironmentModel"""
    map_fields: dict[str, str] = {}
    map_fields["edges"] = edges
    return make_attr_projector(
        [],
        map_fields,
        {
            "id": id,
            "type": "graph",
        },
    )  # type: ignore


def make_uniform_environment_projector(
    id: str,
) -> Callable[[Any], PureUniformEnvironmentModel]:
    """Create a function that accesses fields from a UniformEnvironmentModel"""
    map_fields: dict[str, str] = {}
    return make_attr_projector(
        [],
        map_fields,
        {
            "id": id,
            "type": "uniform",
        },
    )  # type: ignore


NXEdge: TypeAlias = tuple[str | int, str | int, dict[str, Any]]


def make_graph_edge_projector_nx(
    directed: bool = False,
    style: str | bool | None = None,
    width: str | bool | None = None,
    color: str | bool | None = None,
) -> Callable[[NXEdge], GraphEdgeDict]:
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
        obj_dict = cast(dict[str, Any], obj)
        for field_name, mapped_field in map_fields.items():
            if mapped_field in edge_data:
                obj_dict[field_name] = edge_data[mapped_field]
        return obj

    return f


# endregion

# region Binders

T = TypeVar("T")
TEnv = TypeVar("TEnv")
TKeys = TypeVar("TKeys", bound=str)
TKeys2 = TypeVar("TKeys2", bound=str)
TKeys3 = TypeVar("TKeys3", bound=str)
TEdge = TypeVar("TEdge")


class EnvironmentBinderProtocol(Protocol):
    id: str

    def get_state(self) -> EnvironmentState: ...


class BindProjectorConfigProtocol(Protocol):
    def get_projector(self) -> Callable[[Any], Any]: ...


class BindProjectorConfigWithIdProtocol(Protocol):
    def get_projector(self, id: str) -> Callable[[Any], Any]: ...


EnvironmentMetadataProjector: TypeAlias = Callable[[Any], dict[str, Any]]
EnvironmentItemIterableProjector: TypeAlias = Callable[[Any], Any]
EnvironmentItemProjector: TypeAlias = Callable[[Any, Any], dict[str, Any]]
EnvironmentItemsProjector: TypeAlias = Callable[[Any], list[dict[str, Any]]]


@dataclass(slots=True)
class EnvironmentBindingConfig:
    environment_type: CanonicalEnvironmentType


def _strip_reserved_environment_keys(value: dict[str, Any]) -> dict[str, Any]:
    return {
        key: val for key, val in value.items() if key not in ("id", "type", "edges")
    }


def _identity_item_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    raise TypeError(
        "Layer items without an projector must already be dict objects, "
        f"got {type(value)!r}."
    )


def _identity_environment_item_projector(
    _environment: Any, item: Any
) -> dict[str, Any]:
    return _identity_item_to_dict(item)


def _count_positional_parameters(projector: Callable[..., Any]) -> int | None:
    try:
        signature = inspect.signature(projector)
    except (TypeError, ValueError):
        return None

    positional_count = 0
    for parameter in signature.parameters.values():
        if parameter.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            positional_count += 1
            continue
        if parameter.kind == inspect.Parameter.VAR_POSITIONAL:
            return None
    return positional_count


def bind_environment_getter(
    projector: Callable[..., Any],
) -> EnvironmentItemIterableProjector:
    positional_count = _count_positional_parameters(projector)
    if positional_count == 0:
        return lambda _environment: projector()
    return lambda environment: projector(environment)


def bind_environment_item_projector(
    projector: Callable[..., dict[str, Any]],
) -> EnvironmentItemProjector:
    positional_count = _count_positional_parameters(projector)
    if positional_count in (None, 1):
        return lambda _environment, item: projector(item)
    if positional_count == 2:
        return lambda environment, item: projector(environment, item)
    raise TypeError(
        "Layer item projectors must accept either (item) or (environment, item)."
    )


def bind_environment_items_projector(
    projector: Callable[..., list[dict[str, Any]]],
) -> EnvironmentItemsProjector:
    positional_count = _count_positional_parameters(projector)
    if positional_count in (None, 1):
        return lambda environment: projector(environment)
    if positional_count == 0:
        return lambda _environment: projector()
    raise TypeError(
        "Layer items projectors must accept either () or (environment)."
    )


def _resolve_item_projector(item: Any) -> EnvironmentItemProjector | None:
    for config_key in (
        "_tensnap_bind_projector_config_trajectory",
        "_tensnap_bind_projector_config_item",
        "_tensnap_bind_projector_config_grid",
        "_tensnap_bind_projector_config_uniform",
        "_tensnap_bind_projector_config_graph",
    ):
        if hasattr(item, config_key):
            projector_config = cast(
                BindProjectorConfigProtocol,
                getattr(item, config_key),
            )
            return bind_environment_item_projector(
                projector_config.get_projector()
            )
    return None


def _layer_items_field_name(layer_type: str) -> str:
    if layer_type == "agent":
        return "agents"
    if layer_type == "edge":
        return "edges"
    return "items"


class LayeredEnvironmentBinder(Generic[TEnv]):
    """Generic environment binder driven by declarative layer bindings or a builder."""

    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_type: CanonicalEnvironmentType | None = None,
        layers: list[LayerBinding[Any, Any]] | None = None,
    ):
        self.id = id
        self.environment = environment
        binding_config = cast(
            EnvironmentBindingConfig | None,
            getattr(environment.__class__, "_tensnap_environment_binding_config", None),
        )
        self.environment_type = environment_type or (
            binding_config.environment_type if binding_config is not None else "uniform"
        )
        declared_layers = cast(
            list[LayerBinding[Any, Any]],
            getattr(
                environment.__class__,
                "_tensnap_layer_binding_configs",
                getattr(environment.__class__, "_tensnap_bind_config_layer_general", []),
            ),
        )
        self.layers = [*declared_layers] if layers is None else [*layers]

    def get_state(self) -> EnvironmentState:
        return {
            "id": self.id,
            "type": self.environment_type,
            "layers": [
                binding.build_layer_state(self.environment) for binding in self.layers
            ],
        }

    def set_environment(self, environment: TEnv) -> None:
        self.environment = environment


class EnvironmentBindingBuilder:
    """Imperative builder for layered environment binders."""

    def __init__(self, environment_type: CanonicalEnvironmentType = "uniform"):
        self.environment_type = environment_type
        self.layers: list[LayerBinding[Any, Any]] = []

    def add_layer(
        self, binding: LayerBinding[Any, Any]
    ) -> "EnvironmentBindingBuilder":
        self.layers.append(binding)
        return self

    def add_grid_layer(
        self,
        layer_id: str = "grid",
        *,
        metadata_projector: Callable[[Any], dict[str, Any]] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="grid",
                metadata_projector=metadata_projector,
            )
        )

    def add_agent_layer(
        self,
        layer_id: str = "agents",
        *,
        item_iterable_projector: Callable[[Any], Any] | None = None,
        item_projector: Callable[..., dict[str, Any]] | None = None,
        items_projector: Callable[..., list[dict[str, Any]]] | None = None,
        metadata_projector: Callable[[Any], dict[str, Any]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="agent",
                item_iterable_projector=(
                    bind_environment_getter(item_iterable_projector)
                    if item_iterable_projector is not None
                    else None
                ),
                item_projector=(
                    bind_environment_item_projector(item_projector)
                    if item_projector is not None
                    else None
                ),
                items_projector=(
                    bind_environment_items_projector(items_projector)
                    if items_projector is not None
                    else None
                ),
                metadata_projector=metadata_projector,
                dependency_layer_ids=dict(dependency_layer_ids or {}),
            )
        )

    def add_edge_layer(
        self,
        layer_id: str = "edges",
        *,
        item_iterable_projector: Callable[[Any], Any] | None = None,
        item_projector: Callable[..., dict[str, Any]] | None = None,
        items_projector: Callable[..., list[dict[str, Any]]] | None = None,
        metadata_projector: Callable[[Any], dict[str, Any]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="edge",
                item_iterable_projector=(
                    bind_environment_getter(item_iterable_projector)
                    if item_iterable_projector is not None
                    else None
                ),
                item_projector=(
                    bind_environment_item_projector(item_projector)
                    if item_projector is not None
                    else None
                ),
                items_projector=(
                    bind_environment_items_projector(items_projector)
                    if items_projector is not None
                    else None
                ),
                metadata_projector=metadata_projector,
                dependency_layer_ids=dict(dependency_layer_ids or {}),
            )
        )

    def add_trajectory_layer(
        self,
        layer_id: str = "trails",
        *,
        metadata_projector: Callable[[Any], dict[str, Any]] | None = None,
        item_iterable_projector: Callable[[Any], Any] | None = None,
        item_projector: Callable[..., dict[str, Any]] | None = None,
        items_projector: Callable[..., list[dict[str, Any]]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="trajectory",
                metadata_projector=metadata_projector,
                item_iterable_projector=(
                    bind_environment_getter(item_iterable_projector)
                    if item_iterable_projector is not None
                    else None
                ),
                item_projector=(
                    bind_environment_item_projector(item_projector)
                    if item_projector is not None
                    else None
                ),
                items_projector=(
                    bind_environment_items_projector(items_projector)
                    if items_projector is not None
                    else None
                ),
                dependency_layer_ids=dict(dependency_layer_ids or {}),
            )
        )

    def build(self, id: str, environment: TEnv) -> LayeredEnvironmentBinder[TEnv]:
        return LayeredEnvironmentBinder(
            id=id,
            environment=environment,
            environment_type=self.environment_type,
            layers=self.layers,
        )


class UniformEnvironmentBinder(Generic[T, TEnv]):
    canonical_environment_type: CanonicalEnvironmentType = "uniform"
    canonical_agent_layer_id = "agents"
    canonical_agent_layer_type = "agent"

    def __init__(
        self,
        id: str,
        environment: TEnv,
        environment_projector: (
            Callable[[Any], PureUniformEnvironmentModel]
            | UniformEnvironmentProjectorDict
            | None
        ) = None,
        agent_iterable_projector: str | bool = "agents",
        agent_projector: (
            Callable[[Any], UniformAgentModelDict] | UniformAgentProjectorDict | None
        ) = None,
    ):
        self.id = id
        self.environment = environment

        # Handle environment_projector
        if environment_projector is None:
            self.environment_projector = self._get_environment_projector(environment)
        elif callable(environment_projector):
            self.environment_projector = environment_projector
        else:
            # It's a TypedDict, create projector from it
            self.environment_projector = make_uniform_environment_projector(
                **environment_projector
            )

        # Handle agent_projector
        if agent_projector is None:
            self.agent_projector = None
        elif callable(agent_projector):
            self.agent_projector = agent_projector
        else:
            # It's a TypedDict, create projector from it
            self.agent_projector = make_uniform_agent_projector(**agent_projector)

        # Handle agent_iterable_projector
        if not agent_iterable_projector:
            self.agent_iterable_projector = None
        else:
            self.agent_iterable_projector = make_attr_getter(
                agent_iterable_projector
                if isinstance(agent_iterable_projector, str)
                else "agents"
            )

    def _get_environment_metadata(self) -> dict[str, Any]:
        model_dict = cast(dict[str, Any], self.environment_projector(self.environment))
        return {
            key: value
            for key, value in model_dict.items()
            if key not in ("id", "type", "edges")
        }

    def _get_agents(self) -> list[dict[str, Any]]:
        if not self.agent_iterable_projector:
            return []
        agent_list = self.agent_iterable_projector(self.environment)
        if not agent_list:
            return []

        ret: list[dict[str, Any]] = []
        for agent in agent_list:
            if self.agent_projector is None:
                self._create_agent_projector(agent)
            agent_dict = cast(dict[str, Any], self.agent_projector(agent))  # type: ignore
            ret.append(agent_dict)
        return ret

    def _builder_agent_item_projector(self, agent: Any) -> dict[str, Any]:
        if self.agent_projector is None:
            self._create_agent_projector(cast(T, agent))
        assert self.agent_projector is not None
        return cast(dict[str, Any], self.agent_projector(agent))

    def get_state(self) -> EnvironmentState:
        return self._build_layered_binder().get_state()

    def _build_layered_binder(self) -> LayeredEnvironmentBinder[TEnv]:
        builder = EnvironmentBindingBuilder(self.canonical_environment_type)
        metadata = self._get_environment_metadata()
        if metadata or self.agent_iterable_projector is not None:
            builder.add_agent_layer(
                layer_id=self.canonical_agent_layer_id,
                item_iterable_projector=self.agent_iterable_projector,
                item_projector=self._builder_agent_item_projector,
            )
        return builder.build(self.id, self.environment)

    def _get_config_key(self, env: TEnv) -> str:
        return "_tensnap_bind_projector_config_uniform"

    def _get_agent_config_key(self, agent: T) -> str:
        return "_tensnap_bind_projector_config_uniform"

    def _get_default_agent_projector(self) -> Callable[[Any], UniformAgentModelDict]:
        return make_uniform_agent_projector(id="id")

    def _get_default_environment_projector(
        self,
    ) -> Callable[[Any], PureUniformEnvironmentModel]:
        return make_uniform_environment_projector(id=self.id)

    def _get_environment_projector(
        self, env: TEnv
    ) -> Callable[[Any], PureUniformEnvironmentModel]:
        cfg_key = self._get_config_key(env)
        if hasattr(env, cfg_key):
            projector_config = cast(
                BindProjectorConfigWithIdProtocol, getattr(env, cfg_key)
            )
            return cast(
                Callable[[Any], PureUniformEnvironmentModel],
                projector_config.get_projector(self.id),
            )
        return self._get_default_environment_projector()

    def _create_agent_projector(self, agent: T) -> None:
        cfg_key = self._get_agent_config_key(agent)
        if hasattr(agent, cfg_key):
            projector_config = cast(BindProjectorConfigProtocol, getattr(agent, cfg_key))
            self.agent_projector = cast(
                Callable[[Any], UniformAgentModelDict],
                projector_config.get_projector(),
            )
        else:
            self.agent_projector = self._get_default_agent_projector()

    def set_environment(self, environment: TEnv) -> None:
        """Set the environment object"""
        self.environment = environment


# endregion
