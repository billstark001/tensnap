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
    Dict,
    List,
    Optional,
    Protocol,
    TYPE_CHECKING,
)

import tensnap.bindings as binding_api

from tensnap.bindings import BindParametersConfig
from tensnap.bindings.mesa.helper import (
    build_default_layered_binder,
    mesa_model_reinit,
)
from tensnap.models import EnvironmentBinding, EnvironmentState
from tensnap.scenario import DefaultSimulationHandler
from tensnap.utils.func import call_function

if TYPE_CHECKING:
    from mesa.model import Model
    from websockets.asyncio.server import ServerConnection
    from tensnap.models import EnvironmentLayerState
    from tensnap.scenario import SimulationScenario

logger = logging.getLogger(__name__)


# region MesaSimulationHandler


class MesaSimulationHandler(DefaultSimulationHandler):
    """
    Handler for Mesa models.

    Wraps Mesa model lifecycle (init, step) and auto-binds parameters,
    charts, and environment from the model class.
    """

    def __init__(
        self,
        model_class: "type[Model]",
        model_init_args: Optional[list] = None,
        model_init_kwargs: Optional[dict] = None,
        agent_iterable_projector: "str | Callable" = "agents",
        on_model_init: Optional[Callable] = None,
        on_model_step: Optional[Callable] = None,
        on_model_reset: Optional[Callable] = None,
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

        self.model: Optional["Model"] = None
        self.environment_id: Optional[str] = None
        self._auto_params: List[str] = []
        self._auto_charts: List[str] = []

        self._init_model()

    # region Model lifecycle

    def _init_model(self) -> None:
        if self.model is not None:
            if "step" in vars(self.model):
                del self.model.step
            self.model.__init__(*self.model_init_args, **self.model_init_kwargs)
            return
        self.model = self.model_class(*self.model_init_args, **self.model_init_kwargs)
        if hasattr(self.model.__class__, "_tensnap_bind_datacollector_config"):
            cfg = getattr(self.model.__class__, "_tensnap_bind_datacollector_config")
            cfg.inject_func(self.model)

    def _unregister_auto(self, scenario: "SimulationScenario") -> None:
        scenario.remove_parameters(self._auto_params)
        scenario.remove_charts(self._auto_charts)
        self._auto_params = []
        self._auto_charts = []

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        first_register = scenario is not self.scenario
        await super().on_registered(scenario)
        assert self.model is not None

        if first_register:
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

            scenario.add_environment_binding(environment_binding)
            for layer_binding in layer_bindings:
                scenario.add_layer_binding(
                    environment_binding.id, layer_binding, self.model
                )
            self.environment_id = environment_binding.id
            scenario.add_actions({})

        p1 = scenario.add_parameters(
            self.model,
            cfg_suggest=BindParametersConfig(
                exclude=["running", "steps", "time"], include_private=False
            ),
        )
        if not self.on_model_init:
            p2 = scenario.add_parameters(self.model_init_kwargs)
            p1.extend(p2)
        self._auto_params = p1
        self._auto_charts = scenario.add_charts(self.model)

    async def _model_init_impl(self) -> None:
        if self.on_model_init:
            await call_function(self.on_model_init, self.model)
        else:
            await mesa_model_reinit(self)

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
