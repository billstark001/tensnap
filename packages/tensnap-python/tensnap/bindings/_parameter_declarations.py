"""Class-owned parameter declarations and ordered discovery configuration."""

from __future__ import annotations

import inspect
import re
from collections.abc import Callable, Sequence
from copy import deepcopy
from enum import Enum
from re import Pattern
from typing import (
    Any,
    ClassVar,
    Generic,
    Literal,
    TypeVar,
    cast,
    overload,
)

from tensnap.bindings.ownership import (
    append_class_metadata,
    read_class_metadata,
    require_class,
)
from tensnap.models.parameter import Parameter, ParameterType, create_parameter


class Unset(Enum):
    VALUE = 0


UNSET = Unset.VALUE
Resolvable = Any
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
        default: float | None = None,
        min: float | None = None,
        max: float | None = None,
        step: float | None = None,
    ) -> None: ...

    @overload
    def __init__(
        self,
        type: Literal["string"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: str | None = None,
    ) -> None: ...

    @overload
    def __init__(
        self,
        type: Literal["boolean"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: bool | None = None,
    ) -> None: ...

    @overload
    def __init__(
        self,
        type: Literal["enum"],
        *,
        id: str = "",
        label: str = "",
        allow_runtime_change: bool = True,
        default: str | None = None,
        options: list[str] | Callable[..., list[str]] | None = None,
        labels: dict[str, str] | Callable[..., dict[str, str]] | None = None,
    ) -> None: ...

    def __init__(  # noqa: PLR0913 - Public parameter declaration signature.
        self,
        type: ParameterType,
        *,
        default: Any = UNSET,
        id: str = "",
        label: Resolvable = UNSET,
        allow_runtime_change: bool | Unset = UNSET,
        min: Resolvable = UNSET,
        max: Resolvable = UNSET,
        step: Resolvable = UNSET,
        options: Resolvable = UNSET,
        labels: Resolvable = UNSET,
    ) -> None:
        self.fget: Callable[..., Any] | None = None
        self.fset: Callable[..., Any] | None = None
        self.type: ParameterType = type
        self.id = id
        supplied = {
            "default": default,
            "label": label,
            "allow_runtime_change": allow_runtime_change,
            "min": min,
            "max": max,
            "step": step,
            "options": options,
            "labels": labels,
        }
        self._specified = tuple(
            key for key, value in supplied.items() if value is not UNSET
        )
        self.default = None if default is UNSET else default
        self.label = "" if label is UNSET else label
        self.allow_runtime_change = (
            True if allow_runtime_change is UNSET else allow_runtime_change
        )
        self.min = None if min is UNSET else min
        self.max = None if max is UNSET else max
        self.step = None if step is UNSET else step
        self.options = None if options is UNSET else options
        self.labels = None if labels is UNSET else labels

    @property
    def metadata(self) -> Parameter:
        """Resolve standalone metadata on demand, without decoration-time reads."""
        return self.to_parameter()

    def _resolved_fields(self, owner: Any = None) -> dict[str, Any]:
        """Return only supplied declaration fields; defaults are applied later."""
        result: dict[str, Any] = {"type": self.type}
        if self.id:
            result["id"] = self.id
        for name in self._specified:
            if name != "default":
                result[name] = self._resolve(getattr(self, name), owner)
        return result

    def __call__(
        self, fget: Callable[..., TDecoratedValue]
    ) -> BindParameterConfig[TDecoratedValue]:
        if self.fget is not None:
            raise ValueError("A parameter declaration already has a getter")
        if not callable(fget):
            raise TypeError("@param requires a callable getter")
        self.fget = fget
        if not self.id:
            self.id = fget.__name__
        return cast("BindParameterConfig[TDecoratedValue]", self)

    @overload
    def __get__(
        self, instance: None, owner: Any
    ) -> BindParameterConfig[TParamValue]: ...

    @overload
    def __get__(self, instance: Any, owner: Any = None) -> TParamValue: ...

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
    ) -> BindParameterConfig[TParamValue]:
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
        value: Any = UNSET,
        owner: Any | None = None,
    ) -> Parameter:
        fields = self._resolved_fields(owner)
        fields.setdefault("id", field_name)
        if value is UNSET:
            value = self._resolve(self.default, owner)
        return create_parameter(value=value, **deepcopy(fields))


param = BindParameterConfig


T = TypeVar("T", bound=type)

FieldSelector = list[str] | str | None


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
    EXCLUDE_ALL: ClassVar[BindParametersConfig]
    EXPLICIT_ONLY: ClassVar[BindParametersConfig]

    def __init__(
        self,
        include: FieldSelector = None,
        exclude: FieldSelector = None,
        include_private: bool | None = None,
        custom_bindings: dict[str, Parameter] | None = None,
        include_explicit: bool | None = None,
    ) -> None:
        self.include_fields: set[str] | None
        self.exclude_fields: set[str] | None
        self.include_re: Pattern[str] | None
        self.exclude_re: Pattern[str] | None

        if isinstance(include, str):
            self.include_re = re.compile(include)
            self.include_fields = None
        else:
            self.include_fields = set(include) if include is not None else None
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

    def __str__(self) -> str:
        return (
            f"<BindParametersConfig: include={self.include_re or self.include_fields}, "
            f"exclude={self.exclude_re or self.exclude_fields}, "
            f"include_private={self.include_private}, "
            f"include_explicit={self.include_explicit}>"
        )

    def is_included_raw(self, field_name: str) -> bool | None:
        """
        Return whether this config explicitly includes a field.

        None means this config has no inclusion opinion.
        """
        if self.include_private is False and field_name.startswith("_"):
            return False

        if self.include_re is not None:
            return bool(self.include_re.match(field_name))

        if self.include_fields is not None:
            return field_name in self.include_fields

        return None

    def is_excluded_raw(self, field_name: str) -> bool | None:
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

    def is_included(self, field_name: str) -> bool | None:
        """
        Return the inclusion decision made by this config.

        Exclusion wins inside a single config. If this config has no relevant
        include or exclude rule, None is returned.
        """
        if self.include_private is not True and field_name.startswith("_"):
            return False
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
        require_class(cls, "@params")
        append_class_metadata(cls, self.CONFIG_LIST_ATTR, self)
        return cls

    def get_custom_binding(
        self, field_name: str, match_type: ParameterType | None = None
    ) -> dict[str, Any] | None:
        binding = self.custom_bindings.get(field_name)
        if binding is None or (match_type is not None and binding.type != match_type):
            return None
        custom = binding._copy_definition()
        custom.pop("value", None)
        if not custom["id"]:
            custom.pop("id")
        if not custom["label"]:
            custom.pop("label")
        custom["getter"] = binding.getter
        custom["setter"] = binding.setter
        return custom

    @classmethod
    def get_configs(cls, target_cls: type) -> list[BindParametersConfig]:
        """Return all configs attached to a class."""
        return list(read_class_metadata(target_cls, cls.CONFIG_LIST_ATTR, list) or [])

    @staticmethod
    def evaluate_is_included(
        configs: Sequence[BindParametersConfig],
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

        private = next(
            (
                config.include_private
                for config in reversed(configs)
                if config.include_private is not None
            ),
            False,
        )
        if field_name.startswith("_") and not private:
            return False
        for config in reversed(configs):
            if explicit and config.include_explicit is not None:
                return config.include_explicit
            excluded = config.is_excluded_raw(field_name)
            if excluded is True:
                return False
            if config.include_re is not None:
                return bool(config.include_re.match(field_name))
            if config.include_fields is not None:
                return field_name in config.include_fields
        return default

    @staticmethod
    def evaluate_custom_binding(
        configs: Sequence[BindParametersConfig],
        field_name: str,
    ) -> dict[str, Any]:
        # Complete Parameter definitions include their concrete defaults. A higher
        # priority type replaces lower incompatible definitions as a whole.
        effective_type: ParameterType | None = next(
            (
                config.custom_bindings[field_name].type
                for config in reversed(configs)
                if field_name in config.custom_bindings
            ),
            None,
        )
        result: dict[str, Any] = {}
        for config in configs:
            custom = config.get_custom_binding(field_name, effective_type)
            if custom is not None:
                result.update(custom)
        return result


params = BindParametersConfig

BindParametersConfig.EXCLUDE_ALL = BindParametersConfig(exclude=r".*")
BindParametersConfig.EXPLICIT_ONLY = BindParametersConfig(
    exclude=r".*", include_explicit=True
)
