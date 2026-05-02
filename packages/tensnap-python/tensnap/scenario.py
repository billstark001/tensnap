"""
TenSnap simulation scenario — orchestration layer.

Owns all simulation state (parameters, environments, charts, actions) and wires
server I/O events to a list of SimulationHandler callbacks.

SimulationLoop has been merged directly into SimulationScenario; the step /
start / reset coroutines are registered as actions during __init__.
"""

import asyncio
import inspect
import logging
import time
from collections.abc import Callable
from types import ModuleType
from typing import (
    Any,
    Dict,
    List,
    Optional,
    Protocol,
    Tuple,
    TYPE_CHECKING,
    Union,
)

from .bindings.basic import (
    ActionMetadata,
    BindParametersConfig,
    ChartGroupMetadata,
    Parameter,
    get_action_metadata_from_namespace,
    get_chart_metadata_from_namespace,
    get_parameter_metadata_from_object,
    action as action_decorator,
)
from .models import (
    EnvironmentBinderProtocol,
    EnvironmentState,
    LayeredEnvironmentBinder,
)
from .protocol import (
    ActionDeltas,
    ChartDeltas,
    EnvironmentDeltas,
    LayerItemOps,
    ParameterDeltas,
    compute_action_deltas,
    compute_chart_deltas,
    compute_environment_deltas,
    compute_parameter_deltas,
    diff_layer_items,
    format_chart_update,
    layer_create_payload,
)
from .server import ServerToClientMessageType as MT, TenSnapServer
from .utils.attr import make_dict_getter_and_setter, make_attr_getter_and_setter
from .utils.environment_state import (
    clone_environment_state,
    copied_layer_items,
    layer_dependency_layer_ids,
    layer_metadata,
)
from .utils.func import call_function

if TYPE_CHECKING:
    from mesa.model import Model
    from websockets.asyncio.server import ServerConnection
    from .models import EnvironmentLayerState

logger = logging.getLogger(__name__)


# region Handler protocol & base class


class SimulationHandlerProtocol(Protocol):
    """Structural protocol for simulation event handlers."""

    async def on_registered(self, scenario: "SimulationScenario") -> None: ...
    async def on_start(self, step: int) -> None: ...
    async def on_step(self, step: int) -> None: ...
    async def on_reset(self) -> None: ...


class SimulationHandler:
    """
    Convenience base class; override only the events you need.
    All methods are no-ops by default.
    """

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        pass

    async def on_start(self, step: int) -> None:
        pass

    async def on_step(self, step: int) -> None:
        pass

    async def on_reset(self) -> None:
        pass


# endregion


# region Helpers


def make_default_handlers(scenario: "SimulationScenario") -> List[Callable]:
    """
    Continuous 'start' action.

    First call fires on_start (initialization); subsequent calls fire on_step.
    Always returns True so the renderer keeps dispatching ticks.
    """

    @action_decorator("start", "Start", continuous=True)
    async def start() -> bool:
        if not scenario._initialized:
            await scenario._fire_start(scenario._time_step)
            scenario._initialized = True
        else:
            await scenario._fire_step(scenario._time_step)
            scenario._time_step += 1
        return True

    @action_decorator("step", "Step")
    async def step() -> None:
        if not scenario._initialized:
            scenario._initialized = True
        await scenario._fire_step(scenario._time_step)
        scenario._time_step += 1

    @action_decorator("reset", "Reset")
    async def reset() -> None:
        await scenario._fire_reset()

    return [start, step, reset]


# endregion

# region DefaultSimulationHandler


class DefaultSimulationHandler(SimulationHandler):
    """
    Standard handler: advances the model each tick, then pushes environment
    diffs and chart data to all connected clients.
    """

    def __init__(
        self,
        model_init: Optional[Callable] = None,
        model_step: Optional[Callable] = None,
    ) -> None:
        self.model_init = model_init
        self.model_step = model_step
        self.scenario: Optional["SimulationScenario"] = None
        self._last_env_states: Dict[str, EnvironmentState] = {}

    async def on_registered(self, scenario: "SimulationScenario") -> None:
        self.scenario = scenario
        self._last_env_states = {}

    async def _push_env_updates(self, replace_all: bool = False) -> None:
        s = self.scenario
        if not s:
            return
        next_states: Dict[str, EnvironmentState] = {}
        for name, env in s.env_binders.items():
            curr = clone_environment_state(env.get_state())
            prev = None if replace_all else self._last_env_states.get(name)
            await _broadcast_env_update(s.server, curr, prev)
            next_states[name] = curr
        for removed_id in self._last_env_states.keys() - next_states.keys():
            await s.server.broadcast(MT.ENV_DELETE, {"id": removed_id})
        self._last_env_states = next_states

    async def on_start(self, step: int) -> None:
        s = self.scenario
        if not s:
            return
        await s.server.broadcast_metadata_update({"time": step})
        await self._push_env_updates(replace_all=True)
        await s.broadcast_charts(step)

    async def on_step(self, step: int) -> None:
        s = self.scenario
        if not s:
            return
        await s.server.broadcast_metadata_update({"time": step})
        if self.model_step:
            await call_function(self.model_step)
        await self._push_env_updates()
        await s.broadcast_charts(step)

    async def on_reset(self) -> None:
        if not self.scenario:
            return
        if self.model_init:
            await call_function(self.model_init)
        await self.scenario.clear_charts()
        await self.on_start(0)


# endregion


# region Environment broadcast helpers (module-level private)


async def _send_layer_full(
    target: Any,  # ServerConnection for send, None for broadcast
    server: TenSnapServer,
    env_id: str,
    layer: "EnvironmentLayerState",
) -> None:
    """Send a full layer create + all items to ``target`` (or broadcast if None)."""
    payload = layer_create_payload(env_id, layer)
    lid = layer["layer_id"]
    if target is None:
        await server.broadcast(MT.ENV_LAYER_CREATE, payload)
        items = copied_layer_items(layer)
        if items:
            await server.broadcast(
                MT.ITEM_CREATE, {"env_id": env_id, "layer_id": lid, "items": items}
            )
    else:
        await server.send(target, MT.ENV_LAYER_CREATE, payload)
        items = copied_layer_items(layer)
        if items:
            await server.send(
                target,
                MT.ITEM_CREATE,
                {"env_id": env_id, "layer_id": lid, "items": items},
            )


async def _broadcast_env_update(
    server: TenSnapServer,
    env_state: EnvironmentState,
    previous_state: Optional[EnvironmentState] = None,
) -> None:
    """Diff previous vs. current environment state and broadcast changes."""
    env_id: str = env_state["id"]

    if previous_state is None:
        await server.broadcast(MT.ENV_CREATE, {"id": env_id, "type": env_state["type"]})
        for layer in env_state["layers"]:
            await _send_layer_full(None, server, env_id, layer)
        return

    if previous_state["type"] != env_state["type"]:
        await server.broadcast(MT.ENV_DELETE, {"id": env_id})
        await _broadcast_env_update(server, env_state, None)
        return

    prev_layers = {l["layer_id"]: l for l in previous_state["layers"]}
    curr_layer_ids = {l["layer_id"] for l in env_state["layers"]}

    for removed_lid in prev_layers.keys() - curr_layer_ids:
        await server.broadcast(
            MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": removed_lid}
        )

    for layer in env_state["layers"]:
        lid = layer["layer_id"]
        prev_layer = prev_layers.get(lid)

        if prev_layer is None or prev_layer["layer_type"] != layer["layer_type"]:
            if prev_layer is not None:
                await server.broadcast(
                    MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": lid}
                )
            await _send_layer_full(None, server, env_id, layer)
            continue

        if layer_dependency_layer_ids(layer) != layer_dependency_layer_ids(prev_layer):
            await server.broadcast(
                MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": lid}
            )
            await _send_layer_full(None, server, env_id, layer)
            continue

        meta = layer_metadata(layer)
        if meta != layer_metadata(prev_layer):
            await server.broadcast(
                MT.ENV_LAYER_UPDATE,
                {"env_id": env_id, "layer_id": lid, "data": meta},
            )

        ops: LayerItemOps = diff_layer_items(layer, prev_layer)
        if ops["creates"]:
            await server.broadcast(
                MT.ITEM_CREATE,
                {"env_id": env_id, "layer_id": lid, "items": ops["creates"]},
            )
        if ops["updates"]:
            await server.broadcast(
                MT.ITEM_UPDATE,
                {"env_id": env_id, "layer_id": lid, "items": ops["updates"]},
            )
        if ops["deletes"]:
            await server.broadcast(
                MT.ITEM_DELETE,
                {"env_id": env_id, "layer_id": lid, "items": ops["deletes"]},
            )


async def _send_env_snapshot(
    ws: "ServerConnection",
    server: TenSnapServer,
    env_state: EnvironmentState,
    client_env: Optional[Dict[str, Any]] = None,
) -> None:
    """Send a full environment snapshot to a single client (used in state-sync)."""
    env_id = env_state["id"]
    recreate = client_env is None or client_env.get("type") != env_state["type"]

    if recreate and client_env is not None:
        await server.send(ws, MT.ENV_DELETE, {"id": env_id})
    if recreate:
        await server.send(ws, MT.ENV_CREATE, {"id": env_id, "type": env_state["type"]})

    client_layer_ids = (
        {l["layer_id"] for l in client_env.get("layers", [])} if client_env else set()
    )
    for removed_lid in client_layer_ids - {l["layer_id"] for l in env_state["layers"]}:
        await server.send(
            ws, MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": removed_lid}
        )

    for layer in env_state["layers"]:
        lid = layer["layer_id"]
        if lid in client_layer_ids:
            # Destroy the stale layer before recreating
            await server.send(
                ws, MT.ENV_LAYER_DELETE, {"env_id": env_id, "layer_id": lid}
            )
        await _send_layer_full(ws, server, env_id, layer)


# endregion

# region CUD dispatch helper  (actions / params / charts share the same pattern)


async def _dispatch_cud(
    send_fn: Callable,
    deltas: Dict[str, Any],
    create_type: MT,
    delete_type: MT,
    update_type: MT,
) -> None:
    """
    Dispatch create / delete / update messages for a generic delta result.

    Args:
        send_fn: ``async (msg_type, payload) -> None``
        deltas:  Dict with keys ``added``, ``removed``, ``updated``.
    """
    for item in deltas["added"]:
        await send_fn(create_type, item)
    for item_id in deltas["removed"]:
        await send_fn(delete_type, {"id": item_id})
    for item in deltas["updated"]:
        await send_fn(update_type, item)


# endregion

# region SimulationScenario


class SimulationScenario:
    """
    Main orchestration class.

    Owns all simulation state and wires TenSnapServer I/O events to a list
    of registered SimulationHandlers.  The built-in start / step / reset
    actions are registered automatically at construction time.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 8765,
        use_msgpack: bool = False,
        step_interval: float = 0.05,  # not used in renderer-driven mode; kept for API compat
    ) -> None:
        self.server = TenSnapServer(host=host, port=port, use_msgpack=use_msgpack)
        self.step_interval = step_interval

        # Simulation state stores
        self.env_binders: Dict[str, EnvironmentBinderProtocol] = {}
        self.parameters: Dict[str, Parameter] = {}
        self.actions: Dict[str, ActionMetadata] = {}
        self.charts: Dict[str, Tuple[ChartGroupMetadata, Callable]] = {}
        self._action_handlers: Dict[str, Callable] = {}

        # Step state
        self._time_step: int = 0
        self._initialized: bool = False

        # Handler list — called in registration order for each event
        self._handlers: List[SimulationHandlerProtocol] = []

        # Wire server incoming-message events
        self.server.on_state_sync = self._on_state_sync
        self.server.on_param_change = self._on_param_change
        self.server.on_action_start = self._on_action_start

        # Register built-in start / step / reset actions
        for fn in make_default_handlers(self):
            meta = fn._tensnap_action  # type: ignore[attr-defined]
            self.actions[meta.id] = meta
            self._action_handlers[meta.id] = fn

    # endregion

    # region Handler registration

    async def register_handler(self, handler: SimulationHandlerProtocol) -> None:
        """Register a handler and invoke its on_registered hook."""
        self._handlers.append(handler)
        await handler.on_registered(self)

    async def register_model_handler(
        self,
        model_init: Optional[Callable] = None,
        model_step: Optional[Callable] = None,
    ) -> None:
        """Convenience: create and register a DefaultSimulationHandler."""
        await self.register_handler(DefaultSimulationHandler(model_init, model_step))

    # endregion

    # region Event dispatch

    async def _fire_start(self, step: int) -> None:
        for h in self._handlers:
            await h.on_start(step)

    async def _fire_step(self, step: int) -> None:
        for h in self._handlers:
            await h.on_step(step)

    async def _fire_reset(self) -> None:
        self._time_step = 0
        self._initialized = False
        for h in self._handlers:
            await h.on_reset()

    # endregion

    # region Parameter value helpers

    def _get_param_value(self, param: Parameter) -> Any:
        if param.getter:
            try:
                return param.getter()
            except Exception as e:
                logger.error(f"Error reading param '{param.id}': {e}")
        return param.value

    def _set_param_value(self, param: Parameter, value: Any) -> None:
        if param.setter:
            try:
                param.setter(value)
                param.value = value
            except Exception as e:
                logger.exception(f"Error setting param '{param.id}': {e}")

    def get_parameter(self, param_id: str) -> Any:
        param = self.parameters.get(param_id)
        return self._get_param_value(param) if param else None

    def set_parameter(self, param_id: str, value: Any) -> None:
        param = self.parameters.get(param_id)
        if param:
            self._set_param_value(param, value)

    def dump_parameters(self) -> Dict[str, Any]:
        return {pid: self._get_param_value(p) for pid, p in self.parameters.items()}

    # endregion

    # region Server event handlers

    async def _on_state_sync(self, ws: Any, req: Any) -> None:
        request_id = req.get("request_id")
        boundary: Dict[str, Any] = (
            {"request_id": request_id} if request_id is not None else {}
        )
        await self.server.send(ws, MT.STATE_SYNC_BEGIN, boundary)

        # All delta computations are pure (non-blocking) — no need for gather
        action_d = compute_action_deltas(self.actions, req.get("actions", []))
        param_d, value_updates = compute_parameter_deltas(
            self.parameters, req.get("parameters", []), self._get_param_value
        )
        env_d = compute_environment_deltas(self.env_binders, req.get("envs", []))
        chart_d = compute_chart_deltas(self.charts, req.get("charts", []))

        # Apply client-sent values before responding (client wins on sync)
        for pid, val in value_updates:
            self._set_param_value(self.parameters[pid], val)

        client_env_map = {e["id"]: e for e in req.get("envs", [])}
        _send = lambda mt, p: self.server.send(ws, mt, p)

        try:
            # Actions
            await _dispatch_cud(
                _send, action_d, MT.ACTION_CREATE, MT.ACTION_DELETE, MT.ACTION_UPDATE  # type: ignore
            )
            # Parameters
            await _dispatch_cud(
                _send, param_d, MT.PARAM_CREATE, MT.PARAM_DELETE, MT.PARAM_UPDATE  # type: ignore
            )
            # Environments
            for env_state in env_d["added"]:
                await _send_env_snapshot(ws, self.server, env_state)
            for env_id in env_d["removed"]:
                await self.server.send(ws, MT.ENV_DELETE, {"id": env_id})
            for env_state in env_d["updated"]:
                await _send_env_snapshot(
                    ws, self.server, env_state, client_env_map.get(env_state["id"])
                )
            # Charts (updates are re-sent as creates per protocol)
            for item in chart_d["added"]:
                await self.server.send(ws, MT.CHART_CREATE, item)
            for cid in chart_d["removed"]:
                await self.server.send(ws, MT.CHART_DELETE, {"id": cid})
            for item in chart_d["updated"]:
                await self.server.send(ws, MT.CHART_CREATE, item)
        finally:
            await self.server.send(ws, MT.STATE_SYNC_END, boundary)

    async def _on_param_change(self, ws: Any, payload: Dict[str, Any]) -> None:
        pid = payload.get("id")
        value = payload.get("value")
        if value is None or pid not in self.parameters:
            return
        param = self.parameters[pid]
        if param.setter:
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, param.setter, value
                )
                param.value = value
            except Exception as e:
                logger.exception(f"Error setting param '{pid}': {e}")
                await self.server.send_error(ws, f"Error setting param '{pid}': {e}")

    async def _on_action_start(self, ws: Any, payload: Dict[str, Any]) -> None:
        action_id = payload.get("id")
        tick_id = payload.get("tick_id")
        handler = (
            self._action_handlers.get(action_id) if isinstance(action_id, str) else None
        )
        if handler is None:
            logger.warning(f"No handler for action: {action_id}")
            return
        started_at = time.perf_counter()
        try:
            if inspect.iscoroutinefunction(handler):
                result = await handler()
            else:
                result = await asyncio.get_event_loop().run_in_executor(None, handler)
            continue_flag = None if result is None else bool(result)
            await self.server.send_action_end(
                ws,
                action_id,  # type: ignore
                tick_id=tick_id,
                continue_=continue_flag,
                simulate_ms=(time.perf_counter() - started_at) * 1000.0,
            )
        except Exception as e:
            logger.exception(f"Action handler error ({action_id}): {e}")
            await self.server.send_error(ws, f"Error in action '{action_id}': {e}")

    # endregion

    # region Chart broadcasting

    async def broadcast_charts(self, step: Optional[int] = None) -> None:
        if not self.charts:
            return
        updates: List[Dict[str, Any]] = []
        for chart, getter in self.charts.values():
            try:
                value = await asyncio.get_event_loop().run_in_executor(None, getter)
                updates.extend(format_chart_update(chart, value))
            except Exception as e:
                logger.exception(f"Chart getter error for '{chart.id}': {e}")
        if updates:
            await self.server.broadcast(MT.CHART_UPDATE, {"updates": updates})

    async def clear_charts(self, chart_ids: Optional[List[str]] = None) -> None:
        if not self.charts:
            return
        ids = chart_ids or list(self.charts.keys())
        ops = [{"id": cid, "operation": "clear"} for cid in ids if cid in self.charts]
        if ops:
            await self.server.broadcast(MT.CHART_UPDATE, {"operations": ops})

    # endregion

    # region State management — environments

    def add_environment(self, binder: EnvironmentBinderProtocol) -> None:
        self.env_binders[binder.id] = binder

    def remove_environment(self, binder_id: str) -> None:
        self.env_binders.pop(binder_id, None)

    def remove_all_environments(self) -> None:
        self.env_binders.clear()

    # endregion

    # region State management — parameters

    def add_parameters(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        cfg_suggest: Optional[BindParametersConfig] = None,
    ) -> Tuple[List[str], List[str]]:
        """
        Inspect ``target`` and register any annotated parameters/actions.

        Returns:
            (added_parameter_ids, added_action_ids)
        """
        added_params: List[str] = []
        added_actions: List[str] = []
        parameters, actions = get_parameter_metadata_from_object(
            target, cfg_suggest=cfg_suggest
        )
        if isinstance(target, dict):
            for name, param in parameters:
                getter, setter = make_dict_getter_and_setter(name, target)
                self._register_parameter(param, getter, setter)
                added_params.append(param.id)
            for name, func, action_meta in actions:
                self._register_action(action_meta, func or (lambda: target[name]()))
                added_actions.append(action_meta.id)
        else:
            for name, param in parameters:
                getter, setter = make_attr_getter_and_setter(name, target)
                self._register_parameter(param, getter, setter)
                added_params.append(param.id)
            for name, func, action_meta in actions:
                self._register_action(
                    action_meta, func or (lambda: getattr(target, name)())
                )
                added_actions.append(action_meta.id)
        return added_params, added_actions

    def _register_parameter(
        self,
        param: Parameter,
        getter: Optional[Callable] = None,
        setter: Optional[Callable] = None,
    ) -> None:
        self.parameters[param.id] = param.instantiate(getter=getter, setter=setter)

    def remove_parameters(self, param_ids: List[str]) -> None:
        for pid in param_ids:
            self.parameters.pop(pid, None)

    def remove_all_parameters(self) -> None:
        self.parameters.clear()

    # endregion

    # region State management — charts

    def add_charts(
        self, target: Union[Dict[str, Any], ModuleType, object]
    ) -> List[str]:
        """Inspect ``target`` and register any annotated chart getters. Returns added IDs."""
        added: List[str] = []
        target_dict: Optional[dict] = None
        if isinstance(target, dict):
            target_dict = target
        elif isinstance(target, ModuleType) or hasattr(target, "__dict__"):
            target_dict = vars(target)

        if target_dict is not None:
            for _, func, chart in get_chart_metadata_from_namespace(target_dict):
                self.charts[chart.id] = (chart, func)
                added.append(chart.id)

        if hasattr(target, "__class__") and not isinstance(target, (dict, ModuleType)):
            for name, func, chart in get_chart_metadata_from_namespace(
                vars(target.__class__)  # type: ignore
            ):
                self.charts[chart.id] = (chart, lambda t=target, f=func: f(t))
                added.append(chart.id)
        return added

    def remove_charts(self, chart_ids: List[str]) -> None:
        for cid in chart_ids:
            self.charts.pop(cid, None)

    def remove_all_charts(self) -> None:
        self.charts.clear()

    # endregion

    # region State management — actions

    def _register_action(self, meta: ActionMetadata, handler: Callable) -> None:
        self.actions[meta.id] = meta
        self._action_handlers[meta.id] = handler

    def add_custom_actions(
        self, target: Union[Dict[str, Any], ModuleType, object]
    ) -> None:
        """Register actions found on ``target`` (does not re-register built-ins)."""
        if isinstance(target, dict):
            for name, func, meta in get_action_metadata_from_namespace(target):
                self._register_action(meta, func or (lambda: target[name]()))
            return
        if isinstance(target, ModuleType) or (
            hasattr(target, "__dict__") and not hasattr(target, "__class__")
        ):
            for name, func, meta in get_action_metadata_from_namespace(vars(target)):
                self._register_action(meta, func or (lambda: getattr(target, name)()))
            return
        if hasattr(target, "__class__"):
            for name, _, meta in get_action_metadata_from_namespace(
                vars(target.__class__)  # type: ignore
            ):
                self._register_action(meta, getattr(target, name))

    def remove_action(self, action_id: str) -> None:
        self.actions.pop(action_id, None)
        self._action_handlers.pop(action_id, None)

    def remove_all_actions(self) -> None:
        self.actions.clear()
        self._action_handlers.clear()

    # endregion

    # region Lifecycle

    async def run(self) -> None:
        await self.server.run()

    # endregion


# endregion
