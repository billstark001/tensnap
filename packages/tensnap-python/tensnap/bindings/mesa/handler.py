# tensnap/bindings/mesa/handler.py
"""Mesa-specific SimulationHandler implementation"""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from tensnap.utils.func import call_function
from tensnap.scenario import DefaultSimulationHandler, call_function

from tensnap.models import (
    EnvironmentBinderProtocol,
    GridEnvironmentBinder,
    make_grid_agent_accessor,
    make_grid_environment_accessor,
)

if TYPE_CHECKING:
    from tensnap.scenario import SimulationScenario
    from mesa.model import Model
    from mesa.space import (
        SingleGrid,
        MultiGrid,
        ContinuousSpace,
        NetworkGrid,
    )


class MesaGridEnvironmentBinder(GridEnvironmentBinder):

    def __init__(self, id: str, environment: Any):
        super().__init__(id, environment)

    def _get_default_agent_accessor(self):
        return make_grid_agent_accessor(id="unique_id", x="pos[0]", y="pos[1]")

    def _get_default_environment_accessor(self):
        return make_grid_environment_accessor(
            id=self.id, width="grid.width", height="grid.height"
        )


class MesaSimulationHandler(DefaultSimulationHandler):
    """
    SimulationHandler implementation specifically designed for Mesa models.

    This handler automatically integrates Mesa model lifecycle with TenSnap,
    handling model initialization, stepping, and data collection.
    """

    def __init__(
        self,
        model_class: type["Model"],
        model_init_args: dict | None = None,
        model_init_kwargs: dict | None = None,
        on_model_init: Callable | None = None,
        on_model_step: Callable | None = None,
    ):
        """
        Initialize Mesa simulation handler.

        Args:
            model_class: Mesa Model class to instantiate
            model_init_args: Positional arguments for model initialization
            model_init_kwargs: Keyword arguments for model initialization
            on_model_init: Optional callback after model initialization
            on_model_step: Optional callback after each model step
        """
        super().__init__(self.model_init_impl, self.model_step_impl)
        self.model_class = model_class
        self.model_init_args = model_init_args or {}
        self.model_init_kwargs = model_init_kwargs or {}
        self.on_model_init = on_model_init
        self.on_model_step = on_model_step

        self.model: "Model | None" = None
        self.env_binder: "MesaGridEnvironmentBinder | None" = None

        self.init_model()

    def init_model(self):

        self.model = self.model_class(**self.model_init_args, **self.model_init_kwargs)
        
        if hasattr(self.model.__class__, '_tensnap_bind_datacollector_config'):
            cfg = getattr(self.model.__class__, '_tensnap_bind_datacollector_config')
            cfg.inject_func(self.model)

    async def model_init_impl(self) -> None:
        assert self.model is not None, "Model must be initialized before init"
        assert self.env_binder is not None, "Environment binder must be set before init"

        if self.on_model_init:
            await call_function(self.on_model_init)

        self.env_binder.agents.clear()
        for agent in self.model.agents:
            self.env_binder.add_agent(agent)

        pass

    async def model_step_impl(self) -> None:
        assert self.model is not None, "Model must be initialized before stepping"
        self.model.step()
        if self.on_model_step:
            await call_function(self.on_model_step)
        pass

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        """Called when the handler is registered with a scenario"""
        self.scenario = scenario

        assert self.model is not None, "Model must be initialized before registration"

        env_binder = MesaGridEnvironmentBinder(
            self.model.__class__.__name__, self.model
        )
        self.env_binder = env_binder
        self.env_binder.agents.clear()
        for agent in self.model.agents:
            self.env_binder.add_agent(agent)

        self.scenario.add_environment(env_binder)
        # TODO implement parameter handler
        self.scenario.add_charts(self.model)
        self.scenario.add_actions({})
