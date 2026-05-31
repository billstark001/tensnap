"""
TenSnap simulation scenario — orchestration layer.

Owns all simulation state (parameters, environments, charts, actions) and wires
server I/O events to a list of SimulationHandler callbacks.

SimulationLoop has been merged directly into SimulationScenario; the step /
start / reset coroutines are registered as actions during __init__.
"""

import logging
from collections.abc import Callable
from typing import (
    Any,
    List,
    Optional,
    TYPE_CHECKING,
)

import tensnap.bindings as binding_api

from tensnap.bindings.mesa.model_reinit import (
    BoundModelReinitializer,
    KwargBinding,
    RegistryChanges,
    cleanup_mesa_model_step,
    merge_registry_changes,
)
from tensnap.models import EnvironmentBinding, LayerBinding
from tensnap.scenario import DefaultSimulationHandler
from tensnap.utils.attr import make_attr_getter, make_attr_projector
from tensnap.utils.func import call_function
from typing_extensions import deprecated

if TYPE_CHECKING:
    from tensnap.scenario import SimulationScenario

logger = logging.getLogger(__name__)


# region Mesa-style environment binding factory


def build_default_layered_binder(
    model: Any,
    agent_iterable_projector: "str | Callable" = "agents",
) -> tuple[EnvironmentBinding, list[LayerBinding[Any, Any, Any, Any]]]:
    """
    Build default environment/layer bindings for a Mesa-style grid model.

    Assumes ``model.grid`` (with ``.width`` / ``.height``) and agents with
    ``unique_id`` and ``pos`` attributes.  No Mesa import at runtime.

    Args:
        model: The simulation model instance.
        agent_iterable_projector: Attribute name string or callable returning
            the agent iterable from the model.
    """
    if callable(agent_iterable_projector):
        direct_iterable_getter = agent_iterable_projector

        def resolved_iterable_getter(target: Any) -> Any:
            return direct_iterable_getter(target)

    else:
        _getter = make_attr_getter(str(agent_iterable_projector))

        def resolved_iterable_getter(target: Any) -> Any:
            val = _getter(target)
            return val() if callable(val) else val

    def grid_metadata(target: Any) -> dict[str, Any]:
        grid = target.grid
        return {
            "width": grid.width,
            "height": grid.height,
        }

    environment_binding = EnvironmentBinding(id=type(model).__name__, type="2d")
    grid_binding = LayerBinding(
        layer_id="grid",
        layer_type="grid",
        item_keys=(),
        metadata_projector=grid_metadata,
        items_projector=lambda _env: [],
    )
    agent_binding = LayerBinding(
        layer_id="agents",
        layer_type="agent",
        item_keys=("id",),
        iterable_getter=resolved_iterable_getter,
        item_projector=make_attr_projector(
            [],
            {"id": "unique_id", "x": "pos[0]", "y": "pos[1]"},
            {},
        ),
    )
    return environment_binding, [grid_binding, agent_binding]


# endregion


# region MesaSimulationHandler


@deprecated(
    "MesaSimulationHandler is deprecated; use BoundModelReinitializer with "
    "SimulationScenario.register_model_handler instead."
)
class MesaSimulationHandler(DefaultSimulationHandler):
    """
    Handler for Mesa models.

    Wraps Mesa model lifecycle (init, step) and auto-binds parameters,
    charts, and environment from the model class.
    """

    def __init__(
        self,
        model_class: type[Any],
        model_init_args: Optional[list] = None,
        model_init_kwargs: Optional[dict] = None,
        agent_iterable_projector: "str | Callable" = "agents",
        on_model_init: Optional[Callable] = None,
        on_model_step: Optional[Callable] = None,
        on_model_reset: Optional[Callable] = None,
        kwarg_bindings: Optional[list[KwargBinding]] = None,
    ) -> None:
        super().__init__(
            model_init=self._model_init_impl,
            model_step=self._model_step_impl,
            model_reset=self._model_reset_impl,
        )
        self.model_class = model_class
        self.model_init_args: list = model_init_args or []
        self.model_init_kwargs_orig: dict = model_init_kwargs or {}
        self.model_init_kwargs: dict = self.model_init_kwargs_orig.copy()
        self.agent_iterable_projector = agent_iterable_projector
        self.on_model_init = on_model_init
        self.on_model_step = on_model_step
        self.on_model_reset = on_model_reset

        self.model: Optional[Any] = None
        self.environment_id: Optional[str] = None
        self._auto_params: List[str] = []
        self._auto_charts: List[str] = []
        self._auto_registered: RegistryChanges = {}

        self.model = self.model_class(*self.model_init_args, **self.model_init_kwargs)
        self.model_reinitializer = BoundModelReinitializer(
            self.model,
            kwarg_bindings,
            init_args=self.model_init_args,
            init_kwargs=self.model_init_kwargs,
        )

    # region Model lifecycle

    def _init_model(self) -> None:
        assert self.model is not None
        cleanup_mesa_model_step(self.model)
        self.model_reinitializer.reinitialize_model()

    def _unregister_auto(self, scenario: "SimulationScenario") -> None:
        scenario.remove_by_dict(self._auto_registered)
        self._auto_registered = {}
        self._auto_params = []
        self._auto_charts = []

    def _register_auto(
        self, scenario: "SimulationScenario", *, dry_run: bool = False
    ) -> RegistryChanges:
        assert self.model is not None
        changes: list[RegistryChanges] = []

        environment_binding = binding_api.environment_binding(self.model)
        layer_bindings = binding_api.layer_bindings(self.model)

        if environment_binding is None and not layer_bindings:
            environment_binding, layer_bindings = build_default_layered_binder(
                self.model, self.agent_iterable_projector
            )
        elif environment_binding is None:
            environment_binding = EnvironmentBinding(
                id=self.model.__class__.__name__,
                type="2d",
            )

        changes.append(
            scenario.add_environment_binding(environment_binding, dry_run=dry_run)
        )
        for layer_binding in layer_bindings:
            changes.append(
                scenario.add_layer_binding(
                    environment_binding.id,
                    layer_binding,
                    self.model,
                    dry_run=dry_run,
                )
            )
        if not dry_run:
            self.environment_id = environment_binding.id
        changes.append(scenario.add_actions({}, dry_run=dry_run))

        param_changes = scenario.add_parameters(self.model, dry_run=dry_run)
        p1 = param_changes.get("parameters", [])
        changes.append(param_changes)
        if not self.on_model_init:
            kwargs_changes = scenario.add_parameters(
                self.model_reinitializer, dry_run=dry_run
            )
            p1.extend(kwargs_changes.get("parameters", []))
            changes.append(kwargs_changes)
        if not dry_run:
            self._auto_params = p1

        chart_changes = scenario.add_charts(self.model, dry_run=dry_run)
        if not dry_run:
            self._auto_charts = chart_changes.get("charts", [])
        changes.append(chart_changes)

        return merge_registry_changes(*changes)

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        await super().on_registered(scenario)
        assert self.model is not None

        self._auto_registered = self._register_auto(scenario)

        def register_model(*, dry_run: bool = False) -> RegistryChanges:
            registered = self._register_auto(scenario, dry_run=dry_run)
            if not dry_run:
                self._auto_registered = registered
            return registered

        self.model_reinitializer.configure_reinit(
            scenario,
            register_model=register_model,
        )

    async def _model_init_impl(self) -> None:
        if self.on_model_init:
            await call_function(self.on_model_init, self.model)
        else:
            await self.model_reinitializer.model_init()

    async def _model_step_impl(self) -> None:
        assert self.model is not None
        if self.on_model_step:
            await call_function(self.on_model_step, self.model)
        else:
            self.model.step()

    async def _model_reset_impl(self) -> None:
        assert self.model is not None
        if self.on_model_reset:
            await call_function(self.on_model_reset, self.model)
            return
        await self._model_init_impl()

    # endregion


# endregion
