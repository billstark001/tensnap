"""
TenSnap simulation scenario — orchestration layer.

Owns all simulation state (parameters, environments, charts, actions) and wires
server I/O events to a list of SimulationHandler callbacks.

SimulationLoop has been merged directly into SimulationScenario; the step /
start / reset coroutines are registered as actions during __init__.
"""

from typing import (
    Any,
    Dict,
    Generic,
    List,
    Optional,
    Tuple,
    TypeVar,
    Union,
)

import asyncio
import inspect
import logging
import time
from collections.abc import Callable, Iterable
from types import ModuleType
from dataclasses import dataclass


from . import bindings as binding_api
from .bindings import (
    ActionMetadata,
    BindParametersConfig,
    ChartGroupMetadata,
)
from .handler import (
    DefaultSimulationHandler,
    SimulationHandler,
    SimulationHandlerProtocol,
    make_default_handlers,
)
from .helper import broadcast_env_update, dispatch_cud, send_env_snapshot
from .models import (
    EnvironmentBinding,
    EnvironmentRegistration,
    LayerBinding,
    Parameter,
    LayerRegistration,
    clone_environment_state,
)
from .protocol import (
    compute_action_deltas,
    compute_chart_deltas,
    compute_environment_deltas,
    compute_parameter_deltas,
    format_chart_update,
)
from .server import ServerToClientMessageType as MT, TenSnapServer
from .utils.attr import make_dict_getter_and_setter, make_attr_getter_and_setter

logger = logging.getLogger(__name__)


def _registry_change(kind: str, ids: Iterable[str]) -> Dict[str, List[str]]:
    return {kind: list(ids)}


def _merge_registry_changes(
    *changes: Dict[str, List[str]],
) -> Dict[str, List[str]]:
    merged: Dict[str, List[str]] = {}
    for change in changes:
        for kind, ids in change.items():
            merged.setdefault(kind, []).extend(ids)
    return merged


def _layer_registry_id(env_id: str, layer_id: str) -> str:
    return f"{env_id}.{layer_id}"


def _layer_registry_ids(env_id: str, layer_ids: Iterable[str]) -> List[str]:
    return [_layer_registry_id(env_id, layer_id) for layer_id in layer_ids]


def _split_layer_registry_id(
    value: str, env_ids: Iterable[str]
) -> Optional[Tuple[str, str]]:
    for env_id in sorted(env_ids, key=len, reverse=True):
        prefix = f"{env_id}."
        if value.startswith(prefix):
            layer_id = value[len(prefix) :]
            return (env_id, layer_id) if layer_id else None
    if "." not in value:
        return None
    env_id, layer_id = value.split(".", 1)
    return (env_id, layer_id) if layer_id else None


TValue = TypeVar("TValue")
TBinding = TypeVar("TBinding")


class SimulationScenario:
    """
    Main orchestration class.

    Owns all simulation state and wires TenSnapServer I/O events to a list
    of registered SimulationHandlers.  The built-in start / step / reset
    actions are registered automatically at construction time.
    """

    @dataclass
    class Registry(Generic[TValue, TBinding]):
        key: str
        value: TValue
        binding: TBinding

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
        self.environments: Dict[str, EnvironmentRegistration] = {}
        self.env_binders: Dict[str, EnvironmentRegistration] = self.environments
        self.parameters: Dict[str, Parameter] = {}
        self.actions: Dict[str, ActionMetadata] = {}
        self.charts: Dict[str, Tuple[ChartGroupMetadata, Callable]] = {}
        self._action_handlers: Dict[str, Callable] = {}
        self._builtin_action_ids: set[str] = set()

        # Step state
        self._time_step: int = 0
        self._initialized: bool = False
        self._init_lock = asyncio.Lock()
        self._action_lock = asyncio.Lock()

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
            self._builtin_action_ids.add(meta.id)

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
        model_reset: Optional[Callable] = None,
    ) -> None:
        """Convenience: create and register a DefaultSimulationHandler."""
        await self.register_handler(
            DefaultSimulationHandler(model_init, model_step, model_reset)
        )

    # endregion

    # region Event dispatch

    async def _fire_init(self) -> None:
        for h in self._handlers:
            on_init = getattr(h, "on_init", None)
            if on_init is None:
                await h.on_start(0)
                continue
            await on_init()

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
        self._initialized = True
        await self.clear_charts()
        await self._broadcast_full_state()

    async def _ensure_initialized(self, broadcast: bool = False) -> bool:
        if self._initialized:
            return False

        async with self._init_lock:
            if self._initialized:
                return False
            self._time_step = 0
            await self._fire_init()
            self._initialized = True

        if broadcast:
            await self._broadcast_full_state()
        return True

    async def _advance_step(self) -> None:
        await self._ensure_initialized(broadcast=True)
        self._time_step += 1
        await self._fire_step(self._time_step)

    async def _broadcast_full_state(self) -> None:
        await self.server.broadcast_metadata_update({"time": self._time_step})
        for environment in self.environments.values():
            env_state = clone_environment_state(environment.build_state())
            await broadcast_env_update(self.server, environment, env_state, None)
        await self.broadcast_charts(self._time_step)

    async def _send_current_state(self, ws: Any) -> None:
        await self.server.send(ws, MT.METADATA_UPDATE, {"time": self._time_step})
        await self.broadcast_charts(self._time_step, ws=ws)

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
        await self._ensure_initialized()

        # All delta computations are pure (non-blocking) — no need for gather
        action_d = compute_action_deltas(self.actions, req.get("actions", []))
        param_d, value_updates = compute_parameter_deltas(
            self.parameters, req.get("parameters", []), self._get_param_value
        )
        env_d = compute_environment_deltas(self.environments, req.get("envs", []))
        chart_d = compute_chart_deltas(self.charts, req.get("charts", []))

        # Apply client-sent values before responding (client wins on sync)
        for pid, val in value_updates:
            self._set_param_value(self.parameters[pid], val)

        client_env_map = {e["id"]: e for e in req.get("envs", [])}
        _send = lambda mt, p: self.server.send(ws, mt, p)

        try:
            # Actions
            await dispatch_cud(
                _send, action_d, MT.ACTION_CREATE, MT.ACTION_DELETE, MT.ACTION_UPDATE  # type: ignore
            )
            # Parameters
            await dispatch_cud(
                _send, param_d, MT.PARAM_CREATE, MT.PARAM_DELETE, MT.PARAM_UPDATE  # type: ignore
            )
            # Environments
            for env_state in env_d["added"]:
                await send_env_snapshot(ws, self.server, env_state)
            for env_id in env_d["removed"]:
                await self.server.send(ws, MT.ENV_DELETE, {"id": env_id})
            for env_state in env_d["updated"]:
                await send_env_snapshot(
                    ws, self.server, env_state, client_env_map.get(env_state["id"])
                )
            # Charts (updates are re-sent as creates per protocol)
            for item in chart_d["added"]:
                await self.server.send(ws, MT.CHART_CREATE, item)
            for cid in chart_d["removed"]:
                await self.server.send(ws, MT.CHART_DELETE, {"id": cid})
            for item in chart_d["updated"]:
                await self.server.send(ws, MT.CHART_CREATE, item)
            await self._send_current_state(ws)
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
        async with self._action_lock:
            started_at = time.perf_counter()
            try:
                if inspect.iscoroutinefunction(handler):
                    result = await handler()
                else:
                    result = await asyncio.get_event_loop().run_in_executor(
                        None, handler
                    )
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

    async def broadcast_charts(
        self,
        step: Optional[int] = None,
        ws: Optional[Any] = None,
    ) -> None:
        if not self.charts:
            return
        updates: List[Dict[str, Any]] = []
        for chart, getter in self.charts.values():
            try:
                value = await asyncio.get_event_loop().run_in_executor(None, getter)
                updates.extend(format_chart_update(chart, value, step))
            except Exception as e:
                logger.exception(f"Chart getter error for '{chart.id}': {e}")
        if updates:
            if ws is None:
                await self.server.broadcast(MT.CHART_UPDATE, {"updates": updates})
            else:
                await self.server.send(ws, MT.CHART_UPDATE, {"updates": updates})

    async def clear_charts(self, chart_ids: Optional[List[str]] = None) -> None:
        if not self.charts:
            return
        ids = chart_ids or list(self.charts.keys())
        ops = [{"id": cid, "operation": "clear"} for cid in ids if cid in self.charts]
        if ops:
            await self.server.broadcast(MT.CHART_UPDATE, {"operations": ops})

    # endregion

    # region State management — environments

    def add_environment_binding(
        self,
        binding: EnvironmentBinding | EnvironmentRegistration,
        *,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        if not isinstance(binding, (EnvironmentBinding, EnvironmentRegistration)):
            raise TypeError(
                "add_environment expects an EnvironmentBinding or EnvironmentRegistration."
            )

        if dry_run:
            return _registry_change("environments", [binding.id])

        if isinstance(binding, EnvironmentRegistration):
            registration = binding
        else:
            registration = self.environments.get(binding.id)
            if registration is None:
                registration = EnvironmentRegistration(binding)
            else:
                registration.binding = binding

        self.environments[registration.id] = registration
        return _registry_change("environments", [registration.id])

    def add_environment(
        self, target: object, *, dry_run: bool = False
    ) -> Dict[str, List[str]]:
        environment_binding, layer_bindings = binding_api.bindings(target)
        if environment_binding is None:
            raise ValueError(f"Target has no attached environment binding: {target}")

        if dry_run:
            return _merge_registry_changes(
                _registry_change("environments", [environment_binding.id]),
                _registry_change(
                    "layers",
                    [
                        _layer_registry_id(environment_binding.id, layer.layer_id)
                        for layer in layer_bindings
                    ],
                ),
            )

        changes = [self.add_environment_binding(environment_binding)]
        for layer_binding in layer_bindings:
            changes.append(
                self.add_layer_binding(environment_binding.id, layer_binding, target)
            )
        return _merge_registry_changes(*changes)

    def add_layer_binding(
        self,
        env_id: str,
        binding: LayerBinding[Any, Any, Any, Any],
        target: Any,
        *,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        if not isinstance(binding, LayerBinding):
            raise TypeError("add_layer expects a LayerBinding.")

        if dry_run:
            return _registry_change(
                "layers", [_layer_registry_id(env_id, binding.layer_id)]
            )

        environment = self.environments.get(env_id)
        if environment is None:
            raise KeyError(f"Unknown environment: {env_id}")

        registration = environment.layers.get(binding.layer_id)
        if registration is None:
            registration = LayerRegistration(binding=binding, target=target)
            environment.add_layer(registration)
        else:
            registration.binding = binding
            registration.set_target(target)
            registration.reset_diff_state()
        return _registry_change(
            "layers", [_layer_registry_id(env_id, binding.layer_id)]
        )

    def add_bound_layers(
        self, env_id: str, target: object, *, dry_run: bool = False
    ) -> Dict[str, List[str]]:
        changes: List[Dict[str, List[str]]] = []
        for layer_binding in binding_api.layer_bindings(target):
            changes.append(
                self.add_layer_binding(env_id, layer_binding, target, dry_run=dry_run)
            )
        return _merge_registry_changes(*changes) or _registry_change("layers", [])

    def set_layer_target(self, env_id: str, layer_id: str, target: Any) -> None:
        environment = self.environments.get(env_id)
        if environment is None or layer_id not in environment.layers:
            raise KeyError(f"Unknown layer: {env_id}.{layer_id}")

        environment.layers[layer_id].set_target(target)
        environment.layers[layer_id].reset_diff_state()

    def remove_layer(self, env_id: str, layer_id: str) -> Dict[str, List[str]]:
        environment = self.environments.get(env_id)
        if environment is None or layer_id not in environment.layers:
            return _registry_change("layers", [])
        environment.remove_layer(layer_id)
        return _registry_change("layers", [_layer_registry_id(env_id, layer_id)])

    def remove_all_layers(self, env_id: str) -> Dict[str, List[str]]:
        environment = self.environments.get(env_id)
        if environment is None:
            return _registry_change("layers", [])
        layer_ids = list(environment.layers)
        environment.clear_layers()
        return _registry_change("layers", _layer_registry_ids(env_id, layer_ids))

    def remove_environment(self, binder_id: str) -> Dict[str, List[str]]:
        environment = self.environments.pop(binder_id, None)
        if environment is None:
            return _merge_registry_changes(
                _registry_change("environments", []),
                _registry_change("layers", []),
            )
        return _merge_registry_changes(
            _registry_change("environments", [binder_id]),
            _registry_change(
                "layers", _layer_registry_ids(binder_id, environment.layers)
            ),
        )

    def remove_all_environments(self) -> Dict[str, List[str]]:
        env_ids = list(self.environments)
        layer_ids: List[str] = []
        for env_id, environment in self.environments.items():
            layer_ids.extend(_layer_registry_ids(env_id, environment.layers))
        self.environments.clear()
        return _merge_registry_changes(
            _registry_change("environments", env_ids),
            _registry_change("layers", layer_ids),
        )

    # endregion

    # region State management — parameters

    def add_parameters(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *cfg_suggest: BindParametersConfig,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """
        Inspect ``target`` and register any annotated parameters.

        Returns added parameter IDs grouped by registry type.
        """
        added_params: List[str] = []
        parameters = binding_api.parameters(target, *cfg_suggest)
        if dry_run:
            return _registry_change("parameters", [param.id for _, param in parameters])

        if isinstance(target, dict):
            for name, param in parameters:
                getter, setter = make_dict_getter_and_setter(name, target)
                self._register_parameter(param, getter, setter)
                added_params.append(param.id)
        else:
            for name, param in parameters:
                getter, setter = make_attr_getter_and_setter(name, target)
                self._register_parameter(param, getter, setter)
                added_params.append(param.id)
        return _registry_change("parameters", added_params)

    def _register_parameter(
        self,
        param: Parameter,
        getter: Optional[Callable] = None,
        setter: Optional[Callable] = None,
    ) -> None:
        self.parameters[param.id] = param.instantiate(getter=getter, setter=setter)

    def remove_parameters(self, param_ids: List[str]) -> Dict[str, List[str]]:
        removed: List[str] = []
        for pid in param_ids:
            if pid in self.parameters:
                self.parameters.pop(pid)
                removed.append(pid)
        return _registry_change("parameters", removed)

    def remove_all_parameters(self) -> Dict[str, List[str]]:
        removed = list(self.parameters)
        self.parameters.clear()
        return _registry_change("parameters", removed)

    # endregion

    # region State management — charts

    def add_charts(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Inspect ``target`` and register any annotated chart getters. Returns added IDs."""
        added: List[str] = []
        for _, func, chart in binding_api.charts(target):
            if func is None:
                continue
            if dry_run:
                added.append(chart.id)
                continue
            self.charts[chart.id] = (chart, func)
            added.append(chart.id)
        return _registry_change("charts", added)

    def remove_charts(self, chart_ids: List[str]) -> Dict[str, List[str]]:
        removed: List[str] = []
        for cid in chart_ids:
            if cid in self.charts:
                self.charts.pop(cid)
                removed.append(cid)
        return _registry_change("charts", removed)

    def remove_all_charts(self) -> Dict[str, List[str]]:
        removed = list(self.charts)
        self.charts.clear()
        return _registry_change("charts", removed)

    # endregion

    # region State management — actions

    def _register_action(self, meta: ActionMetadata, handler: Callable) -> None:
        self.actions[meta.id] = meta
        self._action_handlers[meta.id] = handler

    def add_actions(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Register actions found on ``target`` (does not re-register built-ins)."""
        added: List[str] = []
        for _, func, meta in binding_api.actions(target):
            if func is None:
                continue
            if dry_run:
                added.append(meta.id)
                continue
            self._register_action(meta, func)
            added.append(meta.id)
        return _registry_change("actions", added)

    def remove_action(self, action_id: str) -> Dict[str, List[str]]:
        existed = action_id in self.actions or action_id in self._action_handlers
        self.actions.pop(action_id, None)
        self._action_handlers.pop(action_id, None)
        return _registry_change("actions", [action_id] if existed else [])

    def remove_all_actions(self) -> Dict[str, List[str]]:
        removed = list(dict.fromkeys([*self.actions, *self._action_handlers]))
        self.actions.clear()
        self._action_handlers.clear()
        return _registry_change("actions", removed)

    # endregion

    # region State management - all

    def add_all(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *cfg_suggest: BindParametersConfig,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        changes: List[Dict[str, List[str]]] = []
        environment_binding = binding_api.environment_binding(target)
        if environment_binding is not None:
            changes.append(self.add_environment(target, dry_run=dry_run))
        else:
            changes.append(
                _merge_registry_changes(
                    _registry_change("environments", []),
                    _registry_change("layers", []),
                )
            )
        changes.append(self.add_parameters(target, *cfg_suggest, dry_run=dry_run))
        changes.append(self.add_actions(target, dry_run=dry_run))
        changes.append(self.add_charts(target, dry_run=dry_run))
        return _merge_registry_changes(*changes)

    def remove_all(self) -> Dict[str, List[str]]:
        action_ids = [
            action_id
            for action_id in self.actions
            if action_id not in self._builtin_action_ids
        ]
        action_changes = [self.remove_action(action_id) for action_id in action_ids]
        return _merge_registry_changes(
            self.remove_all_charts(),
            _merge_registry_changes(*action_changes) or _registry_change("actions", []),
            self.remove_all_parameters(),
            self.remove_all_environments(),
        )

    def remove_by_dict(self, removals: Dict[str, List[str]]) -> Dict[str, List[str]]:
        changes: List[Dict[str, List[str]]] = []

        if "charts" in removals:
            changes.append(self.remove_charts(removals["charts"]))
        if "actions" in removals:
            action_changes = [
                self.remove_action(action_id) for action_id in removals["actions"]
            ]
            changes.append(
                _merge_registry_changes(*action_changes)
                or _registry_change("actions", [])
            )
        if "parameters" in removals:
            changes.append(self.remove_parameters(removals["parameters"]))
        if "layers" in removals:
            layer_changes: List[Dict[str, List[str]]] = []
            for layer in removals["layers"]:
                parsed = _split_layer_registry_id(layer, self.environments)
                if parsed is None:
                    continue
                env_id, layer_id = parsed
                layer_changes.append(self.remove_layer(env_id, layer_id))
            changes.append(
                _merge_registry_changes(*layer_changes)
                or _registry_change("layers", [])
            )
        if "environments" in removals:
            changes.append(
                _merge_registry_changes(
                    *[
                        self.remove_environment(env_id)
                        for env_id in removals["environments"]
                    ]
                )
                or _merge_registry_changes(
                    _registry_change("environments", []),
                    _registry_change("layers", []),
                )
            )

        return _merge_registry_changes(*changes)

    # region Lifecycle

    async def run(self) -> None:
        await self.server.run()

    # endregion


# endregion
