"""Simulation handler protocols and default lifecycle handlers."""

from collections.abc import Callable
from typing import Dict, List, Optional, Protocol, TYPE_CHECKING

from .bindings import action as action_decorator
from .helper import broadcast_env_update
from .models import (
    EnvironmentState,
    clone_environment_metadata_state,
    clone_environment_state,
)
from .server import ServerToClientMessageType as MT
from .utils.func import call_function

if TYPE_CHECKING:
    from .scenario import SimulationScenario


class SimulationHandlerProtocol(Protocol):
    """Structural protocol for simulation event handlers."""

    async def on_registered(self, scenario: "SimulationScenario") -> None: ...
    async def on_init(self) -> None: ...
    async def on_start(self, step: int) -> None: ...
    async def on_step(self, step: int) -> bool | None: ...
    async def on_reset(self) -> None: ...


class SimulationHandler:
    """
    Convenience base class; override only the events you need.
    All methods are no-ops by default.
    """

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        pass

    async def on_init(self) -> None:
        pass

    async def on_start(self, step: int) -> None:
        pass

    async def on_step(self, step: int) -> bool | None:
        return None

    async def on_reset(self) -> None:
        pass


def make_default_handlers(scenario: "SimulationScenario") -> List[Callable]:
    """
    Built-in lifecycle actions.

    `start` and `step` both ensure the scenario is initialized at time 0 and
    then advance the model once. The first simulated tick is therefore 1.
    """

    @action_decorator("start", "Start", continuous=True)
    async def start() -> bool:
        return await scenario._advance_step()

    @action_decorator("step", "Step")
    async def step() -> None:
        await scenario._advance_step()

    @action_decorator("reset", "Reset")
    async def reset() -> None:
        await scenario._fire_reset()

    return [start, step, reset]


class DefaultSimulationHandler(SimulationHandler):
    """
    Standard handler: advances the model each tick, then pushes environment
    diffs and chart data to all connected clients.
    """

    def __init__(
        self,
        model_init: Optional[Callable] = None,
        model_step: Optional[Callable] = None,
        model_reset: Optional[Callable] = None,
    ) -> None:
        self.model_init = model_init
        self.model_step = model_step
        self.model_reset = model_reset
        self.scenario: Optional["SimulationScenario"] = None
        self._last_env_states: Dict[str, EnvironmentState] = {}

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        self.scenario = scenario
        self._last_env_states = {}
        for environment in scenario.environments.values():
            for layer in environment.layers.values():
                layer.reset_diff_state()

    async def _prime_env_states(self) -> None:
        s = self.scenario
        if not s:
            self._last_env_states = {}
            return

        next_states: Dict[str, EnvironmentState] = {}
        for env_id, environment in s.environments.items():
            for layer in environment.layers.values():
                layer.reset_diff_state()
            curr = clone_environment_state(environment.build_state())
            environment.seed_item_deltas_from_state(curr)
            next_states[env_id] = clone_environment_metadata_state(curr)
        self._last_env_states = next_states

    async def _push_env_updates(self, replace_all: bool = False) -> None:
        s = self.scenario
        if not s:
            return
        next_states: Dict[str, EnvironmentState] = {}
        for env_id, environment in s.environments.items():
            prev = None if replace_all else self._last_env_states.get(env_id)
            curr = clone_environment_state(
                environment.build_state(include_items=prev is None)
            )
            await broadcast_env_update(s.server, environment, curr, prev)
            next_states[env_id] = clone_environment_metadata_state(curr)
        for removed_id in self._last_env_states.keys() - next_states.keys():
            await s.server.broadcast(MT.ENV_DELETE, {"id": removed_id})
        self._last_env_states = next_states

    async def on_init(self) -> None:
        if self.model_init:
            await call_function(self.model_init)
        await self._prime_env_states()

    async def on_start(self, step: int) -> None:
        await self.on_init()

    async def on_step(self, step: int) -> bool | None:
        s = self.scenario
        if not s:
            return None
        step_result = None
        if self.model_step:
            step_result = await call_function(self.model_step)
        await s.server.broadcast_metadata_update({"time": step})
        await self._push_env_updates()
        await s.broadcast_charts(step)
        return None if step_result is None else bool(step_result)

    async def on_reset(self) -> None:
        if self.model_reset:
            await call_function(self.model_reset)
        elif self.model_init:
            await call_function(self.model_init)
        await self._prime_env_states()
