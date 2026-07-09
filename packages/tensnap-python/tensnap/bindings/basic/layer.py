import sys
from collections.abc import Callable
from typing import (
    Any,
    Generic,
    Literal,
    TypeAlias,
    TypeVar,
    cast,
)

from tensnap.bindings.mesa.utils import is_mesa_agent_class
from tensnap.models import (
    AgentItemFields,
    AgentLayerMetadataFields,
    BackgroundLayerMetadataFields,
    EdgeItemFields,
    EdgeLayerMetadataFields,
    GridLayerMetadataFields,
    ProjectorField,
    ProjectorFieldForInit,
    TrajectoryConfigItemFields,
    TrajectoryLayerMetadataFields,
    UniformAgentItemFields,
)
from tensnap.models.layer import (
    DynamicAttrProjector,
    ItemsProjector,
    LayerBinding,
)
from tensnap.utils.attr import (
    AttrGetter,
    AttrPathMap,
    AttrProjector,
)
from tensnap.utils.init_hook import install_once_init_hook

from .layer_utils import (
    MetadataDictForInit,
    ProjectorDictFilterList,
    ProjectorDictForInit,
    make_projector_for_target,
    resolve_layer_getter,
)

TItemKeys = TypeVar("TItemKeys", bound=str)
TMetadataKeys = TypeVar("TMetadataKeys", bound=str)
TClass = TypeVar("TClass")

ProjectorName: TypeAlias = str | tuple[str, ...]
LayerDependencyIds: TypeAlias = dict[str, str]
LayerItemProjectorForInit: TypeAlias = (
    AttrProjector[Any, TItemKeys]
    | DynamicAttrProjector[Any, Any, TItemKeys]
    | type[Any]
    | str
)
LayerItemsProjectorForInit: TypeAlias = ItemsProjector[Any, TItemKeys] | str


# region Utilities


def _binding_name(scope: str, type: str) -> str:
    return f"_tensnap_bind_config_{scope}_{type}"


def _try_get_class(cls: type[Any], target_class_name: str) -> type[Any] | None:
    module = sys.modules.get(cls.__module__)
    if module is None:
        return None

    module_globals = module.__dict__

    if target_class_name not in module_globals:
        return None

    might_be_class = module_globals[target_class_name]
    if isinstance(might_be_class, type):
        return might_be_class

    return None


def _normalize_projector_names(projector_name: ProjectorName | None) -> tuple[str, ...]:
    if projector_name is None:
        return ()
    if isinstance(projector_name, str):
        return (projector_name,)
    return projector_name


def _identity_item_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    raise TypeError(
        "Layer items without an item projector must already be dict objects, "
        f"got {type(value)!r}."
    )


def _edge_item_to_dict(value: Any) -> dict[EdgeItemFields, Any]:
    if isinstance(value, dict):
        edge_data = dict(value)
        edge_data.setdefault("directed", False)
        return cast(dict[EdgeItemFields, Any], edge_data)

    if isinstance(value, (tuple, list)) and len(value) >= 2:
        tuple_edge_data: dict[str, Any] = {
            "source": value[0],
            "target": value[1],
            "directed": False,
        }
        if len(value) >= 3 and isinstance(value[2], dict):
            for field in ("directed", "style", "width", "color"):
                if field in value[2]:
                    tuple_edge_data[field] = value[2][field]
        return cast(dict[EdgeItemFields, Any], tuple_edge_data)

    raise TypeError(
        "Edge layer items without an explicit projector must be dicts or "
        "(source, target[, data]) tuples."
    )


def _empty_items_projector(_layer: Any) -> list[dict[str, Any]]:
    return []


def _resolve_registered_item_projector(
    item_cls: type[Any],
    projector_names: tuple[str, ...],
) -> Callable[[Any], dict[str, Any]] | None:
    # Resolution order: try each registered projector config name on the item class.
    for projector_name in projector_names:
        projector_config = getattr(item_cls, projector_name, None)
        if projector_config is not None and hasattr(projector_config, "get_projector"):
            return cast(
                Callable[[Any], dict[str, Any]],
                projector_config.get_projector(),
            )
    return None


def _make_inferred_item_dynamic_projector(
    projector_names: tuple[str, ...],
    fallback_projector: Callable[[Any], dict[TItemKeys, Any]],
) -> DynamicAttrProjector[Any, Any, TItemKeys]:
    projector_cache: dict[type[Any], Callable[[Any], dict[str, Any]] | None] = {}

    def projector(_layer: Any, item: Any) -> dict[TItemKeys, Any]:
        # Resolution order: cached item-class projector first, then fallback.
        item_cls = item.__class__
        if item_cls not in projector_cache:
            projector_cache[item_cls] = _resolve_registered_item_projector(
                item_cls,
                projector_names,
            )

        resolved_projector = cast(
            Callable[[Any], dict[TItemKeys, Any]] | None,
            projector_cache[item_cls],
        )
        if resolved_projector is not None:
            return resolved_projector(item)
        return fallback_projector(item)

    return projector


def _resolve_items_projector(
    cls: type[Any],
    raw_value: LayerItemsProjectorForInit[TItemKeys] | None,
) -> ItemsProjector[Any, TItemKeys] | None:
    # Resolution order: direct callable, class attribute callable.
    if raw_value is None:
        return None
    if callable(raw_value):
        return raw_value
    maybe_callable = getattr(cls, raw_value, None)
    if callable(maybe_callable):
        return cast(ItemsProjector[Any, TItemKeys], maybe_callable)
    raise ValueError(f"Cannot resolve items projector {raw_value!r} on {cls.__name__}.")


def _resolve_explicit_dynamic_item_projector(
    cls: type[Any],
    raw_value: DynamicAttrProjector[Any, Any, TItemKeys] | str,
) -> DynamicAttrProjector[Any, Any, TItemKeys]:
    # Resolution order: direct callable, class attribute callable.
    if callable(raw_value):
        return raw_value
    maybe_callable = getattr(cls, raw_value, None)
    if callable(maybe_callable):
        return cast(DynamicAttrProjector[Any, Any, TItemKeys], maybe_callable)
    raise ValueError(
        f"Cannot resolve dynamic item projector {raw_value!r} on {cls.__name__}."
    )


def _try_resolve_item_projector(
    cls: type[Any],
    raw_value: LayerItemProjectorForInit[TItemKeys],
    projector_names: tuple[str, ...],
) -> Callable[..., dict[TItemKeys, Any]] | None:
    # Resolution order: direct callable, registered item class, forward class name,
    # then class attribute callable.
    if callable(raw_value):
        return raw_value

    if isinstance(raw_value, type):
        return cast(
            Callable[..., dict[TItemKeys, Any]] | None,
            _resolve_registered_item_projector(raw_value, projector_names),
        )

    item_cls = _try_get_class(cls, raw_value)
    if item_cls is not None:
        resolved_projector = _resolve_registered_item_projector(
            item_cls, projector_names
        )
        if resolved_projector is not None:
            return cast(Callable[..., dict[TItemKeys, Any]], resolved_projector)

    maybe_callable = getattr(cls, raw_value, None)
    if callable(maybe_callable):
        return cast(Callable[..., dict[TItemKeys, Any]], maybe_callable)

    return None


# endregion


# region General Layer Item


class BindItemConfig(Generic[TItemKeys]):
    def __init__(
        self,
        **kwargs: ProjectorFieldForInit,
    ) -> None:
        self.projector_dict_init = cast(ProjectorDictForInit[TItemKeys], dict(**kwargs))
        self._attached_class: type[Any] | None = None
        self._fields: ProjectorDictFilterList[TItemKeys] = []
        self._default_fields: AttrPathMap[TItemKeys] = {}
        self._projector: AttrProjector[Any, TItemKeys] | None = None
        self.attached = False

    def attach(
        self,
        cls: type[TClass],
        attach_field: str,
        fields: ProjectorDictFilterList[TItemKeys],
        default_fields: AttrPathMap[TItemKeys],
    ) -> type[TClass]:
        assert not self.attached, "Projector config can only be attached once"
        self._attached_class = cls
        self._fields = list(fields)
        self._default_fields = dict(default_fields)
        self.attached = True
        setattr(cls, attach_field, self)

        def finalize(
            instance: Any, _args: tuple[Any, ...], _kwargs: dict[str, Any]
        ) -> None:
            self.finalize_for_target(instance)

        install_once_init_hook(cls, finalize, timing="after")
        return cls

    def assert_attached(self) -> None:
        assert self.attached, (
            "Projector config must be attached before getting projector"
        )

    def _required_fields(self) -> tuple[TItemKeys, ...]:
        return ()

    def _build_projector(
        self,
        *,
        target: Any | None = None,
    ) -> AttrProjector[Any, TItemKeys]:
        self.assert_attached()
        assert self._attached_class is not None
        return make_projector_for_target(
            self._attached_class,
            self.projector_dict_init,
            self._fields,
            self._default_fields,
            required_fields=self._required_fields(),
            target=target,
        )

    def finalize_for_target(self, target: Any) -> None:
        self._projector = self._build_projector(target=target)

    def get_projector(self) -> AttrProjector[Any, TItemKeys]:
        self.assert_attached()
        if self._projector is None:
            self._projector = self._build_projector()
        return self._projector


item = BindItemConfig

# endregion

# region Agent


_agent_field_defaults: AttrPathMap[AgentItemFields] = {
    "id": "id",
    "x": "x",
    "y": "y",
}

_agent_fields: list[tuple[Callable[[Any], bool], AttrPathMap[AgentItemFields]]] = [
    (
        is_mesa_agent_class,
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
        id: str | None = None,
        x: ProjectorFieldForInit = None,
        y: ProjectorFieldForInit = None,
        heading: ProjectorFieldForInit = None,
        color: ProjectorFieldForInit = None,
        icon: ProjectorFieldForInit = None,
        size: ProjectorFieldForInit = None,
        data: ProjectorFieldForInit = None,
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

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(
            cls,
            self.binding_name,
            _agent_fields,
            _agent_field_defaults,
        )

    def _required_fields(self) -> tuple[AgentItemFields, ...]:
        return ("id", "x", "y")


agent = BindAgentConfig


_id_field_defaults: AttrPathMap[Literal["id"]] = {
    "id": "id",
}

_id_fields: list[tuple[Callable[[Any], bool], AttrPathMap[Literal["id"]]]] = [
    (
        is_mesa_agent_class,
        {
            "id": "unique_id",
        },
    )
]


class BindUniformAgentConfig(BindItemConfig[UniformAgentItemFields]):
    binding_name = _binding_name("item", "uniform_agent")

    def __init__(
        self,
        id: str | None = None,
        color: ProjectorFieldForInit = None,
        icon: ProjectorFieldForInit = None,
        size: ProjectorFieldForInit = None,
        data: ProjectorFieldForInit = None,
    ) -> None:
        super().__init__(
            id=id,
            color=color,
            icon=icon,
            size=size,
            data=data,
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(
            cls,
            self.binding_name,
            cast(ProjectorDictFilterList[UniformAgentItemFields], _id_fields),
            cast(AttrPathMap[UniformAgentItemFields], _id_field_defaults),
        )

    def _required_fields(self) -> tuple[UniformAgentItemFields, ...]:
        return ("id",)


uniform_agent = BindUniformAgentConfig


# endregion

# region Edge


class BindEdgeConfig(BindItemConfig[EdgeItemFields]):
    binding_name = _binding_name("item", "edge")

    def __init__(
        self,
        source: str = "source",
        target: str = "target",
        directed: ProjectorFieldForInit = None,
        style: ProjectorFieldForInit = None,
        color: ProjectorFieldForInit = None,
        width: ProjectorFieldForInit = None,
    ) -> None:
        super().__init__(
            source=source,
            target=target,
            directed=directed,
            style=style,
            color=color,
            width=width,
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, self.binding_name, [], {})

    def _required_fields(self) -> tuple[EdgeItemFields, ...]:
        return ("source", "target")


edge = BindEdgeConfig


# endregion

# region Trajectory


class BindTrajectoryConfigConfig(BindItemConfig[TrajectoryConfigItemFields]):
    binding_name = _binding_name("item", "trajectory")

    def __init__(
        self,
        id: str | None = None,
        length: ProjectorFieldForInit = "length",
        width: ProjectorFieldForInit = "width",
        color: ProjectorFieldForInit = "color",
    ) -> None:
        super().__init__(
            id=id,
            length=length,
            width=width,
            color=color,
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(
            cls,
            self.binding_name,
            cast(ProjectorDictFilterList[TrajectoryConfigItemFields], _id_fields),
            cast(AttrPathMap[TrajectoryConfigItemFields], _id_field_defaults),
        )

    def _required_fields(self) -> tuple[TrajectoryConfigItemFields, ...]:
        return ("id",)


trajectory_item = BindTrajectoryConfigConfig


# endregion

# region General Layer

_layer_binding_name = _binding_name("layer", "general")
_layer_binding_configs_name = "_tensnap_layer_binding_configs"
_layer_binding_config_objects_name = "_tensnap_layer_binding_config_objects"


def _append_layer_binding(
    cls: type[TClass],
    binding: LayerBinding[Any, Any, Any, Any],
) -> type[TClass]:
    bindings = list(
        getattr(
            cls,
            _layer_binding_configs_name,
            getattr(cls, _layer_binding_name, []),
        )
    )
    bindings.append(binding)
    setattr(cls, _layer_binding_configs_name, bindings)
    setattr(cls, _layer_binding_name, bindings)
    return cls


def _append_layer_config(
    cls: type[TClass],
    config: "BindLayerConfig[Any, Any]",
) -> type[TClass]:
    configs = list(getattr(cls, _layer_binding_config_objects_name, []))
    configs.append(config)
    setattr(cls, _layer_binding_config_objects_name, configs)
    return cls


class BindLayerConfig(Generic[TMetadataKeys, TItemKeys]):
    def __init__(
        self,
        layer_id: str,
        layer_type: str,
        item_keys: tuple[TItemKeys, ...] | None,
        *,
        metadata: (
            AttrProjector[Any, TMetadataKeys]
            | MetadataDictForInit[TMetadataKeys]
            | None
        ) = None,
        item_iterable_projector: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        item_projector: LayerItemProjectorForInit[TItemKeys] | None = None,
        item_dynamic_projector: (
            DynamicAttrProjector[Any, Any, TItemKeys] | str | None
        ) = None,
        item_id_getter: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
        item_changed_getter: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        items_projector: LayerItemsProjectorForInit[TItemKeys] | None = None,
        dependency_layer_ids: LayerDependencyIds | None = None,
        item_projector_name: ProjectorName | None = None,
        inferred_item_projector: Callable[[Any], dict[TItemKeys, Any]] | None = None,
        iterable: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
        item: LayerItemProjectorForInit[TItemKeys] | None = None,
        id_getter: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
        changed_getter: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
    ) -> None:
        if item_iterable_projector is not None and iterable is not None:
            raise ValueError(
                "Use either item_iterable_projector or iterable, not both."
            )
        if item_projector is not None and item is not None:
            raise ValueError("Use either item_projector or item, not both.")
        if item_id_getter is not None and id_getter is not None:
            raise ValueError("Use either item_id_getter or id_getter, not both.")
        if item_changed_getter is not None and changed_getter is not None:
            raise ValueError(
                "Use either item_changed_getter or changed_getter, not both."
            )

        self.layer_id = layer_id
        self.layer_type = layer_type
        self.item_keys = item_keys
        self.init_metadata = metadata
        self.init_item_iterable_projector = (
            iterable if item_iterable_projector is None else item_iterable_projector
        )
        self.init_item_projector = item if item_projector is None else item_projector
        self.init_item_dynamic_projector = item_dynamic_projector
        self.init_item_id_getter = (
            id_getter if item_id_getter is None else item_id_getter
        )
        self.init_item_changed_getter = (
            changed_getter if item_changed_getter is None else item_changed_getter
        )
        self.init_items_projector = items_projector
        self.item_projector_names = _normalize_projector_names(item_projector_name)
        self.inferred_item_projector = inferred_item_projector
        self.dependency_layer_ids = dict(dependency_layer_ids or {})

        self._attached_class: type[Any] | None = None
        self._metadata_fields: ProjectorDictFilterList[TMetadataKeys] = []
        self._metadata_default_fields: AttrPathMap[TMetadataKeys] = {}
        self.binding: LayerBinding[Any, TMetadataKeys, Any, TItemKeys] | None = None
        self.attached = False

    def _build_metadata_projector(
        self,
        cls: type[Any],
        metadata_fields: ProjectorDictFilterList[TMetadataKeys],
        metadata_default_fields: AttrPathMap[TMetadataKeys],
        *,
        target: Any | None = None,
    ) -> AttrProjector[Any, TMetadataKeys] | None:
        if callable(self.init_metadata):
            return self.init_metadata
        if not isinstance(self.init_metadata, dict):
            return None
        if not self.init_metadata:
            return None
        return make_projector_for_target(
            cls,
            self.init_metadata,
            metadata_fields,
            metadata_default_fields,
            target=target,
        )

    def _build_binding(
        self,
        cls: type[Any],
        metadata_fields: ProjectorDictFilterList[TMetadataKeys],
        metadata_default_fields: AttrPathMap[TMetadataKeys],
        *,
        target: Any | None = None,
    ) -> LayerBinding[Any, TMetadataKeys, Any, TItemKeys]:
        metadata_projector = self._build_metadata_projector(
            cls,
            metadata_fields,
            metadata_default_fields,
            target=target,
        )

        iterable_getter = resolve_layer_getter(cls, self.init_item_iterable_projector)
        resolved_items_projector = _resolve_items_projector(
            cls,
            self.init_items_projector,
        )
        item_id_getter = resolve_layer_getter(cls, self.init_item_id_getter)
        item_changed_getter = resolve_layer_getter(
            cls,
            self.init_item_changed_getter,
        )

        resolved_item_projector: AttrProjector[Any, TItemKeys] | None = None
        resolved_item_dynamic_projector: (
            DynamicAttrProjector[Any, Any, TItemKeys] | None
        ) = None

        if self.init_item_dynamic_projector is not None:
            resolved_item_dynamic_projector = _resolve_explicit_dynamic_item_projector(
                cls,
                self.init_item_dynamic_projector,
            )
        elif self.init_item_projector is not None:
            raw_item_projector = _try_resolve_item_projector(
                cls,
                self.init_item_projector,
                self.item_projector_names,
            )
            if raw_item_projector is None:
                raise ValueError(
                    f"Cannot resolve item projector {self.init_item_projector!r} "
                    f"for layer {self.layer_id}."
                )
            resolved_item_projector = cast(
                AttrProjector[Any, TItemKeys],
                raw_item_projector,
            )
        elif iterable_getter is not None:
            fallback_projector = self.inferred_item_projector or cast(
                Callable[[Any], dict[TItemKeys, Any]],
                _identity_item_to_dict,
            )
            resolved_item_dynamic_projector = _make_inferred_item_dynamic_projector(
                self.item_projector_names,
                fallback_projector,
            )

        if (
            resolved_items_projector is None
            and iterable_getter is None
            and resolved_item_projector is None
            and resolved_item_dynamic_projector is None
        ):
            resolved_items_projector = cast(
                ItemsProjector[Any, TItemKeys],
                _empty_items_projector,
            )

        return LayerBinding(
            layer_id=self.layer_id,
            layer_type=self.layer_type,
            item_keys=self.item_keys or (),
            dependency_layer_ids=self.dependency_layer_ids,
            metadata_projector=metadata_projector,
            iterable_getter=iterable_getter,
            item_projector=resolved_item_projector,
            item_dynamic_projector=resolved_item_dynamic_projector,
            item_id_getter=item_id_getter,
            item_changed_getter=item_changed_getter,
            items_projector=resolved_items_projector,
        )

    def attach(
        self,
        cls: type[TClass],
        metadata_fields: ProjectorDictFilterList[TMetadataKeys],
        metadata_default_fields: AttrPathMap[TMetadataKeys],
    ) -> type[TClass]:
        assert not self.attached, "Layer config can only be attached once"
        self._attached_class = cls
        self._metadata_fields = list(metadata_fields)
        self._metadata_default_fields = dict(metadata_default_fields)
        self.binding = self._build_binding(
            cls,
            self._metadata_fields,
            self._metadata_default_fields,
        )

        self.attached = True

        def finalize(
            instance: Any, _args: tuple[Any, ...], _kwargs: dict[str, Any]
        ) -> None:
            self.finalize_for_target(instance)

        install_once_init_hook(cls, finalize, timing="after")
        _append_layer_config(cls, self)
        return _append_layer_binding(cls, self.binding)

    def get_binding(self) -> LayerBinding[Any, TMetadataKeys, Any, TItemKeys]:
        assert self.attached, "Layer config must be attached before getting binding"
        assert self.binding is not None
        return self.binding

    def get_binding_for_target(
        self,
        target: Any,
    ) -> LayerBinding[Any, TMetadataKeys, Any, TItemKeys]:
        assert self.attached, "Layer config must be attached before getting binding"
        assert self._attached_class is not None
        return self._build_binding(
            self._attached_class,
            self._metadata_fields,
            self._metadata_default_fields,
            target=target,
        )

    def finalize_for_target(self, target: Any) -> None:
        assert self.attached, "Layer config must be attached before finalizing"
        assert self.binding is not None
        assert self._attached_class is not None
        self.binding.metadata_projector = self._build_metadata_projector(
            self._attached_class,
            self._metadata_fields,
            self._metadata_default_fields,
            target=target,
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, [], {})


layer = BindLayerConfig

# endregion

# region Background Layer


class BindBackgroundLayerConfig(BindLayerConfig[BackgroundLayerMetadataFields, str]):
    def __init__(
        self,
        layer_id: str = "background",
        *,
        background: ProjectorFieldForInit = None,
        interpolation: ProjectorFieldForInit = None,
        z_index: ProjectorFieldForInit = None,
    ) -> None:
        super().__init__(
            layer_id,
            "background",
            None,
            metadata={
                "background": background,
                "interpolation": interpolation,
                "z_index": z_index,
            },
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, [], {})


background_layer = BindBackgroundLayerConfig

# endregion

# region Grid Layer


class BindGridLayerConfig(BindLayerConfig[GridLayerMetadataFields, str]):
    def __init__(
        self,
        layer_id: str = "grid",
        *,
        width: ProjectorFieldForInit = None,
        height: ProjectorFieldForInit = None,
        x_origin: ProjectorFieldForInit = None,
        x_unit: ProjectorFieldForInit = None,
        x_interval: ProjectorFieldForInit = None,
        x_ratio: ProjectorFieldForInit = None,
        y_origin: ProjectorFieldForInit = None,
        y_unit: ProjectorFieldForInit = None,
        y_interval: ProjectorFieldForInit = None,
        y_ratio: ProjectorFieldForInit = None,
        stroke_color: ProjectorFieldForInit = None,
        z_index: ProjectorFieldForInit = None,
    ) -> None:
        metadata_dict: MetadataDictForInit[GridLayerMetadataFields] = {
            "width": width,
            "height": height,
            "x_origin": x_origin,
            "x_unit": x_unit,
            "x_interval": x_interval,
            "x_ratio": x_ratio,
            "y_origin": y_origin,
            "y_unit": y_unit,
            "y_interval": y_interval,
            "y_ratio": y_ratio,
            "stroke_color": stroke_color,
            "z_index": z_index,
        }
        super().__init__(
            layer_id,
            "grid",
            None,
            metadata=metadata_dict,
        )


grid_layer = BindGridLayerConfig

# endregion

# region Agent Layer


class BindAgentLayerConfig(BindLayerConfig[AgentLayerMetadataFields, AgentItemFields]):
    def __init__(
        self,
        layer_id: str = "agents",
        *,
        uniform: bool = False,
        width: ProjectorFieldForInit = None,
        height: ProjectorFieldForInit = None,
        coord_offset: ProjectorFieldForInit = None,
        z_index: ProjectorFieldForInit = None,
        item_iterable_projector: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        item_projector: LayerItemProjectorForInit[AgentItemFields] | None = None,
        item_dynamic_projector: (
            DynamicAttrProjector[Any, Any, AgentItemFields] | str | None
        ) = None,
        item_id_getter: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
        item_changed_getter: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        items_projector: LayerItemsProjectorForInit[AgentItemFields] | None = None,
    ) -> None:
        resolved_iterable = item_iterable_projector
        if resolved_iterable is None and items_projector is None:
            resolved_iterable = layer_id

        super().__init__(
            layer_id,
            "agent",
            ("id",),
            metadata={
                "width": width,
                "height": height,
                "coord_offset": coord_offset,
                "z_index": z_index,
            },
            item_iterable_projector=resolved_iterable,
            item_projector=item_projector,
            item_dynamic_projector=item_dynamic_projector,
            item_id_getter=item_id_getter,
            item_changed_getter=item_changed_getter,
            items_projector=items_projector,
            item_projector_name=(
                BindUniformAgentConfig.binding_name
                if uniform
                else BindAgentConfig.binding_name
            ),
            inferred_item_projector=cast(
                Callable[[Any], dict[AgentItemFields, Any]],
                _identity_item_to_dict,
            ),
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, [], {})


agent_layer = BindAgentLayerConfig

# endregion

# region Edge Layer


class BindEdgeLayerConfig(BindLayerConfig[EdgeLayerMetadataFields, EdgeItemFields]):
    def __init__(
        self,
        layer_id: str = "edges",
        *,
        link_distance: ProjectorFieldForInit = None,
        charge_strength: ProjectorFieldForInit = None,
        centering_strength: ProjectorFieldForInit = None,
        collision_radius: ProjectorFieldForInit = None,
        max_component_distance: ProjectorFieldForInit = None,
        component_spacing: ProjectorFieldForInit = None,
        z_index: ProjectorFieldForInit = None,
        item_iterable_projector: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        item_projector: LayerItemProjectorForInit[EdgeItemFields] | None = None,
        item_dynamic_projector: (
            DynamicAttrProjector[Any, Any, EdgeItemFields] | str | None
        ) = None,
        item_id_getter: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
        item_changed_getter: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        items_projector: LayerItemsProjectorForInit[EdgeItemFields] | None = None,
        agent_layer_id: str = "agents",
    ) -> None:
        resolved_iterable = item_iterable_projector
        if resolved_iterable is None and items_projector is None:
            resolved_iterable = layer_id

        super().__init__(
            layer_id,
            "edge",
            ("source", "target"),
            metadata={
                "link_distance": link_distance,
                "charge_strength": charge_strength,
                "centering_strength": centering_strength,
                "collision_radius": collision_radius,
                "max_component_distance": max_component_distance,
                "component_spacing": component_spacing,
                "z_index": z_index,
            },
            item_iterable_projector=resolved_iterable,
            item_projector=item_projector,
            item_dynamic_projector=item_dynamic_projector,
            item_id_getter=item_id_getter,
            item_changed_getter=item_changed_getter,
            items_projector=items_projector,
            dependency_layer_ids={"agent": agent_layer_id},
            item_projector_name=BindEdgeConfig.binding_name,
            inferred_item_projector=cast(
                Callable[[Any], dict[EdgeItemFields, Any]],
                _edge_item_to_dict,
            ),
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, [], {})


edge_layer = BindEdgeLayerConfig

# endregion

# region Trajectory Layer


class BindTrajectoryLayerConfig(
    BindLayerConfig[TrajectoryLayerMetadataFields, TrajectoryConfigItemFields]
):
    def __init__(
        self,
        layer_id: str = "trails",
        *,
        length: ProjectorFieldForInit = None,
        width: ProjectorFieldForInit = None,
        color: ProjectorFieldForInit = None,
        z_index: ProjectorFieldForInit = None,
        item_iterable_projector: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        item_projector: (
            LayerItemProjectorForInit[TrajectoryConfigItemFields] | None
        ) = None,
        item_dynamic_projector: (
            DynamicAttrProjector[Any, Any, TrajectoryConfigItemFields] | str | None
        ) = None,
        item_id_getter: AttrGetter[Any] | ProjectorField | Literal[False] | None = None,
        item_changed_getter: (
            AttrGetter[Any] | ProjectorField | Literal[False] | None
        ) = None,
        items_projector: (
            LayerItemsProjectorForInit[TrajectoryConfigItemFields] | None
        ) = None,
        agent_layer_id: str = "agents",
    ) -> None:
        resolved_iterable = item_iterable_projector
        if (
            resolved_iterable is None
            and items_projector is None
            and (item_projector is not None or item_dynamic_projector is not None)
        ):
            resolved_iterable = agent_layer_id

        metadata_dict: MetadataDictForInit[TrajectoryLayerMetadataFields] = {
            "length": length,
            "width": width,
            "color": color,
            "z_index": z_index,
        }
        super().__init__(
            layer_id,
            "trajectory",
            ("id",),
            metadata=metadata_dict,
            item_iterable_projector=resolved_iterable,
            item_projector=item_projector,
            item_dynamic_projector=item_dynamic_projector,
            item_id_getter=item_id_getter,
            item_changed_getter=item_changed_getter,
            items_projector=items_projector,
            dependency_layer_ids={"agent": agent_layer_id},
            item_projector_name=BindTrajectoryConfigConfig.binding_name,
            inferred_item_projector=cast(
                Callable[[Any], dict[TrajectoryConfigItemFields, Any]],
                _identity_item_to_dict,
            ),
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, [], {})


trajectory_layer = BindTrajectoryLayerConfig


# endregion
