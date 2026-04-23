# region Imports

from collections.abc import Callable
from types import ModuleType
from typing import Any, Protocol, Dict, List

from tensnap.bindings.basic import (
    BindParametersConfig,
    get_action_metadata_from_namespace,
    get_chart_metadata_from_namespace,
    get_parameter_metadata_from_object,
)
from tensnap.bindings.basic import (
    action as action_decorator,
)
from tensnap.models import EnvironmentBinderProtocol, EnvironmentState
from tensnap.server import TenSnapServer
from tensnap.sim_loop import SimulationLoop
from tensnap.utils.func import call_function
from tensnap.utils.environment_state import (
    clone_environment_state,
)
from tensnap.utils.attr import (
    make_identifier_getter_and_setter,
    make_dict_getter_and_setter,
)

# endregion

# region Helpers


def create_chart_invoke_function(func: Callable, target: Any):
    _func = func
    _target = target

    def invoke():
        ret = _func(_target)
        return ret

    return invoke


# endregion

# region Protocols


class SimulationHandlerProtocol(Protocol):

    async def on_registered(self, scenario: "SimulationScenario") -> None: ...

    async def on_start(self, step: int) -> None: ...

    async def on_step(self, step: int) -> None: ...

    async def on_reset(self) -> None: ...


# endregion

# region Default Handler


class DefaultSimulationHandler:

    def __init__(
        self,
        model_init: Callable | None = None,
        model_step: Callable | None = None,
    ):
        self.scenario: "SimulationScenario | None" = None
        self.model_init = model_init
        self.model_step = model_step

        self.last_agent_ids = None
        self.last_environment_states: Dict[str, EnvironmentState] = {}

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        """Called when the handler is registered with a scenario"""
        self.scenario = scenario
        self.last_environment_states = {}

    async def send_updates(self, replace_agents: bool = False) -> None:
        """Send layer-oriented environment updates to the server."""
        if not self.scenario:
            return
        next_states: Dict[str, EnvironmentState] = {}
        for name, env in self.scenario.env_binders.items():
            current_state = self._get_environment_state(env)
            previous_state = (
                None if replace_agents else self.last_environment_states.get(name)
            )
            await self.scenario.server.update_environment_state(
                current_state,
                previous_state,
            )
            next_states[name] = clone_environment_state(current_state)

        for removed_env_id in self.last_environment_states.keys() - next_states.keys():
            await self.scenario.server.delete_environment_state(removed_env_id)

        self.last_environment_states = next_states

    def _get_environment_state(
        self, env: EnvironmentBinderProtocol
    ) -> EnvironmentState:
        return clone_environment_state(env.get_state())

    async def on_start(self, step: int, replace_agents: bool = False) -> None:
        s = self.scenario
        if not s:
            return

        await s.server.update_metadata({"time": step})
        await self.send_updates(replace_agents=replace_agents)
        await s.server.update_charts(step)

    async def on_step(self, step: int) -> None:
        s = self.scenario
        if not s:
            return

        await s.server.update_metadata({"time": step})

        if self.model_step is not None:
            await call_function(self.model_step)

        await self.send_updates()
        await s.server.update_charts(step)

    async def on_reset(self) -> None:
        if not self.scenario:
            return

        self.scenario.sim_manager.reset_clock()
        if self.model_init is not None:
            await call_function(self.model_init)
        await self.scenario.server.clear_charts()
        await self.on_start(0, replace_agents=True)

    # endregion

    # region Scenario


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
                self.server.add_action(action, func or (lambda: target[name]()))
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

            self.server.add_action(reset._tensnap_action, reset)
        if isinstance(target, dict):
            actions = get_action_metadata_from_namespace(target)
            for name, func, action in actions:
                self.server.add_action(action, func or (lambda: target[name]()))
            return
        if isinstance(target, ModuleType) or (
            hasattr(target, "__dict__") and not hasattr(target, "__class__")
        ):
            actions = get_action_metadata_from_namespace(vars(target))
            for name, func, action in actions:
                self.server.add_action(
                    action,
                    func or (lambda: getattr(target, name)()),
                )
            return
        if hasattr(target, "__class__"):
            cls = target.__class__
            actions = get_action_metadata_from_namespace(vars(cls))  # type: ignore
            for name, _, action in actions:
                self.server.add_action(action, getattr(target, name))

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
