# tensnap/bindings/mesa/handler.py
"""Mesa-specific SimulationHandler implementation"""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, List

from tensnap.utils.func import call_function
from tensnap.scenario import DefaultSimulationHandler, call_function

from tensnap.models import (
    GridEnvironmentBinder,
    make_grid_agent_accessor,
    make_grid_environment_accessor,
)

from tensnap.bindings.basic import BindParametersConfig

if TYPE_CHECKING:
    from tensnap.scenario import SimulationScenario
    from mesa.model import Model


class MesaGridEnvironmentBinder(GridEnvironmentBinder):

    def __init__(self, id: str, environment: Any, agent_iterable_accessor="agents"):
        super().__init__(
            id, environment, agent_iterable_accessor=agent_iterable_accessor
        )

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
        model_init_args: list | None = None,
        model_init_kwargs: dict | None = None,
        agent_iterable_accessor="agents",
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
        self.model_init_args = model_init_args or []
        self.model_init_kwargs_orig = model_init_kwargs or {}
        self.model_init_kwargs = self.model_init_kwargs_orig.copy()
        self.agent_iterable_accessor = agent_iterable_accessor
        self.on_model_init = on_model_init
        self.on_model_step = on_model_step

        self.model: "Model | None" = None
        self.env_binder: "MesaGridEnvironmentBinder | None" = None

        self.auto_added_parameters: List[str] = []
        self.auto_added_charts: List[str] = []

        self.init_model()

    def init_model(self):

        if self.model is not None:
            del self.model.step
            self.model.__init__(*self.model_init_args, **self.model_init_kwargs)
            return

        self.model = self.model_class(*self.model_init_args, **self.model_init_kwargs)

        if hasattr(self.model.__class__, "_tensnap_bind_datacollector_config"):
            cfg = getattr(self.model.__class__, "_tensnap_bind_datacollector_config")
            cfg.inject_func(self.model)

    async def model_init_impl(self) -> None:
        assert self.scenario is not None, "Scenario must be initialized before init"

        if self.on_model_init:
            await call_function(self.on_model_init, self.model)
        else:
            dumped = self.scenario.server.dump_parameters()
            self._unregister_everything()
            # modify model_init_kwargs based on dumped parameters
            for key, value in list(dumped.items()):
                if key in self.model_init_kwargs_orig:
                    self.model_init_kwargs[key] = value
                del dumped[key]
            # re-initialize model
            self.init_model()
            # re-register everything
            for key, value in dumped.items():
                self.scenario.server.set_parameter(key, value)
            await self.on_registered(self.scenario)

        pass

    async def model_step_impl(self) -> None:
        assert self.model is not None, "Model must be initialized before stepping"
        if self.on_model_step:
            await call_function(self.on_model_step, self.model)
        else:
            self.model.step()
        pass

    def _unregister_everything(self):
        s = self.scenario
        assert s is not None
        s.remove_parameters(self.auto_added_parameters)
        s.remove_charts(self.auto_added_charts)
        self.auto_added_parameters = []
        self.auto_added_charts = []

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        """Called when the handler is registered with a scenario"""
        first_register = scenario is not self.scenario
        self.scenario = scenario

        assert self.model is not None, "Model must be initialized before registration"

        if first_register:
            env_binder = MesaGridEnvironmentBinder(
                self.model.__class__.__name__,
                self.model,
                agent_iterable_accessor=self.agent_iterable_accessor,
            )
            self.env_binder = env_binder
            self.scenario.add_environment(env_binder)
            self.scenario.add_actions({})

        p1, _ = self.scenario.add_parameters(
            self.model,
            cfg_suggest=BindParametersConfig(
                exclude=["running", "steps"],
                include_private=False,
            ),
        )
        if not self.on_model_init:
            p2, _ = self.scenario.add_parameters(self.model_init_kwargs)
            p1.extend(p2)
        self.auto_added_parameters = p1

        self.auto_added_charts = self.scenario.add_charts(self.model)
