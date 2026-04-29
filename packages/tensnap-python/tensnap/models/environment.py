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

from tensnap.utils.attr import (
    make_dict_accessor,
    make_identifier_getter,
)

from .agent import (
    UniformAgentAccessorDict,
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


class UniformEnvironmentAccessorDict(TypedDict):
    """Type definition for uniform environment accessor parameters"""

    id: str


# TypedDicts for accessor parameters


class GridEnvironmentAccessorDict(UniformEnvironmentAccessorDict):
    """Type definition for grid environment accessor parameters"""

    width: str
    height: str
    coord_offset: NotRequired[str | bool | None]
    background: NotRequired[str | bool | None]


class GraphEnvironmentAccessorDict(UniformEnvironmentAccessorDict):
    """Type definition for graph environment accessor parameters"""

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


NXEdge: TypeAlias = tuple[str | int, str | int, dict[str, Any]]


def make_graph_edge_accessor_nx(
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


class BindAccessorConfigProtocol(Protocol):
    def get_accessor(self) -> Callable[[Any], Any]: ...


class BindAccessorConfigWithIdProtocol(Protocol):
    def get_accessor(self, id: str) -> Callable[[Any], Any]: ...


EnvironmentMetadataAccessor: TypeAlias = Callable[[Any], dict[str, Any]]
EnvironmentItemIterableAccessor: TypeAlias = Callable[[Any], Any]
EnvironmentItemAccessor: TypeAlias = Callable[[Any, Any], dict[str, Any]]
EnvironmentItemsAccessor: TypeAlias = Callable[[Any], list[dict[str, Any]]]


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
        "Layer items without an accessor must already be dict objects, "
        f"got {type(value)!r}."
    )


def _identity_environment_item_accessor(
    _environment: Any, item: Any
) -> dict[str, Any]:
    return _identity_item_to_dict(item)


def _count_positional_parameters(accessor: Callable[..., Any]) -> int | None:
    try:
        signature = inspect.signature(accessor)
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
    accessor: Callable[..., Any],
) -> EnvironmentItemIterableAccessor:
    positional_count = _count_positional_parameters(accessor)
    if positional_count == 0:
        return lambda _environment: accessor()
    return lambda environment: accessor(environment)


def bind_environment_item_accessor(
    accessor: Callable[..., dict[str, Any]],
) -> EnvironmentItemAccessor:
    positional_count = _count_positional_parameters(accessor)
    if positional_count in (None, 1):
        return lambda _environment, item: accessor(item)
    if positional_count == 2:
        return lambda environment, item: accessor(environment, item)
    raise TypeError(
        "Layer item accessors must accept either (item) or (environment, item)."
    )


def bind_environment_items_accessor(
    accessor: Callable[..., list[dict[str, Any]]],
) -> EnvironmentItemsAccessor:
    positional_count = _count_positional_parameters(accessor)
    if positional_count in (None, 1):
        return lambda environment: accessor(environment)
    if positional_count == 0:
        return lambda _environment: accessor()
    raise TypeError(
        "Layer items accessors must accept either () or (environment)."
    )


def _resolve_item_accessor(item: Any) -> EnvironmentItemAccessor | None:
    for config_key in (
        "_tensnap_bind_accessor_config_trajectory",
        "_tensnap_bind_accessor_config_item",
        "_tensnap_bind_accessor_config_grid",
        "_tensnap_bind_accessor_config_uniform",
        "_tensnap_bind_accessor_config_graph",
    ):
        if hasattr(item, config_key):
            accessor_config = cast(
                BindAccessorConfigProtocol,
                getattr(item, config_key),
            )
            return bind_environment_item_accessor(
                accessor_config.get_accessor()
            )
    return None


def _layer_items_field_name(layer_type: str) -> str:
    if layer_type == "agent":
        return "agents"
    if layer_type == "edge":
        return "edges"
    return "items"


@dataclass(slots=True)
class LayerBinding(Generic[TKeys, TKeys2]):
    layer_id: str
    layer_type: str
    metadata_accessor: EnvironmentMetadataAccessor | None = None
    item_iterable_accessor: EnvironmentItemIterableAccessor | None = None
    item_accessor: EnvironmentItemAccessor | None = None
    items_accessor: EnvironmentItemsAccessor | None = None
    dependency_layer_ids: dict[str, str] = field(default_factory=dict)

    def _build_metadata(self, environment: Any) -> dict[str, Any]:
        metadata = self.metadata_accessor(environment) if self.metadata_accessor else {}
        metadata_copy = dict(metadata)
        metadata_copy.pop("dependency_layer_ids", None)
        return metadata_copy

    def _build_dependency_layer_ids(self) -> dict[str, str]:
        return dict(self.dependency_layer_ids)

    def _build_items(self, environment: Any) -> list[dict[str, Any]]:
        if self.items_accessor is not None:
            return [
                _identity_item_to_dict(item)
                for item in (self.items_accessor(environment) or [])
            ]
        if self.item_iterable_accessor is None:
            return []
        iterable = self.item_iterable_accessor(environment)
        if iterable is None:
            return []

        items: list[dict[str, Any]] = []
        for item in iterable:
            item_accessor = self.item_accessor or _resolve_item_accessor(item)
            item_to_dict = item_accessor or _identity_environment_item_accessor
            items.append(_identity_item_to_dict(item_to_dict(environment, item)))
        return items

    def build_layer_state(self, environment: Any) -> EnvironmentLayerState:
        layer: dict[str, Any] = {
            "layer_id": self.layer_id,
            "layer_type": self.layer_type,
        }
        metadata = self._build_metadata(environment)
        if metadata:
            layer["data"] = metadata
        dependency_layer_ids = self._build_dependency_layer_ids()
        if dependency_layer_ids:
            layer["dependency_layer_ids"] = dependency_layer_ids

        items = self._build_items(environment)
        if items:
            layer[_layer_items_field_name(self.layer_type)] = items
        return cast(EnvironmentLayerState, layer)


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
        metadata_accessor: Callable[[Any], dict[str, Any]] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="grid",
                metadata_accessor=metadata_accessor,
            )
        )

    def add_agent_layer(
        self,
        layer_id: str = "agents",
        *,
        item_iterable_accessor: Callable[[Any], Any] | None = None,
        item_accessor: Callable[..., dict[str, Any]] | None = None,
        items_accessor: Callable[..., list[dict[str, Any]]] | None = None,
        metadata_accessor: Callable[[Any], dict[str, Any]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="agent",
                item_iterable_accessor=(
                    bind_environment_getter(item_iterable_accessor)
                    if item_iterable_accessor is not None
                    else None
                ),
                item_accessor=(
                    bind_environment_item_accessor(item_accessor)
                    if item_accessor is not None
                    else None
                ),
                items_accessor=(
                    bind_environment_items_accessor(items_accessor)
                    if items_accessor is not None
                    else None
                ),
                metadata_accessor=metadata_accessor,
                dependency_layer_ids=dict(dependency_layer_ids or {}),
            )
        )

    def add_edge_layer(
        self,
        layer_id: str = "edges",
        *,
        item_iterable_accessor: Callable[[Any], Any] | None = None,
        item_accessor: Callable[..., dict[str, Any]] | None = None,
        items_accessor: Callable[..., list[dict[str, Any]]] | None = None,
        metadata_accessor: Callable[[Any], dict[str, Any]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="edge",
                item_iterable_accessor=(
                    bind_environment_getter(item_iterable_accessor)
                    if item_iterable_accessor is not None
                    else None
                ),
                item_accessor=(
                    bind_environment_item_accessor(item_accessor)
                    if item_accessor is not None
                    else None
                ),
                items_accessor=(
                    bind_environment_items_accessor(items_accessor)
                    if items_accessor is not None
                    else None
                ),
                metadata_accessor=metadata_accessor,
                dependency_layer_ids=dict(dependency_layer_ids or {}),
            )
        )

    def add_trajectory_layer(
        self,
        layer_id: str = "trails",
        *,
        metadata_accessor: Callable[[Any], dict[str, Any]] | None = None,
        item_iterable_accessor: Callable[[Any], Any] | None = None,
        item_accessor: Callable[..., dict[str, Any]] | None = None,
        items_accessor: Callable[..., list[dict[str, Any]]] | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> "EnvironmentBindingBuilder":
        return self.add_layer(
            LayerBinding(
                layer_id=layer_id,
                layer_type="trajectory",
                metadata_accessor=metadata_accessor,
                item_iterable_accessor=(
                    bind_environment_getter(item_iterable_accessor)
                    if item_iterable_accessor is not None
                    else None
                ),
                item_accessor=(
                    bind_environment_item_accessor(item_accessor)
                    if item_accessor is not None
                    else None
                ),
                items_accessor=(
                    bind_environment_items_accessor(items_accessor)
                    if items_accessor is not None
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
        environment_accessor: (
            Callable[[Any], PureUniformEnvironmentModel]
            | UniformEnvironmentAccessorDict
            | None
        ) = None,
        agent_iterable_accessor: str | bool = "agents",
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

        # Handle agent_iterable_accessor
        if not agent_iterable_accessor:
            self.agent_iterable_accessor = None
        else:
            self.agent_iterable_accessor = make_identifier_getter(
                agent_iterable_accessor
                if isinstance(agent_iterable_accessor, str)
                else "agents"
            )

    def _get_environment_metadata(self) -> dict[str, Any]:
        model_dict = cast(dict[str, Any], self.environment_accessor(self.environment))
        return {
            key: value
            for key, value in model_dict.items()
            if key not in ("id", "type", "edges")
        }

    def _get_agents(self) -> list[dict[str, Any]]:
        if not self.agent_iterable_accessor:
            return []
        agent_list = self.agent_iterable_accessor(self.environment)
        if not agent_list:
            return []

        ret: list[dict[str, Any]] = []
        for agent in agent_list:
            if self.agent_accessor is None:
                self._create_agent_accessor(agent)
            agent_dict = cast(dict[str, Any], self.agent_accessor(agent))  # type: ignore
            ret.append(agent_dict)
        return ret

    def _builder_agent_item_accessor(self, agent: Any) -> dict[str, Any]:
        if self.agent_accessor is None:
            self._create_agent_accessor(cast(T, agent))
        assert self.agent_accessor is not None
        return cast(dict[str, Any], self.agent_accessor(agent))

    def get_state(self) -> EnvironmentState:
        return self._build_layered_binder().get_state()

    def _build_layered_binder(self) -> LayeredEnvironmentBinder[TEnv]:
        builder = EnvironmentBindingBuilder(self.canonical_environment_type)
        metadata = self._get_environment_metadata()
        if metadata or self.agent_iterable_accessor is not None:
            builder.add_agent_layer(
                layer_id=self.canonical_agent_layer_id,
                item_iterable_accessor=self.agent_iterable_accessor,
                item_accessor=self._builder_agent_item_accessor,
            )
        return builder.build(self.id, self.environment)

    def _get_config_key(self, env: TEnv) -> str:
        return "_tensnap_bind_accessor_config_uniform"

    def _get_agent_config_key(self, agent: T) -> str:
        return "_tensnap_bind_accessor_config_uniform"

    def _get_default_agent_accessor(self) -> Callable[[Any], UniformAgentModelDict]:
        return make_uniform_agent_accessor(id="id")

    def _get_default_environment_accessor(
        self,
    ) -> Callable[[Any], PureUniformEnvironmentModel]:
        return make_uniform_environment_accessor(id=self.id)

    def _get_environment_accessor(
        self, env: TEnv
    ) -> Callable[[Any], PureUniformEnvironmentModel]:
        cfg_key = self._get_config_key(env)
        if hasattr(env, cfg_key):
            accessor_config = cast(
                BindAccessorConfigWithIdProtocol, getattr(env, cfg_key)
            )
            return cast(
                Callable[[Any], PureUniformEnvironmentModel],
                accessor_config.get_accessor(self.id),
            )
        return self._get_default_environment_accessor()

    def _create_agent_accessor(self, agent: T) -> None:
        cfg_key = self._get_agent_config_key(agent)
        if hasattr(agent, cfg_key):
            accessor_config = cast(BindAccessorConfigProtocol, getattr(agent, cfg_key))
            self.agent_accessor = cast(
                Callable[[Any], UniformAgentModelDict],
                accessor_config.get_accessor(),
            )
        else:
            self.agent_accessor = self._get_default_agent_accessor()

    def set_environment(self, environment: TEnv) -> None:
        """Set the environment object"""
        self.environment = environment


# endregion
