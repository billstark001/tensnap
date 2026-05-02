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
    ProjectorField,
    ProjectorFieldForInit,
    UniformAgentItemFields,
    AgentItemFields,
    EdgeItemFields,
    TrajectoryConfigItemFields,
)
from tensnap.models.environment import (
    CanonicalEnvironmentType,
    EnvironmentBindingBuilder,
    EnvironmentBindingConfig,
    GraphEdgeProjectorNXDict,
    GraphEdgeDict,
    LayerBinding,
    make_graph_edge_projector_nx,
    make_grid_environment_projector,
    make_uniform_environment_projector,
)
from tensnap.utils.attr import (
    make_attr_projector,
    make_attr_getter,
    AttrGetter,
    AttrProjector,
    AttrPathMap,
)


TItemKeys = TypeVar("TItemKeys", bound=str)
TMetadataKeys = TypeVar("TMetadataKeys", bound=str)

ProjectorDictForInit: TypeAlias = Dict[TItemKeys, ProjectorFieldForInit]

ProjectorDictFilterList: TypeAlias = List[
    Tuple[Callable[[Type[Any]], bool], AttrPathMap[TItemKeys]]
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


def _try_resolve_item_projector(
    cls: Type[Any],
    raw_value: AttrProjector[TItemKeys] | Type[Any] | str,
    projector_name: str | None,
) -> AttrProjector[TItemKeys] | None:
    if callable(raw_value):
        # A direct projector function
        return raw_value

    assert (
        projector_name is not None
    ), "Projector name must be provided when raw_value is not callable"

    if isinstance(raw_value, type):
        # A class with projector registered
        ret = getattr(raw_value, projector_name, None)
        if ret is not None:
            return ret

    elif isinstance(raw_value, str):
        # 1. A class that has not defined yet when defining cls
        might_be_class = _try_get_class(cls, raw_value)
        if might_be_class is not None:
            ret = getattr(might_be_class, projector_name, None)
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
            ), "Not implemented: instance method as item projector is not supported yet"

    return None


def _resolve_projector_dict(
    cls: Type[Any],
    attach_field: str | None,
    projector_dict_init: ProjectorDictForInit[TItemKeys],
    fields: ProjectorDictFilterList[TItemKeys],
    default_fields: AttrPathMap[TItemKeys],
):
    projector_dict: AttrPathMap[TItemKeys] = {}
    # Infer default projector values based on class heuristics if not explicitly provided
    all_none_fields: List[TItemKeys] = [
        k for k, v in projector_dict_init.items() if v is None
    ]

    def add_defaults(defaults: AttrPathMap[TItemKeys]) -> None:
        for field in list(all_none_fields):
            field_key = defaults.get(field, None)
            if field_key is not None:
                projector_dict[field] = field_key
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
            projector_dict[field] = field
            # all_none_fields is no longer used, so we don't need to remove the fields
    # 3. Attach the projector
    if attach_field:
        setattr(cls, attach_field, projector_dict)
    return projector_dict


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
        **kwargs: ProjectorFieldForInit,
    ) -> None:
        self.projector_dict_init = cast(ProjectorDictForInit[TItemKeys], dict(**kwargs))
        self.projector_dict: AttrPathMap[TItemKeys] = {}
        self.attached = False

    def attach(
        self,
        cls: Type[Any],
        attach_field: str,
        fields: ProjectorDictFilterList[TItemKeys],
        default_fields: AttrPathMap[TItemKeys],
    ) -> Type[Any]:
        assert not self.attached, "Projector config can only be attached once"
        projector_dict = _resolve_projector_dict(
            cls,
            attach_field,
            self.projector_dict_init,
            fields,
            default_fields,
        )
        self.projector_dict = projector_dict
        self.attached = True
        return cls

    def assert_attached(self) -> None:
        assert self.attached, "Projector config must be attached before getting projector"

    def assert_fields(self, required_fields: List[TItemKeys]) -> None:
        missing_fields = [
            f for f in required_fields if not self.projector_dict.get(f, None)
        ]
        assert not missing_fields, f"Missing required projector fields: {missing_fields}"

    def get_projector(self) -> AttrProjector[TItemKeys]:
        return cast(
            AttrProjector[TItemKeys],
            make_attr_projector([], cast(Dict[str, str], self.projector_dict), {}),
        )


# endregion

# region Agent


_agent_field_defaults: AttrPathMap[AgentItemFields] = {
    "id": "id",
    "x": "x",
    "y": "y",
}

_agent_fields: List[Tuple[Callable[[Any], bool], AttrPathMap[AgentItemFields]]] = [
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
        self.projector_dict["id"] = id

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        return self.attach(
            cls,
            self.binding_name,
            _agent_fields,
            _agent_field_defaults,
        )

    def get_projector(self):
        self.assert_attached()
        self.assert_fields(["id", "x", "y"])
        return super().get_projector()


bind_agent = BindAgentConfig


_id_field_defaults: AttrPathMap[Literal["id"]] = {
    "id": "id",
}

_id_fields: List[Tuple[Callable[[Any], bool], AttrPathMap[Literal["id"]]]] = [
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
            cast(ProjectorDictFilterList[UniformAgentItemFields], _id_fields),
            cast(AttrPathMap[UniformAgentItemFields], _id_field_defaults),
        )

    def get_projector(self):
        self.assert_attached()
        self.assert_fields(["id"])
        return super().get_projector()


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

    def get_projector(self):
        self.assert_attached()
        self.assert_fields(["source", "target"])
        return super().get_projector()


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
            cast(ProjectorDictFilterList[TrajectoryConfigItemFields], _id_fields),
            cast(AttrPathMap[TrajectoryConfigItemFields], _id_field_defaults),
        )

    def get_projector(self):
        self.assert_attached()
        self.assert_fields(["id"])
        return super().get_projector()


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
            AttrProjector[TMetadataKeys] | ProjectorDictForInit[TMetadataKeys] | None
        ) = None,
        iterable: AttrGetter | ProjectorField | None = None,
        item: AttrProjector[TItemKeys] | Type[Any] | str | None = None,
        item_projector_name: str | None = None,
        dependency_layer_ids: dict[str, str] | None = None,
    ) -> None:
        self.layer_id = layer_id
        self.layer_type = layer_type
        self.init_metadata = metadata
        self.init_iterable = iterable
        self.init_item = item
        self.item_projector_name = item_projector_name
        self.dependency_layer_ids = dependency_layer_ids

        self.binding: LayerBinding | None = None
        self.attached = False

    def attach(
        self,
        cls: Type[Any],
        metadata_fields: ProjectorDictFilterList[TMetadataKeys],
        metadata_default_fields: AttrPathMap[TMetadataKeys],
    ) -> Type[Any]:
        # 0. Sanity check
        assert not self.attached, "Layer config can only be attached once"
        assert (not self.init_iterable) == (
            not self.init_item
        ), "Iterable and item projectors must be provided together"

        # 1. Make metadata projector
        metadata_projector: AttrProjector[TMetadataKeys] | None = None
        if callable(self.init_metadata):
            metadata_projector = self.init_metadata
        elif isinstance(self.init_metadata, dict):
            metadata_projector_dict = _resolve_projector_dict(
                cls,
                None,
                self.init_metadata,
                metadata_fields,
                metadata_default_fields,
            )
            metadata_projector = make_attr_projector(
                [],
                metadata_projector_dict,
                {},
            )
        # else: the layer does not require metadata

        # 2. Make item iterable projector
        iterable_projector: AttrGetter | None = None
        if callable(self.init_iterable):
            iterable_projector = self.init_iterable
        elif isinstance(self.init_iterable, str):
            might_be_method = getattr(cls, self.init_iterable, None)
            if inspect.isfunction(might_be_method):
                iterable_projector = might_be_method
            else:
                iterable_projector = make_attr_getter(self.init_iterable)
        # else: the layer does not require an iterable

        # 3. Make item projector
        item_projector: AttrProjector[TItemKeys] | None = _try_resolve_item_projector(
            cls,
            self.init_item,  # type: ignore
            self.item_projector_name,
        )

        self.binding = LayerBinding(
            layer_id=self.layer_id,
            layer_type=self.layer_type,
            metadata_projector=metadata_projector,
            item_iterable_projector=iterable_projector,
            item_projector=item_projector,
            dependency_layer_ids=dict(self.dependency_layer_ids or {}),
        )

        self.attached = True
        return _append_layer_binding(cls, self.binding)

    def assert_with_item_projector(self):
        assert (
            self.binding is not None
        ), "Layer config must be attached before getting item projector"
        assert (
            self.binding.item_projector is not None
        ), "This layer config requires an item projector, but it was not provided or could not be resolved"

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
        background: ProjectorFieldForInit = None,
        interpolation: ProjectorFieldForInit = None,
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
        x_origin: ProjectorFieldForInit = None,
        x_unit: ProjectorFieldForInit = None,
        x_interval: ProjectorFieldForInit = None,
        x_ratio: ProjectorFieldForInit = None,
        y_origin: ProjectorFieldForInit = None,
        y_unit: ProjectorFieldForInit = None,
        y_interval: ProjectorFieldForInit = None,
        y_ratio: ProjectorFieldForInit = None,
        stroke_color: ProjectorFieldForInit = None,
    ) -> None:
        metadata_dict: ProjectorDictForInit = {
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
        item: AttrProjector[AgentItemFields] | Type[Any] | str,
        iterable: ProjectorField | Callable[[Any], Any] | None = None,
    ) -> None:
        super().__init__(
            layer_id,
            "agent",
            iterable=iterable or layer_id,
            item=item,
            item_projector_name=(
                BindUniformAgentConfig.binding_name
                if uniform
                else BindAgentConfig.binding_name
            ),
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        ret = self.attach(cls, [], {})
        self.assert_with_item_projector()
        return ret


bind_agent_layer = BindAgentLayerConfig

# endregion

# region Edge Layer


class BindEdgeLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "edges",
        *,
        item: AttrProjector[AgentItemFields] | Type[Any] | str,
        iterable: ProjectorField | Callable[[Any], Any] | None = None,
        agent_layer_id: str = "agents",
    ) -> None:
        super().__init__(
            layer_id,
            "edge",
            iterable=iterable or layer_id,
            item=item,
            dependency_layer_ids={"agent": agent_layer_id},
            item_projector_name=BindAgentConfig.binding_name,
        )

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        ret = self.attach(cls, [], {})
        self.assert_with_item_projector()
        return ret


bind_edge_layer = BindEdgeLayerConfig

# endregion

# region Trajectory Layer


class BindTrajectoryLayerConfig(BindLayerConfig):

    def __init__(
        self,
        layer_id: str = "trails",
        *,
        length: ProjectorFieldForInit = None,
        width: ProjectorFieldForInit = None,
        color: ProjectorFieldForInit = None,
        item: AttrProjector[AgentItemFields] | Type[Any] | str | None = None,
        iterable: ProjectorField | Callable[[Any], Any] | None = None,
        agent_layer_id: str = "agents",
    ) -> None:
        metadata_dict: ProjectorDictForInit = {
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
            item_projector_name=BindTrajectoryConfigConfig.binding_name,
        )


bind_trajectory_layer = BindTrajectoryLayerConfig


# endregion
