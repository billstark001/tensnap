# tensnap/bindings/basic/parameters.py
"""Enhanced parameter decorators and bindings with automatic detection"""

from dataclasses import asdict
from typing import (
    Annotated,
    Any,
    Callable,
    Optional,
    Pattern,
    ClassVar,
    List,
    Tuple,
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
import importlib

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

try:
    MesaModel: Any = getattr(importlib.import_module("mesa"), "Model", None)
except ImportError:
    MesaModel = None


# region Binding Classes


class BindParameterConfig:

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
        options: Optional[List[str]] = None,
        labels: Optional[Dict[str, str]] = None,
    ): ...

    def __init__(
        self,
        type: ParameterType,
        *,
        default: Optional[Any] = None,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        min: Optional[float] = None,
        max: Optional[float] = None,
        step: Optional[float] = None,
        options: Optional[List[str]] = None,
        labels: Optional[Dict[str, str]] = None,
    ):

        self.fget: Optional[Callable] = None
        self.fset: Optional[Callable] = None

        self.metadata = create_parameter(
            value=default,
            id=id,
            type=type,
            label=label,
            allow_runtime_change=allow_runtime_change,
            min=min,
            max=max,
            step=step,
            options=options,
            labels=labels,
        )

    def __call__(self, fget: Callable):
        if self.fget is not None or not callable(fget):
            return self
        self.fget = fget
        self.metadata.id = self.metadata.id or fget.__name__
        self.metadata.refresh_label()
        return self

    def __get__(self, instance, owner):
        if instance is None:
            return self
        if self.fget is None:
            raise AttributeError("Unreadable attribute")
        return self.fget(instance)

    def __set__(self, instance, value):
        if self.fset is None:
            raise AttributeError("Can't set attribute")
        self.fset(instance, value)

    def setter(self, fset):
        self.fset = fset
        return fset


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

    def __init__(
        self,
        include: FieldSelector = None,
        exclude: FieldSelector = None,
        include_private: bool = False,
        custom_bindings: Optional[Dict[str, Parameter]] = None,
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

    def __str__(self):
        return f"<BindParametersConfig: include={self.include_re or self.include_fields}, exclude={self.exclude_re or self.exclude_fields}, include_private={self.include_private}>"

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
    ) -> bool:
        """
        Resolve the final inclusion decision for a field.

        Configs are evaluated from back to front. The first non-None decision
        wins. If every config returns None, `default` is returned.

        This method always returns a bool.
        """

        for config in reversed(configs):
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


def get_field_metadata(cls: "type"):
    hints = get_type_hints(cls, include_extras=True)
    result = {}
    for name, annotated in hints.items():
        if get_origin(annotated) is Annotated:
            typ, *meta = get_args(annotated)
            result[name] = {
                "type": typ,
                "metadata": [
                    m.__dict__ for m in meta if isinstance(m, BindParameterConfig)
                ],
            }
    return result


def get_parameter_metadata_from_namespace(
    namespace: Dict[str, Any],
    *cfg_suggest: BindParametersConfig,
) -> List[Tuple[str, Parameter]]:
    """Find all parameter metadata in a given namespace."""
    cfg_list = list(cfg_suggest)
    parameters: List[Tuple[str, Parameter]] = []
    for name, value in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue
        if not BindParametersConfig.evaluate_is_included(cfg_list, name):
            continue
        if isinstance(value, BindParameterConfig):
            parameters.append((name, value.metadata))
        elif isinstance(value, (int, float, bool, str)) or value is None:
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


def _is_probably_mesa_model_class(cls) -> bool:
    if not isinstance(cls, type):
        return False

    model_cls: Any = None
    try:
        import importlib

        model_cls = getattr(importlib.import_module("mesa"), "Model", None)
    except Exception:
        pass

    if isinstance(model_cls, type):
        return issubclass(cls, model_cls)

    return any(
        base.__name__ == "Agent"
        and (base.__module__ == "mesa" or base.__module__.startswith("mesa."))
        for base in getattr(cls, "__mro__", ())
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
        if _is_probably_mesa_model_class(cls):
            cfg_list.append(_default_mesa_parameter_config)
        if cfg_suggest:
            cfg_list.extend(cfg_suggest)
        cfg_list.extend(BindParametersConfig.get_configs(cls))
        if not cfg_suggest:
            cfg_list.append(BindParametersConfig())

        # 1. fetch class metadata
        # this overrides annotated config, but retains suggested config
        parameters = get_parameter_metadata_from_namespace(vars(cls), *cfg_list)

        # 2. annotated class fields
        # this also overrides annotated config
        field_metadata = get_field_metadata(cls)
        for field_name, field_info in field_metadata.items():
            if field_name.startswith("__") and field_name.endswith("__"):
                continue
            if not BindParametersConfig.evaluate_is_included(cfg_list, field_name):
                continue
            for meta in field_info["metadata"]:
                if meta.type == "action":
                    continue  # this does not make sense for fields
                parameters.append((field_name, meta.metadata))

        # 3. fetch instance metadata
        keys_fetched = set(name for name, *_ in parameters)
        for name in dir(obj):
            if name.startswith("__") and name.endswith("__"):
                continue
            if name in keys_fetched:
                continue
            if cfg_list and not BindParametersConfig.evaluate_is_included(
                cfg_list, name
            ):
                continue
            value = getattr(obj, name)
            if not isinstance(value, (int, float, bool, str)) and value is not None:
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


# endregion
