# tensnap/bindings/mesa/handler.py
"""Mesa-specific SimulationHandler implementation"""

from typing import TYPE_CHECKING, Optional, Callable, Any
from tensnap.scenario import SimulationHandlerProtocol, SimulationScenario
from tensnap.utils.func import call_function

if TYPE_CHECKING:
    from mesa import Model


class MesaSimulationHandler:
    """
    SimulationHandler implementation specifically designed for Mesa models.
    
    This handler automatically integrates Mesa model lifecycle with TenSnap,
    handling model initialization, stepping, and data collection.
    """

    def __init__(
        self,
        model_class: type["Model"],
        model_init_args: Optional[dict] = None,
        model_init_kwargs: Optional[dict] = None,
        on_model_init: Optional[Callable[["Model"], None]] = None,
        on_model_step: Optional[Callable[["Model"], None]] = None,
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
        self.model_class = model_class
        self.model_init_args = model_init_args or {}
        self.model_init_kwargs = model_init_kwargs or {}
        self.on_model_init = on_model_init
        self.on_model_step = on_model_step
        self.model: Optional["Model"] = None
        self.scenario: Optional[SimulationScenario] = None

    async def on_registered(self, scenario: SimulationScenario) -> None:
        """Called when the handler is registered with a scenario"""
        self.scenario = scenario

    async def send_updates(self, replace_agents: bool = False) -> None:
        """Send environment and agent updates to the server"""
        if not self.scenario:
            return
            
        for name, env in self.scenario.env_binders.items():
            model_updates = env.get_model_dict()
            agent_updates = env.get_agent_list(is_update=not replace_agents)
            await self.scenario.server.update_environment(
                name, data=model_updates, agents=agent_updates if replace_agents else None
            )
            if not replace_agents:
                await self.scenario.server.update_agents_batch(name, agent_updates)

    async def on_start(self, step: int) -> None:
        """
        Called when simulation starts.
        Initializes the Mesa model and sends initial state.
        """
        if not self.scenario:
            return

        # Initialize the model
        self.model = self.model_class(**self.model_init_args, **self.model_init_kwargs)
        
        # Call custom initialization callback if provided
        if self.on_model_init:
            await call_function(self.on_model_init, self.model)

        # Send initial state
        await self.scenario.server.start_time_step(step)
        await self.send_updates(replace_agents=True)
        await self.scenario.server.update_charts(step)
        await self.scenario.server.end_time_step(step)

    async def on_step(self, step: int) -> None:
        """
        Called for each simulation step.
        Steps the Mesa model and sends updates.
        """
        if not self.scenario or not self.model:
            return

        await self.scenario.server.start_time_step(step)

        # Step the Mesa model
        self.model.step()
        
        # Call custom step callback if provided
        if self.on_model_step:
            await call_function(self.on_model_step, self.model)

        # Send updates
        await self.send_updates()
        await self.scenario.server.update_charts(step)
        await self.scenario.server.end_time_step(step)

    async def on_reset(self) -> None:
        """
        Called to reset the simulation.
        Reinitializes the Mesa model.
        """
        if not self.scenario:
            return

        await self.scenario.sim_manager.stop()
        self.scenario.sim_manager.time_step = 0
        
        # Reinitialize the model
        self.model = self.model_class(**self.model_init_args, **self.model_init_kwargs)
        
        # Call custom initialization callback if provided
        if self.on_model_init:
            await call_function(self.on_model_init, self.model)
        
        await self.scenario.server.clear_charts()
        await self.on_start(0)
