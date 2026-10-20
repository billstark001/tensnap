"""Generic model lifecycle helpers for constructor-driven reinitialization."""

from __future__ import annotations

import inspect
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias, TypeVar, cast, get_type_hints

from tensnap.models import Parameter, create_parameter
from tensnap.models.parameter import ParameterType
from tensnap.utils.attr import make_attr_getter
from tensnap.utils.init_hook import install_init_hook

from .basic.parameter import (
    BindParametersConfig,
    get_annotated_parameter_config,
    get_parameter_metadata_from_object,
    unwrap_annotated_type,
)
from .mesa.utils import (
    cleanup_mesa_model_step as _cleanup_mesa_model_step,
    is_mesa_model_class,
)

RegistryChanges: TypeAlias = dict[str, list[str]]
CleanupCallback: TypeAlias = Callable[[], None]
_MISSING = object()
_BIND_KWARGS_CONFIG_ATTR = "_tensnap_bind_kwargs_config"
_CONSTRUCTED_KWARGS_ATTR = "_tensnap_constructed_kwargs"
TDecoratedClass = TypeVar("TDecoratedClass", bound=type[Any])


def merge_registry_changes(*changes: RegistryChanges) -> RegistryChanges:
    merged: RegistryChanges = {}
    for change in changes:
        for kind, ids in change.items():
            merged.setdefault(kind, []).extend(ids)
    return merged


def default_cleanup_for_model(model: object) -> CleanupCallback | None:
    if is_mesa_model_class(model.__class__):

        def cleanup() -> None:
            _cleanup_mesa_model_step(model)

        return cleanup
    return None


@dataclass
class KwargBinding:
    name: str
    default: Any
    required: bool
    annotation: Any | None
    parameter: Parameter


@dataclass
class KwargValueSource:
    kwarg_name: str
    parameter_id: str
    owner: Literal["kwargs", "model"]
    getter: Callable[[], Any]


def _parameter_type(annotation: Any | None, value: Any) -> ParameterType:
    annotation = unwrap_annotated_type(annotation)
    if annotation is bool or isinstance(value, bool):
        return "boolean"
    if annotation is str or isinstance(value, str):
        return "string"
    return "number"


def _make_parameter(
    name: str,
    value: Any,
    annotation: Any | None,
    config: BindParametersConfig,
) -> Parameter:
    annotated_binding = get_annotated_parameter_config(annotation)
    if annotated_binding is not None:
        return annotated_binding.to_parameter(field_name=name, value=value)

    p_type = _parameter_type(annotation, value)
    custom = config.get_custom_binding(name, p_type) or {}
    custom.pop("type", None)
    return create_parameter(
        id=name,
        type=p_type,
        value=value,
        **{"allow_runtime_change": False, **custom},
    )


def _static_init_kwargs(cls: type[Any]) -> dict[str, dict[str, Any]]:
    sig = inspect.signature(cls.__init__)
    try:
        hints = get_type_hints(cls.__init__, include_extras=True)
    except (NameError, TypeError, AttributeError):
        hints = {}
    result: dict[str, dict[str, Any]] = {}
    for name, param in sig.parameters.items():
        if name == "self":
            continue
        if param.kind not in (
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            continue

        has_default = param.default is not inspect.Parameter.empty
        result[name] = {
            "default": param.default if has_default else _MISSING,
            "required": not has_default,
            "annotation": hints.get(
                name,
                (
                    param.annotation
                    if param.annotation is not inspect.Parameter.empty
                    else None
                ),
            ),
        }
    return result


def _bind_init_arguments(
    cls: type[Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> inspect.BoundArguments | None:
    try:
        return inspect.signature(cls).bind_partial(*args, **kwargs)
    except (TypeError, ValueError):
        pass

    try:
        return inspect.signature(cls.__init__).bind_partial(None, *args, **kwargs)
    except (TypeError, ValueError):
        return None


class BindKwargsConfig(BindParametersConfig):
    """Decorator/config for binding model __init__ keyword arguments."""

    def __init__(
        self,
        include: Any = None,
        exclude: Any = None,
        include_private: bool = False,
        custom_bindings: dict[str, Parameter] | None = None,
    ) -> None:
        super().__init__(
            include=include,
            exclude=exclude,
            include_private=include_private,
            custom_bindings=custom_bindings,
        )
        self.bound_class: type[Any] | None = None
        self.dynamic_defaults: dict[str, Any] = {}
        self._captured_defaults = False

    def __call__(self, cls: TDecoratedClass) -> TDecoratedClass:
        current = getattr(cls, _BIND_KWARGS_CONFIG_ATTR, None)
        if current is not None and current is not self:
            raise ValueError("Only one bind_kwargs config can be attached to a class.")

        self.bound_class = cls
        setattr(cls, _BIND_KWARGS_CONFIG_ATTR, self)
        install_init_hook(cls, self._capture_dynamic_defaults, timing="after")
        return cls

    def _capture_dynamic_defaults(
        self, instance: Any, args: tuple[Any, ...], kwargs: dict[str, Any]
    ) -> None:
        if self.bound_class is None:
            return

        bound = _bind_init_arguments(self.bound_class, args, kwargs)
        constructed: dict[str, Any] = {}
        if bound is not None:
            sig = inspect.signature(self.bound_class.__init__)
            for name, value in bound.arguments.items():
                if name == "self":
                    continue
                param = sig.parameters.get(name)
                if param is not None and param.kind is inspect.Parameter.VAR_KEYWORD:
                    constructed.update(value)
                else:
                    constructed[name] = value

        constructed.update(kwargs)
        # Preserve class-level discovery from the first construction, while
        # recording the actual arguments separately on every live instance.
        if not self._captured_defaults:
            self.dynamic_defaults.update(constructed)
            self._captured_defaults = True
        if hasattr(instance, "__dict__"):
            setattr(instance, _CONSTRUCTED_KWARGS_ATTR, constructed)

    def get_bindings(
        self,
        cls: type[Any],
        *,
        default_overrides: Mapping[str, Any] | None = None,
    ) -> list[KwargBinding]:
        static = _static_init_kwargs(cls)
        # Class-level inspection may use the first observed call, but a bound
        # instance must never inherit extra **kwargs from another instance.
        dynamic = dict(
            self.dynamic_defaults if default_overrides is None else default_overrides
        )

        names = list(dict.fromkeys([*static, *dynamic]))
        bindings: list[KwargBinding] = []
        for name in names:
            if not self.evaluate_is_included([self], name):
                continue

            info = static.get(name, {})
            static_default = info.get("default", _MISSING)
            if default_overrides is not None and name in default_overrides:
                default = default_overrides[name]
                required = False
            elif static_default is not _MISSING:
                default = static_default
                required = False
            elif name in dynamic:
                default = dynamic[name]
                required = False
            else:
                default = None
                required = bool(info.get("required", False))

            annotation = info.get("annotation")
            bindings.append(
                KwargBinding(
                    name=name,
                    default=default,
                    required=required,
                    annotation=annotation,
                    parameter=_make_parameter(name, default, annotation, self),
                )
            )
        return bindings


def bind_kwargs(
    include: Any = None,
    exclude: Any = None,
    include_private: bool = False,
    custom_bindings: dict[str, Parameter] | None = None,
) -> BindKwargsConfig:
    return BindKwargsConfig(
        include=include,
        exclude=exclude,
        include_private=include_private,
        custom_bindings=custom_bindings,
    )


def get_bind_kwargs(
    cls: type[Any],
    *,
    default_overrides: Mapping[str, Any] | None = None,
) -> list[KwargBinding]:
    config = getattr(cls, _BIND_KWARGS_CONFIG_ATTR, None)
    if not isinstance(config, BindKwargsConfig):
        config = BindKwargsConfig()
    return config.get_bindings(cls, default_overrides=default_overrides)


class BoundModelReinitializer:
    """
    Keep constructor kwargs as parameters and rebuild a model in place.

    This is a construction strategy, with no scenario or registry ownership.
    ``SimulationScenario.register_model`` assembles registration and lifecycle.
    Excluded constructor choices can be retained in ``init_kwargs`` without
    exposing them as UI parameters.
    """

    def __init__(
        self,
        model: object,
        kwarg_bindings: Sequence[KwargBinding] | None = None,
        *,
        init_args: Sequence[Any] = (),
        init_kwargs: Mapping[str, Any] | None = None,
        cleanup: CleanupCallback | None = None,
    ) -> None:
        self.model = model
        self.init_args = list(init_args)
        self.init_kwargs = dict(init_kwargs or {})
        self._cleanup = (
            cleanup if cleanup is not None else default_cleanup_for_model(model)
        )
        self.kwarg_bindings = list(
            kwarg_bindings
            if kwarg_bindings is not None
            else get_bind_kwargs(
                model.__class__,
                default_overrides={
                    **getattr(model, _CONSTRUCTED_KWARGS_ATTR, {}),
                    **self.init_kwargs,
                },
            )
        )
        if self.init_args:
            positional = inspect.signature(type(model).__init__).bind_partial(
                model, *self.init_args
            )
            self.kwarg_bindings = [
                binding
                for binding in self.kwarg_bindings
                if binding.name not in positional.arguments
            ]
        self._kwarg_sources: dict[str, KwargValueSource] = {}
        # Constructor field names must never shadow strategy methods/resources.
        self._kwarg_values = {
            binding.name: getattr(model, binding.name, binding.default)
            for binding in self.kwarg_bindings
        }
        self.refresh_parameters()

    def _refresh_kwarg_sources(
        self,
        model_parameters: Sequence[tuple[str, Parameter]] | None = None,
    ) -> None:
        model_parameters = list(model_parameters or [])
        model_by_source = {
            source_name: param for source_name, param in model_parameters
        }
        model_by_param_id = {
            param.id: source_name for source_name, param in model_parameters
        }

        kwarg_sources: dict[str, KwargValueSource] = {}
        for binding in self.kwarg_bindings:
            model_param = model_by_source.get(binding.name)
            if model_param is not None:
                model_attr = getattr(self.model.__class__, binding.name, None)
                getter: Callable[[], Any]
                if model_param.getter is not None:
                    getter = model_param.getter
                elif inspect.isfunction(model_attr):
                    model_fn = cast(Callable[[Any], Any], model_attr)

                    def model_getter(
                        fn: Callable[[Any], Any] = model_fn,
                        model: Any = self.model,
                    ) -> Any:
                        return fn(model)

                    getter = model_getter

                else:
                    getter = cast(
                        Callable[[], Any],
                        make_attr_getter(binding.name, bind_target=self.model),
                    )
                kwarg_sources[binding.name] = KwargValueSource(
                    kwarg_name=binding.name,
                    parameter_id=model_param.id,
                    owner="model",
                    getter=getter,
                )
                continue

            conflicting_source = model_by_param_id.get(binding.parameter.id)
            if conflicting_source is not None:
                raise ValueError(
                    "Constructor kwarg parameter id conflict: "
                    f"kwarg {binding.name!r} and model field {conflicting_source!r} "
                    f"both publish parameter id {binding.parameter.id!r}."
                )

            def kwarg_getter(
                name: str = binding.name,
                default: Any = binding.default,
            ) -> Any:
                return self._kwarg_values.get(name, default)

            kwarg_sources[binding.name] = KwargValueSource(
                kwarg_name=binding.name,
                parameter_id=binding.parameter.id,
                owner="kwargs",
                getter=kwarg_getter,
            )

        self._kwarg_sources = kwarg_sources

    def _planned_model_parameters(self) -> list[tuple[str, Parameter]]:
        parameter_configs = (
            tuple(BindParametersConfig.get_configs(self.model.__class__))
            if hasattr(self.model, "__class__")
            else ()
        )
        if not parameter_configs:
            parameter_configs = (BindParametersConfig.EXCLUDE_ALL,)
        return get_parameter_metadata_from_object(self.model, *parameter_configs)

    def refresh_parameters(self) -> None:
        """Resolve constructor values against the model's current declarations."""
        self._refresh_kwarg_sources(self._planned_model_parameters())

    def sync_from_model(self) -> None:
        """Refresh construction choices after model-owned checkpoint restoration."""
        for name in self.init_kwargs:
            if hasattr(self.model, name):
                self.init_kwargs[name] = getattr(self.model, name)
        for binding in self.kwarg_bindings:
            source = self._kwarg_sources[binding.name]
            if source.owner == "kwargs" and hasattr(self.model, binding.name):
                self._kwarg_values[binding.name] = getattr(self.model, binding.name)
        self.refresh_parameters()

    def _capture_pending_values(self) -> dict[str, Any]:
        """Keep pending controls locally for a restore transaction's rollback."""
        return {
            name: self._kwarg_values[name]
            for name, source in self._kwarg_sources.items()
            if source.owner == "kwargs"
        }

    def _restore_pending_values(self, values: dict[str, Any]) -> None:
        """Recover transaction-local controls after rolling back model state."""
        self._kwarg_values.update(values)

    def __tensnap_parameter_metadata__(
        self, *cfg_suggest: BindParametersConfig
    ) -> list[tuple[str, Parameter]]:
        configs = list(cfg_suggest)
        parameters: list[tuple[str, Parameter]] = []
        for binding in self.kwarg_bindings:
            source = self._kwarg_sources.get(binding.name)
            if source is None or source.owner != "kwargs":
                continue
            if configs and not BindParametersConfig.evaluate_is_included(
                configs, binding.name
            ):
                continue
            def setter(value: Any, name: str = binding.name) -> None:
                self._kwarg_values[name] = value

            parameters.append((binding.name, binding.parameter.instantiate(
                getter=source.getter, setter=setter,
            )))
        return parameters

    def current_kwargs(self) -> dict[str, Any]:
        result: dict[str, Any] = dict(self.init_kwargs)
        for binding in self.kwarg_bindings:
            source = self._kwarg_sources.get(binding.name)
            if source is None:
                result[binding.name] = binding.default
                continue
            try:
                result[binding.name] = source.getter()
            except AttributeError:
                result[binding.name] = binding.default
        return result

    def reinitialize_model(self) -> None:
        kwargs = self.current_kwargs()
        if self._cleanup is not None:
            self._cleanup()
        model_init = cast(Callable[..., None], type(self.model).__init__)
        model_init(self.model, *self.init_args, **kwargs)
