# tensnap/bindings/basic/parameters.py
"""Enhanced parameter decorators and bindings with automatic detection"""

from dataclasses import asdict
import inspect
from typing import (
    Annotated,
    Any,
    Callable,
    Optional,
    Pattern,
    ClassVar,
    Generic,
    List,
    Tuple,
    cast,
    get_args,
    get_origin,
    get_type_hints,
    overload,
    Union,
    TypeVar,
    Literal,
    Dict,
)

import types
import re

from tensnap.bindings.mesa.utils import is_mesa_model_class
from tensnap.models.parameter import (
    BooleanParameter,
    EnumParameter,
    NumberParameter,
    Parameter,
    ParameterBinding,
    ParameterState,
    ParameterType,
    StringParameter,
    create_parameter,
)

# region Binding Classes

Resolvable = Any | Callable[..., Any]
TParamValue = TypeVar("TParamValue")
TDecoratedValue = TypeVar("TDecoratedValue")


class BindParameterConfig(Generic[TParamValue]):

    @overload
    def __init__(
        self,
        type: Literal["number"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: Optional[float] = None,
        min: Optional[float] = None,
        max: Optional[float] = None,
        step: Optional[float] = None,
    ): ...

    @overload
    def __init__(
        self,
        type: Literal["string"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: Optional[str] = None,
    ): ...

    @overload
    def __init__(
        self,
        type: Literal["boolean"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: Optional[bool] = None,
    ): ...

    @overload
    def __init__(
        self,
        type: Literal["enum"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: Optional[str] = None,
        options: Optional[List[str] | Callable[..., List[str]]] = None,
        labels: Optional[Dict[str, str] | Callable[..., Dict[str, str]]] = None,
    ): ...

    def __init__(
        self,
        type: ParameterType,
        *,
        default: Optional[Any] = None,
        id: str = "",
        label: Resolvable = "",
        allow_runtime_change: bool = True,
        min: Resolvable = None,
        max: Resolvable = None,
        step: Resolvable = None,
        options: Optional[List[str] | Callable[..., List[str]]] = None,
        labels: Optional[Dict[str, str] | Callable[..., Dict[str, str]]] = None,
    ):

        self.fget: Optional[Callable[..., Any]] = None
        self.fset: Optional[Callable[..., Any]] = None

        self.type: ParameterType = type
        self.id = id
        self.label = label
        self.allow_runtime_change = allow_runtime_change
        self.default = default
        self.min = min
        self.max = max
        self.step = step
        self.options = options
        self.labels = labels
        self.metadata = self.to_parameter()

    def __call__(
        self, fget: Callable[..., TDecoratedValue]
    ) -> "BindParameterConfig[TDecoratedValue]":
        if self.fget is not None or not callable(fget):
            return cast("BindParameterConfig[TDecoratedValue]", self)
        self.fget = fget
        if not self.id:
            self.id = fget.__name__
        self.metadata = self.to_parameter()
        return cast("BindParameterConfig[TDecoratedValue]", self)

    @overload
    def __get__(self, instance: None, owner: Any) -> "BindParameterConfig[TParamValue]":
        ...

    @overload
    def __get__(self, instance: Any, owner: Any = None) -> TParamValue:
        ...

    def __get__(self, instance: Any, owner: Any = None) -> Any:
        if instance is None:
            return self
        if self.fget is None:
            raise AttributeError("Unreadable attribute")
        return self.fget(instance)

    def __set__(self, instance: Any, value: TParamValue) -> None:
        if self.fset is None:
            raise AttributeError("Can't set attribute")
        self.fset(instance, value)

    def setter(
        self,
        fset: Callable[..., Any],
    ) -> "BindParameterConfig[TParamValue]":
        self.fset = fset
        return self

    def _resolve(self, value: Any, owner: Any | None = None) -> Any:
        if not callable(value):
            return value

        try:
            signature = inspect.signature(value)
        except (TypeError, ValueError):
            return value(owner) if owner is not None else value()

        required_params = [
            param
            for param in signature.parameters.values()
            if param.default is inspect.Parameter.empty
            and param.kind
            in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                inspect.Parameter.KEYWORD_ONLY,
            )
        ]
        if required_params:
            if owner is None:
                return None
            return value(owner)
        return value()

    def to_parameter(
        self,
        *,
        field_name: str = "",
        value: Any = None,
        owner: Any | None = None,
    ) -> Parameter:
        resolved_default = self._resolve(self.default, owner)
        parameter_value = value if value is not None else resolved_default
        parameter = create_parameter(
            value=parameter_value,
            id=self.id or field_name,
            type=self.type,
            label=self._resolve(self.label, owner),
            allow_runtime_change=self.allow_runtime_change,
            min=self._resolve(self.min, owner),
            max=self._resolve(self.max, owner),
            step=self._resolve(self.step, owner),
            options=self._resolve(self.options, owner),
            labels=self._resolve(self.labels, owner),
        )
        parameter.refresh_label()
        return parameter


param = BindParameterConfig  # Alias


T = TypeVar("T", bound=type)

FieldSelector = Union[List[str], str, None]


class BindParametersConfig:
    """
    Configuration for automatic parameter detection.

    A single config uses tri-state decisions:

    - True: this config explicitly includes/excludes the field.
    - False: this config explicitly rejects the field.
    - None: this config has no opinion.

    Multiple configs can be stacked as decorators. They are stored on the
    decorated class, and later-added configs override earlier-added configs.
    """

    CONFIG_LIST_ATTR = "_tensnap_bind_parameters_config_list"
    EXCLUDE_ALL: ClassVar["BindParametersConfig"]
    EXPLICIT_ONLY: ClassVar["BindParametersConfig"]

    def __init__(
        self,
        include: FieldSelector = None,
        exclude: FieldSelector = None,
        include_private: bool = False,
        custom_bindings: Optional[Dict[str, Parameter]] = None,
        include_explicit: Optional[bool] = None,
    ) -> None:
        self.include_fields: Optional[set[str]]
        self.exclude_fields: Optional[set[str]]
        self.include_re: Optional[Pattern[str]]
        self.exclude_re: Optional[Pattern[str]]

        if isinstance(include, str):
            self.include_re = re.compile(include)
            self.include_fields = None
        else:
            self.include_fields = set(include) if include else None
            self.include_re = None

        if isinstance(exclude, str):
            self.exclude_re = re.compile(exclude)
            self.exclude_fields = None
        else:
            self.exclude_fields = set(exclude) if exclude else None
            self.exclude_re = None

        self.include_private = include_private
        self.custom_bindings = custom_bindings or {}
        self.include_explicit = include_explicit

    def __str__(self):
        return f"<BindParametersConfig: include={self.include_re or self.include_fields}, exclude={self.exclude_re or self.exclude_fields}, include_private={self.include_private}, include_explicit={self.include_explicit}>"

    def is_included_raw(self, field_name: str) -> Optional[bool]:
        """
        Return whether this config explicitly includes a field.

        None means this config has no inclusion opinion.
        """
        if not self.include_private and field_name.startswith("_"):
            return False

        if self.include_re is not None:
            return bool(self.include_re.match(field_name))

        if self.include_fields is not None:
            return field_name in self.include_fields

        return None

    def is_excluded_raw(self, field_name: str) -> Optional[bool]:
        """
        Return whether this config explicitly excludes a field.

        None means this config has no exclusion opinion.
        """
        if self.exclude_re is not None:
            if self.exclude_re.match(field_name):
                return True
            return None

        if self.exclude_fields is not None:
            if field_name in self.exclude_fields:
                return True
            return None

        return None

    def is_included(self, field_name: str) -> Optional[bool]:
        """
        Return the inclusion decision made by this config.

        Exclusion wins inside a single config. If this config has no relevant
        include or exclude rule, None is returned.
        """
        excluded = self.is_excluded_raw(field_name)
        if excluded is True:
            return False

        return self.is_included_raw(field_name)

    def __call__(self, cls: T) -> T:
        """
        Apply this config to a class as a decorator.

        Decorators are appended in the order in which Python calls them.
        The resolver evaluates the list from back to front, so later-added
        configs override earlier-added configs.
        """
        configs = list(getattr(cls, self.CONFIG_LIST_ATTR, []))
        configs.append(self)
        setattr(cls, self.CONFIG_LIST_ATTR, configs)
        return cls

    def get_custom_binding(
        self, field_name: str, match_type: ParameterType | None = None
    ):
        binding = self.custom_bindings.get(field_name, None)
        if not binding:
            return None
        if match_type is not None and binding.type != match_type:
            return None
        custom_dict = asdict(binding)
        custom_dict.pop("id", None)
        custom_dict.pop("value", None)

        return custom_dict

    @classmethod
    def get_configs(cls, target_cls: type) -> List["BindParametersConfig"]:
        """Return all configs attached to a class."""
        return list(getattr(target_cls, cls.CONFIG_LIST_ATTR, []))

    @staticmethod
    def evaluate_is_included(
        configs: List["BindParametersConfig"],
        field_name: str,
        *,
        default: bool = True,
        explicit: bool = False,
    ) -> bool:
        """
        Resolve the final inclusion decision for a field.

        Configs are evaluated from back to front. The first non-None decision
        wins. If every config returns None, `default` is returned.

        This method always returns a bool.
        """

        for config in reversed(configs):
            if explicit and config.include_explicit is not None:
                return config.include_explicit
            decision = config.is_included(field_name)
            if decision is not None:
                return decision

        return default

    @staticmethod
    def evaluate_custom_binding(
        configs: List["BindParametersConfig"],
        field_name: str,
    ):
        p_type: ParameterType | None = None
        # former dicts override latter dicts
        result_dicts: List[Dict[str, Any]] = []
        for config in reversed(configs):
            custom = config.get_custom_binding(field_name, p_type)
            if not custom:
                continue

            if p_type is None:
                custom_type: ParameterType = custom.pop("type")
                p_type = custom_type
            result_dicts.append(custom)

        result_dict = {}
        for d in reversed(result_dicts):
            result_dict.update(d)

        return result_dict


params = BindParametersConfig  # Alias

BindParametersConfig.EXCLUDE_ALL = BindParametersConfig(exclude=r".*")
BindParametersConfig.EXPLICIT_ONLY = BindParametersConfig(
    exclude=r".*", include_explicit=True
)


# endregion

# region Parameter Discovery and Creation


def create_getter_and_setter(
    target: Union[Dict[str, Any], object, types.ModuleType],
    key: str,
    default: Optional[Any] = None,
) -> tuple[Callable[[], Any], Callable[[Any], None]]:
    """Create getter and setter functions for a target key/attribute"""

    if isinstance(target, dict):

        def getter() -> Any:
            return target.get(key, default)

        def setter(value: Any) -> None:
            target[key] = value

    else:

        def getter() -> Any:
            return getattr(target, key, default)

        def setter(value: Any) -> None:
            setattr(target, key, value)

    return getter, setter


def _type_hints(target: Any):
    try:
        return get_type_hints(target, include_extras=True)
    except (NameError, TypeError, AttributeError):
        return {}


def _annotated_parameter_metadata(annotated: Any):
    if get_origin(annotated) is not Annotated:
        return None
    typ, *meta = get_args(annotated)
    metadata = [m for m in meta if isinstance(m, BindParameterConfig)]
    if not metadata:
        return None
    return {
        "type": typ,
        "metadata": metadata,
    }


def get_field_metadata(cls: "type"):
    hints = _type_hints(cls)
    result = {}
    for name, annotated in hints.items():
        metadata = _annotated_parameter_metadata(annotated)
        if metadata is not None:
            result[name] = metadata
    return result


def get_init_field_metadata(cls: "type"):
    init = getattr(cls, "__init__", None)
    if init is None:
        return {}
    hints = _type_hints(init)
    result = {}
    for name, annotated in hints.items():
        if name == "return":
            continue
        metadata = _annotated_parameter_metadata(annotated)
        if metadata is not None:
            result[name] = metadata
    return result


def get_annotated_parameter_config(annotation: Any) -> BindParameterConfig | None:
    metadata = _annotated_parameter_metadata(annotation)
    if metadata is None:
        return None
    for binding in metadata["metadata"]:
        return binding
    return None


def unwrap_annotated_type(annotation: Any) -> Any:
    if get_origin(annotation) is Annotated:
        return get_args(annotation)[0]
    return annotation


def _value_from_owner(owner: Any | None, field_name: str, default: Any = None) -> Any:
    if owner is None:
        return default
    try:
        return getattr(owner, field_name)
    except AttributeError:
        return default


def get_parameter_metadata_from_namespace(
    namespace: Dict[str, Any],
    *cfg_suggest: BindParametersConfig,
    owner: Any | None = None,
) -> List[Tuple[str, Parameter]]:
    """Find all parameter metadata in a given namespace."""
    cfg_list = list(cfg_suggest)
    parameters: List[Tuple[str, Parameter]] = []
    for name, value in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue
        # Chart descriptors are frequently installed by Mesa's DataCollector
        # as public ``get_tensnap_chart_data_*`` attributes.  Accessing one on
        # an instance evaluates it to a scalar, which used to make automatic
        # parameter discovery expose chart values as editable parameters.
        if _is_chart_binding_member(value):
            continue
        if isinstance(value, BindParameterConfig):
            if not BindParametersConfig.evaluate_is_included(
                cfg_list, name, explicit=True
            ):
                continue
            field_value = _value_from_owner(owner, name, value.metadata.value)
            parameters.append(
                (
                    name,
                    value.to_parameter(
                        field_name=name,
                        value=field_value,
                        owner=owner,
                    ),
                )
            )
        elif isinstance(value, (int, float, bool, str)) or value is None:
            if not BindParametersConfig.evaluate_is_included(cfg_list, name):
                continue
            val_type = (
                isinstance(value, bool)
                and "boolean"
                or isinstance(value, str)
                and "string"
                or "number"
            )
            custom_binding = (
                BindParametersConfig.evaluate_custom_binding(cfg_list, name) or {}
            )
            parameters.append(
                (
                    name,
                    create_parameter(
                        id=name, type=val_type, value=value, **custom_binding
                    ),
                )
            )
    return parameters


_default_mesa_parameter_config = BindParametersConfig(
    exclude=["agent_id_counter", "time", "running", "steps"]
)


def get_parameter_metadata_from_object(
    obj: Any, *cfg_suggest: BindParametersConfig
) -> List[Tuple[str, Parameter]]:
    """Find all parameter metadata in a given object."""

    provider = getattr(obj, "__tensnap_parameter_metadata__", None)
    if callable(provider):
        return provider(*cfg_suggest)  # type: ignore

    if isinstance(obj, dict):
        return get_parameter_metadata_from_namespace(obj, *cfg_suggest)

    if isinstance(obj, types.ModuleType) or (
        hasattr(obj, "__dict__") and not hasattr(obj, "__class__")
    ):
        return get_parameter_metadata_from_namespace(vars(obj), *cfg_suggest)

    if hasattr(obj, "__class__"):
        # 0. get config list
        cls = obj.__class__
        cfg_list: List[BindParametersConfig] = []
        if is_mesa_model_class(cls):
            cfg_list.append(_default_mesa_parameter_config)
        if cfg_suggest:
            cfg_list.extend(cfg_suggest)
        cfg_list.extend(BindParametersConfig.get_configs(cls))
        if not cfg_suggest:
            cfg_list.append(BindParametersConfig())

        # 1. fetch class metadata
        # this overrides annotated config, but retains suggested config
        parameters = get_parameter_metadata_from_namespace(
            vars(cls), *cfg_list, owner=obj
        )

        # 2. annotated class fields
        # this also overrides annotated config
        field_metadata = get_field_metadata(cls)
        for field_name, field_info in field_metadata.items():
            if field_name.startswith("__") and field_name.endswith("__"):
                continue
            if not BindParametersConfig.evaluate_is_included(
                cfg_list, field_name, explicit=True
            ):
                continue
            field_value = getattr(obj, field_name, None)
            for meta in field_info["metadata"]:
                parameters.append(
                    (
                        field_name,
                        meta.to_parameter(
                            field_name=field_name,
                            value=field_value,
                            owner=obj,
                        ),
                    )
                )

        # 3. fetch instance metadata
        init_field_metadata = get_init_field_metadata(cls)
        keys_fetched = set(name for name, *_ in parameters)
        for name in dir(obj):
            if name.startswith("__") and name.endswith("__"):
                continue
            if name in keys_fetched:
                continue
            if _is_chart_binding_member(inspect.getattr_static(cls, name, None)):
                continue
            field_info = init_field_metadata.get(name)
            is_explicit = field_info is not None
            if cfg_list and not BindParametersConfig.evaluate_is_included(
                cfg_list, name, explicit=is_explicit
            ):
                continue
            value = getattr(obj, name)
            if not isinstance(value, (int, float, bool, str)) and value is not None:
                continue
            if field_info is not None:
                for meta in field_info["metadata"]:
                    parameters.append(
                        (
                            name,
                            meta.to_parameter(field_name=name, value=value, owner=obj),
                        )
                    )
                continue
            val_type = (
                isinstance(value, bool)
                and "boolean"
                or isinstance(value, str)
                and "string"
                or "number"
            )
            custom_binding = (
                BindParametersConfig.evaluate_custom_binding(cfg_list, name) or {}
            )
            custom_binding.pop("type", None)
            parameters.append(
                (
                    name,
                    create_parameter(
                        id=name, type=val_type, value=value, **custom_binding
                    ),
                )
            )

        return parameters

    raise ValueError("Unsupported object type for parameter metadata extraction")


def _is_chart_binding_member(value: Any) -> bool:
    """Return true for direct or property-wrapped TenSnap chart descriptors.

    This intentionally relies only on the marker used by the chart decorator,
    avoiding an import cycle from parameter discovery into chart bindings.
    """
    if getattr(value, "_tensnap_chart", None) is not None:
        return True
    return isinstance(value, property) and value.fget is not None and getattr(
        value.fget, "_tensnap_chart", None
    ) is not None


# endregion
