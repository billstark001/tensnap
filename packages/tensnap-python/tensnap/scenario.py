from typing import Dict, List, Any, Protocol, Callable

from types import ModuleType

from tensnap.server import TenSnapServer
from tensnap.sim_loop import SimulationLoop
from tensnap.models import EnvironmentModel, UniformEnvironmentBinder

from tensnap.utils.func import call_function

from tensnap.bindings.basic import (
    action as action_decorator,
    get_chart_metadata_from_namespace,
    get_action_metadata_from_namespace,
    get_parameter_metadata_from_object,
    BindParametersConfig,
)


class SimulationHandlerProtocol(Protocol):

    async def on_start(self, step: int) -> None: ...

    async def on_step(self, step: int) -> None: ...

    async def on_reset(self) -> None: ...


class DefaultSimulationHandler:

    def __init__(
        self,
        scenario: "SimulationScenario",
        model_init: Callable | None = None,
        model_step: Callable | None = None,
    ):
        self.scenario = scenario
        self.model_init = model_init
        self.model_step = model_step

    async def send_updates(self) -> None:
        """Send environment and agent updates to the server"""
        for name, env in self.scenario.env_binders.items():
            model_updates = env.get_model_dict()
            agent_updates = env.get_agent_list()
            await self.scenario.server.update_environment(name, model_updates)
            await self.scenario.server.update_agents_batch(name, agent_updates)

    async def on_start(self, step: int) -> None:
        s = self.scenario

        await s.server.start_time_step(step)
        await self.send_updates()
        await s.server.update_charts(step)
        await s.server.end_time_step(step)

    async def on_step(self, step: int) -> None:
        s = self.scenario

        await s.server.start_time_step(step)

        if self.model_step is not None:
            await call_function(self.model_step)

        await self.send_updates()
        await s.server.update_charts(step)
        await s.server.end_time_step(step)

    async def on_reset(self) -> None:
        await self.scenario.sim_manager.stop()
        self.scenario.sim_manager.time_step = 0
        if self.model_init is not None:
            await call_function(self.model_init)
        await self.scenario.server.clear_charts()
        await self.on_start(0)


class SimulationScenario:

    def __init__(
        self,
        host: str = "localhost",
        port: int = 8765,
        use_msgpack: bool = False,
        step_interval: float = 0.05,
    ):
        self.host = host
        self.port = port
        self.use_msgpack = use_msgpack
        self.step_interval = step_interval
        self.handler: SimulationHandlerProtocol | None = None

        self.server = TenSnapServer(
            host=self.host,
            port=self.port,
            use_msgpack=self.use_msgpack,
        )
        self.sim_manager = SimulationLoop(step_interval=self.step_interval)

        self.env_binders: Dict[str, EnvironmentModel] = {}

    def add_environment(self, binder: EnvironmentModel):
        self.env_binders[binder.id] = binder
        self.server.add_environment(binder)

    def add_charts(self, target: Dict[str, Any] | ModuleType | object):
        if isinstance(target, ModuleType) or hasattr(target, "__dict__"):
            target = vars(target)
        if isinstance(target, dict):
            charts = get_chart_metadata_from_namespace(target)
            for _, func, chart in charts:
                self.server.add_chart(func, chart)
            return
        if hasattr(target, "__class__"):
            cls = target.__class__
            charts = get_chart_metadata_from_namespace(vars(cls))  # type: ignore
            for name, _, chart in charts:
                self.server.add_chart(getattr(target, name), chart)

    def add_parameters(
        self,
        target: Dict[str, Any] | ModuleType | object,
        cfg_suggest: BindParametersConfig | None = None,
    ):
        parameters, actions = get_parameter_metadata_from_object(
            target, cfg_suggest=cfg_suggest
        )
        if isinstance(target, dict):
            for name, param in parameters:
                self.server.add_parameter(
                    param, lambda: target[name], lambda v: target.__setitem__(name, v)
                )
            for name, func, action in actions:
                self.server.add_action(
                    action, func or (lambda: target[name]()), add_parameter=True
                )
            return
        else:
            for name, param in parameters:
                self.server.add_parameter(
                    param,
                    lambda: getattr(target, name),
                    lambda v: setattr(target, name, v),
                )
            for name, func, action in actions:
                self.server.add_action(
                    action,
                    func or (lambda: getattr(target, name)()),
                    add_parameter=True,
                )

    def add_actions(
        self, target: Dict[str, Any] | ModuleType | object, register_self: bool = True
    ):
        if register_self:
            self.sim_manager.register_to(self.server)

            @action_decorator("reset", "Reset")
            async def reset() -> None:
                if self.handler:
                    await self.handler.on_reset()

            self.server.add_action(reset._tensnap_action, reset, add_parameter=True)
        if isinstance(target, dict):
            actions = get_action_metadata_from_namespace(target)
            for name, func, action in actions:
                self.server.add_action(
                    action, func or (lambda: target[name]()), add_parameter=True
                )
            return
        if isinstance(target, ModuleType) or (
            hasattr(target, "__dict__") and not hasattr(target, "__class__")
        ):
            actions = get_action_metadata_from_namespace(vars(target))
            for name, func, action in actions:
                self.server.add_action(
                    action,
                    func or (lambda: getattr(target, name)()),
                    add_parameter=True,
                )
            return
        if hasattr(target, "__class__"):
            cls = target.__class__
            actions = get_action_metadata_from_namespace(vars(cls))  # type: ignore
            for name, _, action in actions:
                self.server.add_action(
                    action, getattr(target, name), add_parameter=True
                )

    def register_handler(self, handler: SimulationHandlerProtocol):
        self.handler = handler
        self.sim_manager.on_start = handler.on_start
        self.sim_manager.on_step = handler.on_step
        self.sim_manager.on_stop = None

    def register_model_handler(
        self,
        model_init: Callable | None = None,
        model_step: Callable | None = None,
    ):
        handler = DefaultSimulationHandler(
            scenario=self,
            model_init=model_init,
            model_step=model_step,
        )
        self.register_handler(handler)

    async def run(self) -> None:
        """Run the simulation scenario server and manager"""
        await self.server.run()
