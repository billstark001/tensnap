# tensnap/bindings/basic/parameters.py
"""Enhanced parameter decorators and bindings with automatic detection"""

from typing import (
    Annotated,
    Any,
    Callable,
    Optional,
    List,
    Tuple,
    get_args,
    get_origin,
    get_type_hints,
    overload,
    Union,
    Literal,
    Dict,
    TypeAlias,
)
from dataclasses import dataclass, asdict, field

import types
import re

try:
    from mesa import Model as MesaModel
except ImportError:
    MesaModel = None  # type: ignore


# region Parameter Classes

ParameterType = Literal["number", "enum", "action", "boolean", "string"]
ParameterTypeWithoutAction = Literal["number", "enum", "boolean", "string"]


@dataclass
class ParameterBase:
    id: str
    type: ParameterType
    label: str = ""
    allow_runtime_change: bool = True

    setter: Optional[Callable] = None
    getter: Optional[Callable] = None

    def refresh_label(self):
        if not self.label:
            self.label = self.id.replace("_", " ").title().strip()

    def __post_init__(self):
        self.refresh_label()

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        d = asdict(self)
        if "setter" in d:
            del d["setter"]
        if "getter" in d:
            del d["getter"]
        if "allow_runtime_change" in d:
            val = d["allow_runtime_change"]
            del d["allow_runtime_change"]
            d["allowRuntimeChange"] = val
        return d

    def instantiate(self, getter: Callable | None = None, setter: Callable | None = None) -> "Parameter":
        ret = create_parameter(**asdict(self))
        ret.getter = getter
        ret.setter = setter
        return ret

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        """从字典反序列化"""
        return cls(**data)


@dataclass
class NumberParameter(ParameterBase):
    type: Literal["number"] = "number"
    value: float = 0.0
    min: float = 0.0
    max: float = 100.0
    step: float = 1.0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NumberParameter":
        return cls(**data)


@dataclass
class EnumParameter(ParameterBase):
    type: Literal["enum"] = "enum"
    value: str = ""
    options: List[str] = field(default_factory=list)
    labels: Optional[Dict[str, str]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EnumParameter":
        return cls(**data)


@dataclass
class ActionParameter(ParameterBase):
    type: Literal["action"] = "action"

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ActionParameter":
        return cls(**data)


@dataclass
class BooleanParameter(ParameterBase):
    type: Literal["boolean"] = "boolean"
    value: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BooleanParameter":
        return cls(**data)


@dataclass
class StringParameter(ParameterBase):
    type: Literal["string"] = "string"
    value: str = ""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StringParameter":
        return cls(**data)


Parameter: TypeAlias = Union[
    NumberParameter, EnumParameter, ActionParameter, BooleanParameter, StringParameter
]


def create_parameter(
    id: str,
    type: ParameterType,
    label: Optional[str] = None,
    value: Optional[Union[float, str]] = None,
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    labels: Optional[Dict[str, str]] = None,
    setter: Optional[Callable] = None,
    getter: Optional[Callable] = None,
    allow_runtime_change: bool = True,
) -> Parameter:
    """根据字典数据创建对应类型的参数对象"""

    common_data = {
        "id": id,
        "label": label or "",
        "allow_runtime_change": allow_runtime_change,
        "setter": setter,
        "getter": getter,
    }

    if type == "number":
        return NumberParameter.from_dict(
            {
                **common_data,
                "value": value if value is not None else 0.0,
                "min": min,
                "max": max,
                "step": step,
            }
        )
    elif type == "enum":
        return EnumParameter.from_dict(
            {
                **common_data,
                "value": str(value) if value is not None else "",
                "options": options or [],
                "labels": labels,
            }
        )
    elif type == "action":
        return ActionParameter.from_dict(common_data)
    elif type == "boolean":
        return BooleanParameter.from_dict(
            {
                **common_data,
                "value": bool(value) if value is not None else False,
            }
        )
    elif type == "string":
        return StringParameter.from_dict(
            {
                **common_data,
                "value": str(value) if value is not None else "",
            }
        )
    else:
        raise ValueError(f"Unknown parameter type: {type}")


# endregion

# region Binding Utilities

class bind:

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
        type: ParameterTypeWithoutAction,
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


_MESA_FIELDS = {
    "running",
    "steps",
}

class BindParametersConfig:
    """Configuration for automatic parameter detection"""
    
    

    def __init__(
        self,
        include: Optional[List[str] | str] = None,
        exclude: Optional[List[str] | str] = None,
        include_private: bool = False,
        custom_bindings: Optional[Dict[str, Parameter]] = None,
    ):
        if isinstance(include, str):
            self.include_re = include
            self.include_fields = None
        else:
            self.include_fields = set(include) if include else None
            self.include_re = None
        if isinstance(exclude, str):
            self.exclude_re = exclude
            self.exclude_fields = None
        else:
            self.exclude_fields = set(exclude) if exclude else None
            self.exclude_re = None

        self.include_private = include_private
        self._exclude_mesa_fields = False
        self.custom_bindings = custom_bindings or {}

    def is_included_raw(self, field_name: str) -> bool:
        if self.include_re:
            if not re.match(self.include_re, field_name):
                return False
        if self.include_fields:
            if field_name not in self.include_fields:
                return False
        if self.include_private is False:
            if field_name.startswith('_'):
                return False
        return True

    def is_excluded_raw(self, field_name: str) -> bool:
        if self.exclude_re:
            if re.match(self.exclude_re, field_name):
                return True
        if self.exclude_fields:
            if field_name in self.exclude_fields:
                return True
        if self._exclude_mesa_fields:
            # Exclude common Mesa Model fields
            if field_name in _MESA_FIELDS:
                return True
        return False

    def is_included(self, field_name: str) -> bool:
        if not self.is_included_raw(field_name):
            return False
        if self.exclude_fields or self.exclude_re:
            if self.is_excluded_raw(field_name):
                return False
        return True

    def __call__(self, cls):
        """Decorator to apply config to a class"""
        cls._tensnap_bind_parameters_config = self  # type: ignore
        if MesaModel is not None and isinstance(cls, MesaModel):
            self._exclude_mesa_fields = True
        return cls


bind_parameters = BindParametersConfig  # Alias

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
                "metadata": [m.__dict__ for m in meta if isinstance(m, bind)],
            }
    return result


def get_parameter_metadata_from_namespace(
    namespace: Dict[str, Any], cfg_suggest: Optional[BindParametersConfig] = None
):
    """Find all parameter-decorated functions in a given namespace"""
    parameters: List[Tuple[str, Parameter]] = []
    actions: List[Tuple[str, Callable | None, ActionParameter]] = []
    for name, value in namespace.items():
        if name.startswith('__') and name.endswith('__'):
            continue
        if cfg_suggest is not None and not cfg_suggest.is_included(name):
            continue
        if isinstance(value, bind):
            if value.metadata.type == "action":
                actions.append(
                    (name, value.fget, value.metadata)
                )
            else:
                parameters.append((name, value.metadata))
        elif isinstance(value, (int, float, bool, str)) or value is None:
            val_type = (
                isinstance(value, bool)
                and "boolean"
                or isinstance(value, str)
                and "string"
                or "number"
            )
            parameters.append(
                (name, create_parameter(id=name, type=val_type, value=value))
            )
    return parameters, actions


def get_parameter_metadata_from_object(
    obj: Any, cfg_suggest: Optional[BindParametersConfig] = None
):
    """Find all parameter-decorated functions in a given object"""

    if isinstance(obj, dict):
        return get_parameter_metadata_from_namespace(obj, cfg_suggest)

    if isinstance(obj, types.ModuleType) or (
        hasattr(obj, "__dict__") and not hasattr(obj, "__class__")
    ):
        return get_parameter_metadata_from_namespace(vars(obj), cfg_suggest)

    if hasattr(obj, "__class__"):
        cls = obj.__class__
        cfg = getattr(cls, "_tensnap_bind_parameters_config", None) or cfg_suggest
        # 1. fetch class metadata
        # this overrides annotated config, but retains suggested config
        parameters, actions = get_parameter_metadata_from_namespace(
            vars(cls), cfg_suggest
        )
        # 2. annotated class fields
        # this also overrides annotated config
        field_metadata = get_field_metadata(cls)
        for field_name, field_info in field_metadata.items():
            if field_name.startswith('__') and field_name.endswith('__'):
                continue
            if cfg_suggest is not None and not cfg_suggest.is_included(field_name):
                continue
            for meta in field_info["metadata"]:
                if meta.type == "action":
                    continue  # this does not make sense for fields
                parameters.append((field_name, meta.metadata))
        # 3. fetch instance metadata
        keys_fetched = set(name for name, *_ in parameters + actions)
        for name in dir(obj):
            if name.startswith('__') and name.endswith('__'):
                continue
            if name in keys_fetched:
                continue
            if cfg is not None and not cfg.is_included(name):
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
            parameters.append(
                (name, create_parameter(id=name, type=val_type, value=value))
            )

        return parameters, actions

    raise ValueError("Unsupported object type for parameter metadata extraction")

# endregion