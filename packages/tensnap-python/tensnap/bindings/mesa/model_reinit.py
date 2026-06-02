"""Mesa-side helpers for rebuilding already-registered model objects."""

from __future__ import annotations

import importlib
import inspect
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, TypeAlias, cast

import tensnap.bindings as binding_api
from tensnap.bindings import BindParametersConfig
from tensnap.models import Parameter, create_parameter
from tensnap.models.parameter import ParameterType
from tensnap.utils.attr import make_attr_getter
from tensnap.utils.init_hook import OnceInitHookHandle, install_once_init_hook

if TYPE_CHECKING:
    from tensnap.scenario import SimulationScenario


RegistryChanges: TypeAlias = dict[str, list[str]]
CleanupCallback: TypeAlias = Callable[[], None]
RegisterModelCallback: TypeAlias = Callable[
    ..., RegistryChanges | Awaitable[RegistryChanges]
]


_MISSING = object()
_DEFAULT = object()
_BIND_KWARGS_CONFIG_ATTR = "_tensnap_bind_kwargs_config"


def merge_registry_changes(*changes: RegistryChanges) -> RegistryChanges:
    merged: RegistryChanges = {}
    for change in changes:
        for kind, ids in change.items():
            merged.setdefault(kind, []).extend(ids)
    return merged


def cleanup_mesa_model_step(model: object) -> None:
    """Remove Mesa's instance-level step wrapper before calling __init__ again."""
    if "step" in vars(model):
        delattr(model, "step")


def _is_probably_mesa_model_class(cls: type[Any]) -> bool:
    model_cls: Any = None
    try:
        model_cls = getattr(importlib.import_module("mesa"), "Model", None)
    except Exception:
        pass

    if isinstance(model_cls, type):
        return issubclass(cls, model_cls)

    return any(
        base.__name__ == "Model"
        and (base.__module__ == "mesa" or base.__module__.startswith("mesa."))
        for base in getattr(cls, "__mro__", ())
    )


def default_cleanup_for_model(model: object) -> CleanupCallback | None:
    if _is_probably_mesa_model_class(model.__class__):

        def cleanup() -> None:
            cleanup_mesa_model_step(model)

        return cleanup
    return None


def _accepts_dry_run(register_model: RegisterModelCallback) -> bool:
    try:
        sig = inspect.signature(register_model)
    except (TypeError, ValueError):
        return False
    return any(
        param.kind is inspect.Parameter.VAR_KEYWORD or name == "dry_run"
        for name, param in sig.parameters.items()
    )


def _call_register_model(
    register_model: RegisterModelCallback, *, dry_run: bool
) -> RegistryChanges | Awaitable[RegistryChanges]:
    if _accepts_dry_run(register_model):
        return register_model(dry_run=dry_run)
    if dry_run:
        raise ValueError(
            "registered must be provided when register_model does not accept dry_run."
        )
    return register_model()


async def reinitialize_registered_model(
    scenario: SimulationScenario,
    *,
    registered: RegistryChanges,
    cleanup: CleanupCallback | Iterable[CleanupCallback] | None = None,
    init_model: Callable[[], None],
    register_model: RegisterModelCallback,
) -> RegistryChanges:
    """
    Rebuild a model whose scenario registrations are known.

    The caller owns both model construction policy and registration policy; this
    helper only enforces the lifecycle ordering.
    """
    scenario.remove_by_dict(registered)

    if cleanup is not None:
        callbacks: Iterable[CleanupCallback]
        callbacks = (cleanup,) if callable(cleanup) else cleanup
        for callback in callbacks:
            callback()

    init_model()

    next_registered = _call_register_model(register_model, dry_run=False)
    if inspect.isawaitable(next_registered):
        next_registered = await cast(Awaitable[RegistryChanges], next_registered)
    return cast(RegistryChanges, next_registered)


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
    p_type = _parameter_type(annotation, value)
    custom = config.get_custom_binding(name, p_type) or {}
    return create_parameter(id=name, type=p_type, value=value, **custom)


def _static_init_kwargs(cls: type[Any]) -> dict[str, dict[str, Any]]:
    sig = inspect.signature(cls.__init__)
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
            "annotation": (
                param.annotation
                if param.annotation is not inspect.Parameter.empty
                else None
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
        self.init_hook_handle: OnceInitHookHandle[Any] | None = None

    def __call__(self, cls: type[Any]) -> type[Any]:
        current = getattr(cls, _BIND_KWARGS_CONFIG_ATTR, None)
        if current is not None and current is not self:
            raise ValueError("Only one bind_kwargs config can be attached to a class.")

        self.bound_class = cls
        setattr(cls, _BIND_KWARGS_CONFIG_ATTR, self)
        self.init_hook_handle = install_once_init_hook(
            cls,
            lambda _instance, args, kwargs: self._capture_dynamic_defaults(
                args, kwargs
            ),
            timing="after",
        )
        return cls

    def _capture_dynamic_defaults(
        self, args: tuple[Any, ...], kwargs: dict[str, Any]
    ) -> None:
        if self.bound_class is None:
            return

        bound = _bind_init_arguments(self.bound_class, args, kwargs)
        if bound is None:
            self.dynamic_defaults.update(kwargs)
            return

        sig = inspect.signature(self.bound_class.__init__)
        for name, value in bound.arguments.items():
            if name == "self":
                continue
            param = sig.parameters.get(name)
            if param is not None and param.kind is inspect.Parameter.VAR_KEYWORD:
                self.dynamic_defaults.update(value)
            else:
                self.dynamic_defaults[name] = value

        self.dynamic_defaults.update(kwargs)

    def get_bindings(
        self,
        cls: type[Any],
        *,
        default_overrides: Mapping[str, Any] | None = None,
    ) -> list[KwargBinding]:
        static = _static_init_kwargs(cls)
        dynamic = dict(self.dynamic_defaults)
        if default_overrides:
            dynamic.update(default_overrides)

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

    This class is intentionally not a simulation handler. Users still register
    environments, layers, charts, actions, and ordinary model parameters through
    the scenario APIs they already use.
    """

    def __init__(
        self,
        model: object,
        kwarg_bindings: Sequence[KwargBinding] | None = None,
        *,
        init_args: Sequence[Any] = (),
        init_kwargs: Mapping[str, Any] | None = None,
    ) -> None:
        self.model = model
        self.init_args = list(init_args)
        self.kwarg_bindings = list(
            kwarg_bindings
            or get_bind_kwargs(model.__class__, default_overrides=init_kwargs)
        )
        self._kwarg_sources: dict[str, KwargValueSource] = {}
        self._registered: RegistryChanges = {}
        self._scenario: SimulationScenario | None = None
        self._register_model: RegisterModelCallback | None = None
        self._cleanup: CleanupCallback | Iterable[CleanupCallback] | None = None

        for binding in self.kwarg_bindings:
            if hasattr(type(self), binding.name):
                continue
            setattr(self, binding.name, getattr(model, binding.name, binding.default))
        self._refresh_kwarg_sources()

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
                if inspect.isfunction(model_attr):
                    getter = lambda fn=model_attr, model=self.model: fn(model)
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

            kwarg_sources[binding.name] = KwargValueSource(
                kwarg_name=binding.name,
                parameter_id=binding.parameter.id,
                owner="kwargs",
                getter=lambda name=binding.name, default=binding.default: getattr(
                    self, name, default
                ),
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
        return binding_api.parameters(self.model, *parameter_configs)

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
            parameters.append((binding.name, binding.parameter))
        return parameters

    def current_kwargs(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
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
        self.model.__init__(*self.init_args, **self.current_kwargs())

    def configure_reinit(
        self,
        scenario: SimulationScenario,
        *,
        registered: RegistryChanges | None = None,
        register_model: RegisterModelCallback | None = None,
        cleanup: CleanupCallback | Iterable[CleanupCallback] | None | object = _DEFAULT,
    ) -> None:
        if register_model is None:

            def register_default(*, dry_run: bool = False) -> RegistryChanges:
                return self.register_model(scenario, dry_run=dry_run)

            register_model = register_default
        if registered is None:
            inspected = _call_register_model(register_model, dry_run=True)
            if inspect.isawaitable(inspected):
                raise TypeError("register_model dry_run must return synchronously.")
            registered = cast(RegistryChanges, inspected)
        if cleanup is _DEFAULT:
            cleanup = default_cleanup_for_model(self.model)

        self._scenario = scenario
        self._registered = registered
        self._register_model = register_model
        self._cleanup = cast(
            CleanupCallback | Iterable[CleanupCallback] | None, cleanup
        )

    def register_model(
        self, scenario: SimulationScenario, *, dry_run: bool = False
    ) -> RegistryChanges:
        self._refresh_kwarg_sources(self._planned_model_parameters())
        model_changes = scenario.add_all(self.model, dry_run=dry_run)
        kwarg_parameter_changes = scenario.add_parameters(self, dry_run=dry_run)
        return merge_registry_changes(
            model_changes,
            kwarg_parameter_changes,
        )

    async def reinitialize(self) -> RegistryChanges:
        if self._scenario is None or self._register_model is None:
            raise RuntimeError("BoundModelReinitializer is not configured.")

        self._registered = await reinitialize_registered_model(
            self._scenario,
            registered=self._registered,
            cleanup=self._cleanup,
            init_model=self.reinitialize_model,
            register_model=self._register_model,
        )
        return self._registered

    async def model_init(self) -> None:
        await self.reinitialize()

    async def model_reset(self) -> None:
        await self.reinitialize()
