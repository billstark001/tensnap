from collections.abc import Callable
from types import ModuleType
from typing import Any, Protocol, Set, List, Dict

from tensnap.bindings.basic import (
    BindParametersConfig,
    get_action_metadata_from_namespace,
    get_chart_metadata_from_namespace,
    get_parameter_metadata_from_object,
)
from tensnap.bindings.basic import (
    action as action_decorator,
)
from tensnap.models import EnvironmentBinderProtocol
from tensnap.server import TenSnapServer
from tensnap.sim_loop import SimulationLoop
from tensnap.utils.func import call_function
from tensnap.utils.attr import (
    make_identifier_getter_and_setter,
    make_dict_getter_and_setter,
)


def create_chart_invoke_function(func: Callable, target: Any):
    _func = func
    _target = target

    def invoke():
        ret = _func(_target)
        return ret

    return invoke


class SimulationHandlerProtocol(Protocol):

    async def on_registered(self, scenario: "SimulationScenario") -> None: ...

    async def on_start(self, step: int) -> None: ...

    async def on_step(self, step: int) -> None: ...

    async def on_reset(self) -> None: ...


class DefaultSimulationHandler:

    def __init__(
        self,
        model_init: Callable | None = None,
        model_step: Callable | None = None,
    ):
        self.scenario: "SimulationScenario | None" = None
        self.model_init = model_init
        self.model_step = model_step

        self.last_agent_ids: Set[int | str] | None = None

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        """Called when the handler is registered with a scenario"""
        self.scenario = scenario

    async def send_updates(self, replace_agents: bool = False) -> None:
        """Send environment and agent updates to the server"""
        if not self.scenario:
            return
        for name, env in self.scenario.env_binders.items():
            model_updates = env.get_model_dict()
            agent_updates_raw = env.get_agent_list()
            if replace_agents:
                await self.scenario.server.update_environment(
                    name, data=model_updates, agents=agent_updates_raw
                )
                continue

            await self.scenario.server.update_environment(
                name,
                data=model_updates,
            )

            last_agent_ids = (
                self.last_agent_ids.copy() if self.last_agent_ids is not None else None
            )
            current_agent_ids: Set[str] = set()
            agent_updates: List[Dict[str, Any]] = []
            for agent_update in agent_updates_raw:
                agent_data = agent_update.copy()
                agent_id = agent_data.pop("id")
                agent_payload = {
                    "id": agent_id,
                    "data": agent_data,
                }
                current_agent_ids.add(agent_id)
                if last_agent_ids is None:
                    continue
                if agent_id in last_agent_ids:
                    last_agent_ids.remove(agent_id)
                else:
                    agent_payload["operation"] = "create"

                agent_updates.append(agent_payload)

            for removed_id in last_agent_ids or []:
                agent_updates.append(
                    {
                        "id": removed_id,
                        "operation": "delete",
                    }
                )

            self.last_agent_ids = current_agent_ids
            await self.scenario.server.update_agents_batch(name, agent_updates)

    async def on_start(self, step: int, replace_agents: bool = False) -> None:
        s = self.scenario
        if not s:
            return

        await s.server.start_time_step(step)
        await self.send_updates(replace_agents=replace_agents)
        await s.server.update_charts(step)
        await s.server.end_time_step(step)

    async def on_step(self, step: int) -> None:
        s = self.scenario
        if not s:
            return

        await s.server.start_time_step(step)

        if self.model_step is not None:
            await call_function(self.model_step)

        await self.send_updates()
        await s.server.update_charts(step)
        await s.server.end_time_step(step)

    async def on_reset(self) -> None:
        if not self.scenario:
            return

        await self.scenario.sim_manager.stop()
        self.scenario.sim_manager.time_step = 0
        if self.model_init is not None:
            await call_function(self.model_init)
        await self.scenario.server.clear_charts()
        await self.on_start(0, replace_agents=True)


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

        self.env_binders: dict[str, EnvironmentBinderProtocol] = {}

    def add_environment(self, binder: EnvironmentBinderProtocol):
        self.env_binders[binder.id] = binder
        self.server.add_environment(binder)

    def remove_environment(self, binder_id: str):
        if binder_id in self.env_binders:
            del self.env_binders[binder_id]
            self.server.remove_environment(binder_id)

    def remove_all_environments(self):
        self.env_binders.clear()
        self.server.remove_all_environments()

    def add_charts(self, target: dict[str, Any] | ModuleType | object):
        added_ids: List[str] = []
        target_dict = None
        if isinstance(target, ModuleType) or hasattr(target, "__dict__"):
            target_dict = vars(target)
        if isinstance(target, dict):
            target_dict = target
        if target_dict is not None:
            charts = get_chart_metadata_from_namespace(target_dict)
            for _, func, chart in charts:
                self.server.add_chart(func, chart)
                added_ids.append(chart.id)
        if hasattr(target, "__class__"):
            cls = target.__class__
            charts = get_chart_metadata_from_namespace(vars(cls))  # type: ignore
            for name, func, chart in charts:
                self.server.add_chart(create_chart_invoke_function(func, target), chart)
                added_ids.append(chart.id)
        return added_ids

    def remove_charts(self, chart_ids: List[str]):
        for chart_id in chart_ids:
            self.server.remove_chart(chart_id)

    def remove_all_charts(self):
        self.server.remove_all_charts()

    def add_parameters(
        self,
        target: dict[str, Any] | ModuleType | object,
        cfg_suggest: BindParametersConfig | None = None,
    ):
        added_parameter_ids: List[str] = []
        added_action_ids: List[str] = []
        parameters, actions = get_parameter_metadata_from_object(
            target, cfg_suggest=cfg_suggest
        )
        if isinstance(target, dict):
            for name, param in parameters:
                getter, setter = make_dict_getter_and_setter(name, target)
                self.server.add_parameter(param, getter, setter)
                added_parameter_ids.append(param.id)
            for name, func, action in actions:
                self.server.add_action(
                    action, func or (lambda: target[name]()), add_parameter=True
                )
                added_action_ids.append(action.id)
        else:
            for name, param in parameters:
                getter, setter = make_identifier_getter_and_setter(name, target)
                self.server.add_parameter(param, getter, setter)
                added_parameter_ids.append(param.id)
            for name, func, action in actions:
                self.server.add_action(
                    action,
                    func or (lambda: getattr(target, name)()),
                    add_parameter=True,
                )
                added_action_ids.append(action.id)
        return added_parameter_ids, added_action_ids

    def remove_parameters(self, parameter_ids: List[str]):
        for parameter_id in parameter_ids:
            self.server.remove_parameter(parameter_id)

    def remove_all_parameters(self, include_actions: bool = False):
        self.server.remove_all_parameters(include_actions=include_actions)

    def add_actions(
        self, target: dict[str, Any] | ModuleType | object, register_self: bool = True
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

    def remove_all_actions(self, remove_parameters: bool = True):
        self.server.remove_all_actions(remove_parameters=remove_parameters)

    async def register_handler(self, handler: SimulationHandlerProtocol):
        self.handler = handler
        self.sim_manager.on_start = handler.on_start
        self.sim_manager.on_step = handler.on_step
        self.sim_manager.on_stop = None
        # Call on_registered callback
        await handler.on_registered(self)

    async def register_model_handler(
        self,
        model_init: Callable | None = None,
        model_step: Callable | None = None,
    ):
        handler = DefaultSimulationHandler(
            model_init=model_init,
            model_step=model_step,
        )
        await self.register_handler(handler)

    async def run(self) -> None:
        """Run the simulation scenario server and manager"""
        await self.server.run()
