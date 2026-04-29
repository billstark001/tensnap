import sys
from typing import (
    Any,
    Dict,
    Generic,
    List,
    Literal,
    NotRequired,
    Set,
    Tuple,
    Type,
    TypeAlias,
    TypeVar,
    cast,
)

import inspect
from collections.abc import Callable


from tensnap.models.agent import (
    AccessorField,
    AccessorFieldForInit,
    UniformAgentItemFields,
    AgentItemFields,
    EdgeItemFields,
    TrajectoryConfigItemFields,
    make_agent_accessor,
    make_graph_agent_accessor,
    make_graph_agent_accessor_nx,
    make_grid_agent_accessor,
    make_uniform_agent_accessor,
)
from tensnap.models.environment import (
    CanonicalEnvironmentType,
    EnvironmentBindingBuilder,
    EnvironmentBindingConfig,
    GraphEdgeAccessorNXDict,
    GraphEdgeDict,
    LayerBinding,
    make_graph_edge_accessor_nx,
    make_grid_environment_accessor,
    make_uniform_environment_accessor,
)
from tensnap.utils.attr import (
    make_dict_accessor,
    make_identifier_getter,
    SingleGetter,
    Accessor,
    AccessorDict,
)


TItemKeys = TypeVar("TItemKeys", bound=str)
TMetadataKeys = TypeVar("TMetadataKeys", bound=str)

AccessorDictForInit: TypeAlias = Dict[TItemKeys, AccessorFieldForInit]

AccessorDictFilterList: TypeAlias = List[
    Tuple[Callable[[Type[Any]], bool], AccessorDict[TItemKeys]]
]


# region Utilities


def _binding_name(scope: str, type: str) -> str:
    return f"_tensnap_bind_config_{scope}_{type}"


def _is_probably_mesa_agent_class(cls) -> bool:
    if not isinstance(cls, type):
        return False

    try:
        from mesa import Agent
    except Exception:
        return any(
            base.__name__ == "Agent"
            and (base.__module__ == "mesa" or base.__module__.startswith("mesa."))
            for base in getattr(cls, "__mro__", ())
        )

    return issubclass(cls, Agent)


def _try_get_class(cls: Type[Any], target_class_name: str) -> Type[Any] | None:
    module_globals = sys.modules[cls.__module__].__dict__

    if target_class_name not in module_globals:
        return None

    might_be_class = module_globals[target_class_name]
    if isinstance(might_be_class, type):
        return might_be_class

    return None


def _try_resolve_item_accessor(
    cls: Type[Any],
    raw_value: Accessor[TItemKeys] | Type[Any] | str,
    accessor_name: str | None,
) -> Accessor[TItemKeys] | None:
    if callable(raw_value):
        # A direct accessor function
        return raw_value

    assert (
        accessor_name is not None
    ), "Accessor name must be provided when raw_value is not callable"

    if isinstance(raw_value, type):
        # A class with accessor registered
        ret = getattr(raw_value, accessor_name, None)
        if ret is not None:
            return ret

    elif isinstance(raw_value, str):
        # 1. A class that has not defined yet when defining cls
        might_be_class = _try_get_class(cls, raw_value)
        if might_be_class is not None:
            ret = getattr(might_be_class, accessor_name, None)
            if ret is not None:
                return ret
        # 2. A method or field on the class
        might_be_method = getattr(cls, raw_value, None)
        if inspect.isfunction(might_be_method):
            # Static class method
            return might_be_method
        if inspect.ismethod(might_be_method):
            assert (
                False
            ), "Not implemented: instance method as item accessor is not supported yet"

    return None


def _resolve_accessor_dict(
    cls: Type[Any],
    attach_field: str | None,
    accessor_dict_init: AccessorDictForInit[TItemKeys],
    fields: AccessorDictFilterList[TItemKeys],
    default_fields: AccessorDict[TItemKeys],
):
    accessor_dict: AccessorDict[TItemKeys] = {}
    # Infer default accessor values based on class heuristics if not explicitly provided
    all_none_fields: List[TItemKeys] = [
        k for k, v in accessor_dict_init.items() if v is None
    ]

    def add_defaults(defaults: AccessorDict[TItemKeys]) -> None:
        for field in list(all_none_fields):
            field_key = defaults.get(field, None)
            if field_key is not None:
                accessor_dict[field] = field_key
                all_none_fields.remove(field)

    # 1. Some fields are required, so we set them to their default values first
    for check_fn, defaults in fields:
        if not all_none_fields:
            break
        if not check_fn(cls):
            continue
        add_defaults(defaults)
    add_defaults(default_fields)
    # 2. For other optional fields, check if they exist on the class and use them if so
    for field in all_none_fields:
        if hasattr(cls, field):
            accessor_dict[field] = field
            # all_none_fields is no longer used, so we don't need to remove the fields
    # 3. Attach the accessor
    if attach_field:
        setattr(cls, attach_field, accessor_dict)
    return accessor_dict


# endregion


# region Environment


class BindEnvironmentConfig:

    def __init__(
        self,
        environment_type: CanonicalEnvironmentType = "2d",
    ) -> None:
        self.environment_type: CanonicalEnvironmentType = environment_type

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        cls._tensnap_environment_binding_config = EnvironmentBindingConfig(
            environment_type=self.environment_type
        )
        return cls


bind_env = BindEnvironmentConfig

# endregion

# region General Layer Item


class BindItemConfig(Generic[TItemKeys]):

    def __init__(
        self,
        **kwargs: AccessorFieldForInit,
    ) -> None:
        self.accessor_dict_init = cast(AccessorDictForInit[TItemKeys], dict(**kwargs))
        self.accessor_dict: AccessorDict[TItemKeys] = {}
        self.attached = False

    def attach(
        self,
        cls: Type[Any],
        attach_field: str,
        fields: AccessorDictFilterList[TItemKeys],
        default_fields: AccessorDict[TItemKeys],
    ) -> Type[Any]:
        assert not self.attached, "Accessor config can only be attached once"
        accessor_dict = _resolve_accessor_dict(
            cls,
            attach_field,
            self.accessor_dict_init,
            fields,
            default_fields,
        )
        self.accessor_dict = accessor_dict
        self.attached = True
        return cls

    def assert_attached(self) -> None:
        assert self.attached, "Accessor config must be attached before getting accessor"

    def assert_fields(self, required_fields: List[TItemKeys]) -> None:
        missing_fields = [
            f for f in required_fields if not self.accessor_dict.get(f, None)
        ]
        assert not missing_fields, f"Missing required accessor fields: {missing_fields}"

    def get_accessor(self) -> Accessor[TItemKeys]:
        return cast(
            Accessor[TItemKeys],
            make_dict_accessor([], cast(Dict[str, str], self.accessor_dict), {}),
        )


# endregion

# region Agent


_agent_field_defaults: AccessorDict[AgentItemFields] = {
    "id": "id",
    "x": "x",
    "y": "y",
}

_agent_fields: List[Tuple[Callable[[Any], bool], AccessorDict[AgentItemFields]]] = [
    (
        _is_probably_mesa_agent_class,
        {
            "id": "unique_id",
            "x": "pos[0]",
            "y": "pos[1]",
        },
    )
]


class BindAgentConfig(BindItemConfig[AgentItemFields]):

    binding_name = _binding_name("item", "agent")

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
        super().__init__(
            id=id,
            x=x,
            y=y,
            heading=heading,
            color=color,
            icon=icon,
            size=size,
            data=data,
        )
        self.accessor_dict["id"] = id

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        return self.attach(
            cls,
            self.binding_name,
            _agent_fields,
            _agent_field_defaults,
        )

    def get_accessor(self):
        self.assert_attached()
        self.assert_fields(["id", "x", "y"])
        return super().get_accessor()


bind_agent = BindAgentConfig


_id_field_defaults: AccessorDict[Literal["id"]] = {
    "id": "id",
}

_id_fields: List[Tuple[Callable[[Any], bool], AccessorDict[Literal["id"]]]] = [
    (
        _is_probably_mesa_agent_class,
        {
            "id": "unique_id",
        },
    )
]


class BindUniformAgentConfig(BindItemConfig[UniformAgentItemFields]):

    binding_name = _binding_name("item", "uniform_agent")

    def __init__(
        self,
        id: str = "id",
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        super().__init__(
            id=id,
            color=color,
            icon=icon,
            size=size,
            data=data,
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        return self.attach(
            cls,
            self.binding_name,
            cast(AccessorDictFilterList[UniformAgentItemFields], _id_fields),
            cast(AccessorDict[UniformAgentItemFields], _id_field_defaults),
        )

    def get_accessor(self):
        self.assert_attached()
        self.assert_fields(["id"])
        return super().get_accessor()


bind_uniform_agent = BindUniformAgentConfig


# endregion

# region Edge


class BindEdgeConfig(BindItemConfig[EdgeItemFields]):

    binding_name = _binding_name("item", "edge")

    def __init__(
        self,
        id: str = "id",
        source: str = "source",
        target: str = "target",
        color: str | bool | None = None,
        width: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        super().__init__(
            id=id,
            source=source,
            target=target,
            color=color,
            width=width,
            data=data,
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        return self.attach(cls, self.binding_name, [], {})

    def get_accessor(self):
        self.assert_attached()
        self.assert_fields(["source", "target"])
        return super().get_accessor()


# endregion

# region Trajectory


class BindTrajectoryConfigConfig(BindItemConfig[TrajectoryConfigItemFields]):
    binding_name = _binding_name("item", "trajectory")

    def __init__(
        self,
        id: str = "id",
        length: str | bool | None = "length",
        width: str | bool | None = "width",
        color: str | bool | None = "color",
    ) -> None:
        super().__init__(
            id=id,
            length=length,
            width=width,
            color=color,
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        return self.attach(
            cls,
            self.binding_name,
            cast(AccessorDictFilterList[TrajectoryConfigItemFields], _id_fields),
            cast(AccessorDict[TrajectoryConfigItemFields], _id_field_defaults),
        )

    def get_accessor(self):
        self.assert_attached()
        self.assert_fields(["id"])
        return super().get_accessor()


bind_trajectory_item = BindTrajectoryConfigConfig


# endregion

# region General Layer

_layer_binding_name = _binding_name("layer", "general")


def _append_layer_binding(cls: Type[Any], binding: LayerBinding) -> Type[Any]:
    bindings = list(getattr(cls, _layer_binding_name, []))
    bindings.append(binding)
    setattr(cls, _layer_binding_name, bindings)
    return cls


class BindLayerConfig(Generic[TMetadataKeys, TItemKeys]):

    def __init__(
        self,
        layer_id: str,
        layer_type: str,
        *,
        metadata: (
            Accessor[TMetadataKeys] | AccessorDictForInit[TMetadataKeys] | None
        ) = None,
        iterable: SingleGetter | AccessorField | None = None,
        item: Accessor[TItemKeys] | Type[Any] | str | None = None,
        item_accessor_name: str | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> None:
        self.layer_id = layer_id
        self.layer_type = layer_type
        self.init_metadata = metadata
        self.init_iterable = iterable
        self.init_item = item
        self.item_accessor_name = item_accessor_name
        self.dependency_layer_ids = dependency_layer_ids

        self.binding: LayerBinding | None = None
        self.attached = False

    def attach(
        self,
        cls: Type[Any],
        metadata_fields: AccessorDictFilterList[TMetadataKeys],
        metadata_default_fields: AccessorDict[TMetadataKeys],
    ) -> Type[Any]:
        # 0. Sanity check
        assert not self.attached, "Layer config can only be attached once"
        assert (not self.init_iterable) == (
            not self.init_item
        ), "Iterable and item accessors must be provided together"

        # 1. Make metadata accessor
        metadata_accessor: Accessor[TMetadataKeys] | None = None
        if callable(self.init_metadata):
            metadata_accessor = self.init_metadata
        elif isinstance(self.init_metadata, dict):
            metadata_accessor_dict = _resolve_accessor_dict(
                cls,
                None,
                self.init_metadata,
                metadata_fields,
                metadata_default_fields,
            )
            metadata_accessor = make_dict_accessor(
                [],
                metadata_accessor_dict,
                {},
            )
        # else: the layer does not require metadata

        # 2. Make item iterable accessor
        iterable_accessor: SingleGetter | None = None
        if callable(self.init_iterable):
            iterable_accessor = self.init_iterable
        elif isinstance(self.init_iterable, str):
            might_be_method = getattr(cls, self.init_iterable, None)
            if inspect.isfunction(might_be_method):
                iterable_accessor = might_be_method
            else:
                iterable_accessor = make_identifier_getter(self.init_iterable)
        # else: the layer does not require an iterable

        # 3. Make item accessor
        item_accessor: Accessor[TItemKeys] | None = _try_resolve_item_accessor(
            cls,
            self.init_item,  # type: ignore
            self.item_accessor_name,
        )

        self.binding = LayerBinding(
            layer_id=self.layer_id,
            layer_type=self.layer_type,
            metadata_accessor=metadata_accessor,
            item_iterable_accessor=iterable_accessor,
            item_accessor=item_accessor,
            dependency_layer_ids=dict(self.dependency_layer_ids or {}),
        )

        self.attached = True
        return _append_layer_binding(cls, self.binding)

    def assert_with_item_accessor(self):
        assert (
            self.binding is not None
        ), "Layer config must be attached before getting item accessor"
        assert (
            self.binding.item_accessor is not None
        ), "This layer config requires an item accessor, but it was not provided or could not be resolved"

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        return self.attach(cls, [], {})


bind_layer = BindLayerConfig

# endregion

# region Background Layer


class BindBackgroundLayerConfig(BindLayerConfig):
    def __init__(
        self,
        layer_id: str = "background",
        *,
        background: AccessorFieldForInit = None,
        interpolation: AccessorFieldForInit = None,
    ) -> None:
        super().__init__(
            layer_id,
            "background",
            metadata={
                "background": background,
                "interpolation": interpolation,
            },
        )


bind_background_layer = BindBackgroundLayerConfig

# endregion

# region Grid Layer


class BindGridLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "grid",
        *,
        x_origin: AccessorFieldForInit = None,
        x_unit: AccessorFieldForInit = None,
        x_interval: AccessorFieldForInit = None,
        x_ratio: AccessorFieldForInit = None,
        y_origin: AccessorFieldForInit = None,
        y_unit: AccessorFieldForInit = None,
        y_interval: AccessorFieldForInit = None,
        y_ratio: AccessorFieldForInit = None,
        stroke_color: AccessorFieldForInit = None,
    ) -> None:
        metadata_dict: AccessorDictForInit = {
            "x_origin": x_origin,
            "x_unit": x_unit,
            "x_interval": x_interval,
            "x_ratio": x_ratio,
            "y_origin": y_origin,
            "y_unit": y_unit,
            "y_interval": y_interval,
            "y_ratio": y_ratio,
            "stroke_color": stroke_color,
        }
        super().__init__(
            layer_id,
            "grid",
            metadata=metadata_dict,
        )


bind_grid_layer = BindGridLayerConfig

# endregion

# region Agent Layer


class BindAgentLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "agents",
        *,
        uniform: bool = False,
        item: Accessor[AgentItemFields] | Type[Any] | str,
        iterable: AccessorField | Callable[[Any], Any] | None = None,
    ) -> None:
        super().__init__(
            layer_id,
            "agent",
            iterable=iterable or layer_id,
            item=item,
            item_accessor_name=(
                BindUniformAgentConfig.binding_name
                if uniform
                else BindAgentConfig.binding_name
            ),
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        ret = self.attach(cls, [], {})
        self.assert_with_item_accessor()
        return ret


bind_agent_layer = BindAgentLayerConfig

# endregion

# region Edge Layer


class BindEdgeLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "edges",
        *,
        item: Accessor[AgentItemFields] | Type[Any] | str,
        iterable: AccessorField | Callable[[Any], Any] | None = None,
        agent_layer_id: str = "agents",
    ) -> None:
        super().__init__(
            layer_id,
            "edge",
            iterable=iterable or layer_id,
            item=item,
            dependency_layer_ids={"agent": agent_layer_id},
            item_accessor_name=BindAgentConfig.binding_name,
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        ret = self.attach(cls, [], {})
        self.assert_with_item_accessor()
        return ret


bind_edge_layer = BindEdgeLayerConfig

# endregion

# region Trajectory Layer


class BindTrajectoryLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "trails",
        *,
        length: AccessorFieldForInit = None,
        width: AccessorFieldForInit = None,
        color: AccessorFieldForInit = None,
        item: Accessor[AgentItemFields] | Type[Any] | str | None = None,
        iterable: AccessorField | Callable[[Any], Any] | None = None,
        agent_layer_id: str = "agents",
    ) -> None:
        metadata_dict: AccessorDictForInit = {
            "length": length,
            "width": width,
            "color": color,
        }
        super().__init__(
            layer_id,
            "trajectory",
            metadata=metadata_dict,
            iterable=iterable or agent_layer_id,
            item=item,
            dependency_layer_ids={"agent": agent_layer_id},
            item_accessor_name=BindTrajectoryConfigConfig.binding_name,
        )


bind_trajectory_layer = BindTrajectoryLayerConfig


# endregion
