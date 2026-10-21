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
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from types import ModuleType
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
from uuid import uuid4

from . import bindings as binding_api
from ._version import PROTOCOL_VERSION, __version__
from .bindings import (
    BindParametersConfig,
)
from .bindings.basic.restore import decode_checkpoint, encode_checkpoint
from .bindings.lifecycle import (
    BoundModelReinitializer,
    RegistryChanges,
    merge_registry_changes,
)
from .handler import (
    DefaultSimulationHandler,
    SimulationHandlerProtocol,
    make_default_handlers,
)
from .helper import broadcast_env_update, dispatch_cud, send_env_snapshot
from .models import (
    ActionMetadata,
    ChartGroupMetadata,
    EnvironmentBinding,
    EnvironmentRegistration,
    EnvironmentState,
    LayerBinding,
    LayerRegistration,
    MonitorMetadata,
    Parameter,
)
from .network import IPFamily
from .protocol import (
    compute_action_deltas,
    compute_chart_deltas,
    compute_environment_deltas,
    compute_monitor_deltas,
    compute_parameter_deltas,
    format_chart_update,
    item_key_payload,
    layer_dependency_layer_ids,
    layer_items,
)
from .server import ServerToClientMessageType as MT, TenSnapServer
from .utils.attr import make_attr_getter_and_setter, make_dict_getter_and_setter
from .utils.func import call_function

logger = logging.getLogger(__name__)


def _registry_change(kind: str, ids: Iterable[str]) -> Dict[str, List[str]]:
    return {kind: list(ids)}


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


def _pop_registered(store: Dict[str, Any], ids: Iterable[str]) -> List[str]:
    """Remove only present keys, reporting IDs once in input order."""
    removed = []
    for key in ids:
        if key in store:
            del store[key]
            removed.append(key)
    return removed


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

    # region Protocol configuration and capabilities

    def __init__(
        self,
        host: str = "localhost",
        port: int = 8765,
        use_msgpack: bool = False,
        step_interval: float = 0.05,  # not used in renderer-driven mode; kept for API compat
        *,
        ip_family: IPFamily = "auto",
        model_id: str = "tensnap.python.model",
        model_name: Optional[str] = None,
        model_description: Optional[str] = None,
        model_version: Optional[str] = None,
        state_schema_version: Optional[str] = None,
        capabilities: Optional[Iterable[str]] = None,
        capability_details: Optional[Dict[str, Any]] = None,
        scene_restore: Optional[Callable[[Dict[str, Any]], Any]] = None,
        checkpoint_capture: Optional[Callable[[], Any]] = None,
        checkpoint_restore: Optional[Callable[[Any], Any]] = None,
        collect_action_timings: bool = False,
    ) -> None:
        self.server = TenSnapServer(
            host=host, port=port, use_msgpack=use_msgpack, ip_family=ip_family
        )
        self.step_interval = step_interval
        if not model_id:
            raise ValueError("model_id must be a non-empty stable string")
        self.model_id = model_id
        self.state_schema_version = state_schema_version
        self.instance_id = uuid4().hex
        self._state_revision = 0
        self._scene_restore = scene_restore
        self._checkpoint_capture = checkpoint_capture
        self._checkpoint_restore = checkpoint_restore
        self._scene_restore_results: Dict[str, Dict[str, Any]] = {}
        # Timings are optional protocol diagnostics. Avoid a clock read and a
        # nested payload allocation on every continuous tick unless requested.
        self._collect_action_timings = collect_action_timings
        self._declared_capabilities = set(capabilities or [])
        self.capabilities = set(self._declared_capabilities)
        if scene_restore is not None:
            self.capabilities.add("scene.restore.projected")
        if checkpoint_capture is not None and checkpoint_restore is not None:
            self.capabilities.add("scene.restore.checkpoint")
        model: Dict[str, Any] = {"id": model_id}
        for key, value in (
            ("name", model_name), ("description", model_description),
            ("version", model_version), ("state_schema_version", state_schema_version),
        ):
            if value is not None:
                model[key] = value
        simulator_info: Dict[str, Any] = {
            "protocol_version": PROTOCOL_VERSION,
            "binding": {
                "name": "tensnap-python",
                "version": __version__,
                "language": "python",
            },
            "model": model,
            "instance_id": self.instance_id,
            "capabilities": sorted(self.capabilities),
        }
        if capability_details:
            simulator_info["capability_details"] = capability_details
        self._simulator_info = simulator_info
        self.server.set_simulator_info(self._simulator_info)

        # Simulation state stores
        self.environments: Dict[str, EnvironmentRegistration] = {}
        self.env_binders: Dict[str, EnvironmentRegistration] = self.environments
        self.parameters: Dict[str, Parameter] = {}
        self.actions: Dict[str, ActionMetadata] = {}
        self.charts: Dict[str, Tuple[ChartGroupMetadata, Callable]] = {}
        self.monitors: Dict[str, Tuple[MonitorMetadata, Callable]] = {}
        self._action_handlers: Dict[str, Callable] = {}
        self._builtin_action_ids: set[str] = set()

        # Step state
        self._time_step: int = 0
        self._initialized: bool = False
        self._init_lock = asyncio.Lock()
        self._action_lock = asyncio.Lock()

        # Handler list — called in registration order for each event
        self._handlers: List[SimulationHandlerProtocol] = []
        self._registered_model: object | None = None
        self._model_reinitializer: BoundModelReinitializer | None = None
        self._after_model_restore: Callable | None = None

        # Wire server incoming-message events
        self.server.on_state_sync = self._on_state_sync
        self.server.on_param_change = self._on_param_change
        self.server.on_action_invoke = self._on_action_invoke
        self.server.on_scene_restore = self._on_scene_restore
        self.server.on_scene_capture = self._on_scene_capture

        # Register built-in start / step / reset actions
        for fn in make_default_handlers(self):
            meta = fn._tensnap_action  # type: ignore[attr-defined]
            self.actions[meta.id] = meta
            self._action_handlers[meta.id] = fn
            self._builtin_action_ids.add(meta.id)

    def _refresh_simulator_info(self) -> None:
        """Refresh pre-connection handshake metadata after declarative setup."""
        self._simulator_info["capabilities"] = sorted(self.capabilities)
        self.server.set_simulator_info(self._simulator_info)

    def set_time_step(self, value: int) -> None:
        """Set the protocol clock from a model lifecycle/checkpoint callback.

        Publication remains owned by the surrounding init/reset/restore transaction.
        This changes no model state or scheduler and consumes no randomness.
        """
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("scenario time step must be a nonnegative integer")
        self._time_step = value

    def configure_scene_restore(
        self,
        restore: Optional[Callable[[Dict[str, Any]], Any]],
        *,
        checkpoint_capture: Optional[Callable[[], Any]] = None,
        checkpoint_restore: Optional[Callable[[Any], Any]] = None,
    ) -> None:
        """Declare explicit inverse hooks before clients connect.

        A binding never infers these hooks from projected state: callers must
        supply the model-specific inverse themselves.
        """
        self._scene_restore = restore
        self._checkpoint_capture = checkpoint_capture
        self._checkpoint_restore = checkpoint_restore
        if restore is None:
            self.capabilities.discard("scene.restore.projected")
        else:
            self.capabilities.add("scene.restore.projected")
        if checkpoint_capture is not None and checkpoint_restore is not None:
            self.capabilities.add("scene.restore.checkpoint")
        else:
            self.capabilities.discard("scene.restore.checkpoint")
        self._refresh_simulator_info()

    # endregion

    # region Model registration and lifecycle hooks

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
        if self._registered_model is not None:
            raise ValueError("A model lifecycle is already registered on this scenario")
        await self.register_handler(
            DefaultSimulationHandler(model_init, model_step, model_reset)
        )

    async def register_model(
        self,
        model: object,
        *,
        reinitializer: BoundModelReinitializer | None = None,
        model_step: Callable | None = None,
        model_time: Callable[[], int] | None = None,
        after_reinitialize: Callable | None = None,
        observe: Callable[[Any], Any] | None = None,
    ) -> BoundModelReinitializer:
        """Register one model's declarations and constructor-driven lifecycle.

        The scenario owns registry inventory, handlers and restore integration.
        A reinitializer only supplies construction choices and model cleanup.
        Model-specific checkpoint hooks use the existing declarations or scenario
        constructor. ``observe`` receives the live model after registration,
        initialization/reset, each step and successful restoration.
        """
        if self._registered_model is not None or any(
            isinstance(handler, DefaultSimulationHandler) for handler in self._handlers
        ):
            raise ValueError("A model lifecycle is already registered on this scenario")
        if reinitializer is None:
            reinitializer = BoundModelReinitializer(model)
        elif reinitializer.model is not model:
            raise ValueError("The reinitializer must own the registered model")

        strategy = reinitializer
        original_hooks = (
            self._scene_restore, self._checkpoint_capture, self._checkpoint_restore,
        )
        original_time = self._time_step
        planned = merge_registry_changes(
            self.add_all(model, dry_run=True), self.add_parameters(strategy, dry_run=True)
        )
        existing = {
            "environments": set(self.environments), "parameters": set(self.parameters),
            "actions": set(self.actions), "charts": set(self.charts),
            "monitors": set(self.monitors),
        }
        for kind, ids in planned.items():
            if len(ids) != len(set(ids)) or existing.get(kind, set()).intersection(ids):
                raise ValueError(f"Model {kind} contain duplicate or already registered IDs")

        def register_declarations() -> RegistryChanges:
            strategy.refresh_parameters()
            changes = merge_registry_changes(
                self.add_all(model), self.add_parameters(strategy)
            )
            if binding_api.scene_restore_binding(model) is None:
                self.configure_scene_restore(
                    original_hooks[0], checkpoint_capture=original_hooks[1],
                    checkpoint_restore=original_hooks[2],
                )
            return changes

        async def notify() -> None:
            if model_time is not None:
                self.set_time_step(model_time())
            if observe is not None:
                await call_function(observe, model)

        async def rebuild() -> None:
            nonlocal registered
            registered = await self._reinitialize_registered_model(
                strategy, registered, register_declarations
            )
            if after_reinitialize is not None:
                await call_function(after_reinitialize)
            await notify()

        async def step() -> Any:
            fn = model_step if model_step is not None else getattr(model, "step")
            result = await call_function(fn)
            await notify()
            return result

        async def after_restore() -> None:
            nonlocal registered
            self.remove_by_dict(registered)
            registered = register_declarations()
            await handler._prime_env_states()
            await notify()
            self._initialized = True

        # Reserve ownership before awaiting user callbacks. On failure remove
        # only this model's planned declarations, leaving other registrations.
        self._registered_model = model
        handler = DefaultSimulationHandler(rebuild, step, rebuild)
        try:
            registered = register_declarations()
            await notify()
            await self.register_handler(handler)
        except BaseException:
            self.remove_by_dict(planned)
            if handler in self._handlers:
                self._handlers.remove(handler)
            self.configure_scene_restore(
                original_hooks[0], checkpoint_capture=original_hooks[1],
                checkpoint_restore=original_hooks[2],
            )
            self._time_step = original_time
            self._registered_model = None
            raise
        self._model_reinitializer = strategy
        self._after_model_restore = after_restore
        return strategy

    async def _reinitialize_registered_model(
        self,
        reinitializer: BoundModelReinitializer,
        registered: RegistryChanges,
        register_declarations: Callable[[], RegistryChanges],
    ) -> RegistryChanges:
        reinitializer.reinitialize_model()
        self.remove_by_dict(registered)
        return register_declarations()

    # endregion

    # region Simulation stepping and reset publication

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

    async def _fire_step(self, step: int) -> bool:
        should_continue = True
        for h in self._handlers:
            result = await h.on_step(step)
            if result is not None:
                should_continue = should_continue and bool(result)
        return should_continue

    async def reset(self) -> None:
        """Reset handlers, protocol time, charts and declarations as one lifecycle operation.

        Bound actions may await this method; transport action dispatch provides serialization.
        """
        previous = self._capture_reset_inventory()
        self._time_step = 0
        self._initialized = False
        for h in self._handlers:
            await h.on_reset()
        self._initialized = True
        await self.clear_charts()
        await self._broadcast_reset_state(previous)

    def _capture_reset_inventory(self) -> Dict[str, Any]:
        parameters = []
        for param in self.parameters.values():
            entry = param.to_dict()
            entry["value"] = self._get_param_value(param)
            parameters.append(entry)
        return {
            "actions": [action.to_dict() for action in self.actions.values()],
            "parameters": parameters,
            "envs": {key: env.build_state() for key, env in self.environments.items()},
            "charts": {meta.id: meta.to_dict() for meta, _ in self.charts.values()},
            "monitors": [meta.to_dict() for meta, _ in self.monitors.values()],
        }

    async def _prepare_reset_environment(
        self, env_id: str, environment: EnvironmentRegistration,
        current: EnvironmentState, previous: EnvironmentState | None,
    ) -> None:
        """Prevent stale item deltas when a layer survives model reconstruction."""
        if previous is None or previous["type"] != current["type"]:
            return
        old_layers = {layer["layer_id"]: layer for layer in previous["layers"]}
        new_layers = {layer["layer_id"]: layer for layer in current["layers"]}
        for layer_id, registration in environment.layers.items():
            old = old_layers.get(layer_id)
            new = new_layers[layer_id]
            if not (
                old is not None
                and old["layer_type"] == new["layer_type"]
                and layer_dependency_layer_ids(old) == layer_dependency_layer_ids(new)
            ):
                continue
            if new["layer_type"] == "agent":
                deletes = [item_key_payload(old, item) for item in layer_items(old)]
                if deletes:
                    await self.server.broadcast(MT.ITEM_DELETE, {
                        "env_id": env_id, "layer_id": layer_id, "items": deletes,
                    })
                registration.reset_diff_state()
            else:
                registration.seed_item_deltas_from_state(old, False)

    async def _broadcast_reset_state(self, previous: Dict[str, Any]) -> None:
        """Publish registry changes before time/values, preserving item topology."""
        # Compute each delta when its turn is reached: the action broadcast
        # completes before parameter values are read, as in the old protocol.
        for compute, create, delete, update in (
            (lambda: compute_action_deltas(self.actions, previous["actions"]),
             MT.ACTION_CREATE, MT.ACTION_DELETE, MT.ACTION_UPDATE),
            (lambda: compute_parameter_deltas(
                self.parameters, previous["parameters"], self._get_param_value,
             ), MT.PARAM_CREATE, MT.PARAM_DELETE, MT.PARAM_UPDATE),
        ):
            await dispatch_cud(self.server.broadcast, compute(), create, delete, update)

        old_envs = previous["envs"]
        for env_id in old_envs.keys() - self.environments.keys():
            await self.server.broadcast(MT.ENV_DELETE, {"id": env_id})
        for env_id, environment in self.environments.items():
            current = environment.build_state()
            previous_env = old_envs.get(env_id)
            await self._prepare_reset_environment(
                env_id, environment, current, previous_env
            )
            await broadcast_env_update(
                self.server, environment, current, previous_env
            )

        old_charts = previous["charts"]
        new_charts = {meta.id: meta.to_dict() for meta, _ in self.charts.values()}
        changed = {
            key for key in old_charts.keys() & new_charts.keys()
            if old_charts[key] != new_charts[key]
        }
        for chart_id in (old_charts.keys() - new_charts.keys()) | changed:
            await self.server.broadcast(
                MT.CHART_DELETE, {"kind": "group", "id": chart_id}
            )
        for chart_id in (new_charts.keys() - old_charts.keys()) | changed:
            await self.server.broadcast(MT.CHART_CREATE, new_charts[chart_id])

        monitors = compute_monitor_deltas(self.monitors, previous["monitors"])
        for item in monitors["updated"]:
            await self.server.broadcast(MT.MONITOR_DELETE, {"id": item["id"]})
        for monitor_id in monitors["removed"]:
            await self.server.broadcast(MT.MONITOR_DELETE, {"id": monitor_id})
        for item in [*monitors["added"], *monitors["updated"]]:
            await self.server.broadcast(MT.MONITOR_CREATE, item)

        await self.server.broadcast_metadata_update({"time": self._time_step})
        await self.broadcast_charts(self._time_step)
        await self.broadcast_monitors()

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

    async def _advance_step(self) -> bool:
        await self._ensure_initialized(broadcast=True)
        self._time_step += 1
        return await self._fire_step(self._time_step)

    async def _broadcast_full_state(self) -> None:
        await self.server.broadcast_metadata_update({"time": self._time_step})
        for environment in self.environments.values():
            env_state = environment.build_state()
            await broadcast_env_update(self.server, environment, env_state, None)
        await self.broadcast_charts(self._time_step)
        await self.broadcast_monitors()

    async def _send_current_state(self, ws: Any) -> None:
        await self.server.send(ws, MT.METADATA_UPDATE, {"time": self._time_step})
        await self.broadcast_charts(self._time_step, ws=ws)
        await self.broadcast_monitors(ws=ws)

    # endregion

    # region Parameter values

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

    # region Incoming state sync and parameter changes

    async def _on_state_sync(self, ws: Any, req: Any) -> None:
        request_id = req.get("request_id") or uuid4().hex
        if req.get("model_id") not in (None, self.model_id):
            await self.server.send_error(
                ws, "state_sync model_id does not match this simulator.",
                code="model_mismatch", request_id=request_id,
            )
            return

        mode = "reconcile" if req.get("instance_id") == self.instance_id else "replace"
        await self._ensure_initialized()
        await self.server.send(ws, MT.STATE_SYNC_BEGIN, {
            "request_id": request_id, "model_id": self.model_id,
            "instance_id": self.instance_id, "mode": mode,
        })
        inventory = req if mode == "reconcile" else {}
        action_delta = compute_action_deltas(self.actions, inventory.get("actions", []))
        param_delta = compute_parameter_deltas(
            self.parameters, inventory.get("parameters", []), self._get_param_value
        )
        env_delta = compute_environment_deltas(
            self.environments, inventory.get("envs", [])
        )
        chart_delta = compute_chart_deltas(self.charts, inventory.get("charts", []))
        monitor_delta = compute_monitor_deltas(
            self.monitors, inventory.get("monitors", [])
        )
        old_envs = {env["id"]: env for env in inventory.get("envs", [])}
        send = lambda mt, data: self.server.send(ws, mt, data)

        try:
            await dispatch_cud(
                send, action_delta, MT.ACTION_CREATE, MT.ACTION_DELETE, MT.ACTION_UPDATE
            )
            await dispatch_cud(
                send, param_delta, MT.PARAM_CREATE, MT.PARAM_DELETE, MT.PARAM_UPDATE
            )
            for state in env_delta["added"]:
                await send_env_snapshot(ws, self.server, state)
            for env_id in env_delta["removed"]:
                await send(MT.ENV_DELETE, {"id": env_id})
            for state in env_delta["updated"]:
                await send_env_snapshot(
                    ws, self.server, state, old_envs.get(state["id"])
                )

            for chart in chart_delta["added"]:
                await send(MT.CHART_CREATE, chart)
            for chart_id in chart_delta["removed"]:
                await send(MT.CHART_DELETE, {"kind": "group", "id": chart_id})
            for chart in chart_delta["updated"]:
                await send(MT.CHART_DELETE, {"kind": "group", "id": chart["id"]})
                await send(MT.CHART_CREATE, chart)

            # Monitors have no UPDATE frame, so replace with DELETE + CREATE.
            for monitor in monitor_delta["updated"]:
                await send(MT.MONITOR_DELETE, {"id": monitor["id"]})
            for monitor in [*monitor_delta["added"], *monitor_delta["updated"]]:
                await send(MT.MONITOR_CREATE, monitor)
            for monitor_id in monitor_delta["removed"]:
                await send(MT.MONITOR_DELETE, {"id": monitor_id})
            await self._send_current_state(ws)
        finally:
            self._state_revision += 1
            await send(MT.STATE_SYNC_END, {
                "request_id": request_id, "state_revision": str(self._state_revision),
            })

    async def _on_param_change(self, ws: Any, payload: Dict[str, Any]) -> None:
        pid = payload.get("id")
        value = payload.get("value")
        if value is None or pid not in self.parameters:
            return
        param = self.parameters[pid]
        if not param.setter:
            await self.server.send(
                ws, MT.PARAM_SYNC, {"id": pid, "value": self._get_param_value(param)}
            )
            return
        try:
            await asyncio.get_event_loop().run_in_executor(None, param.setter, value)
            param.value = self._get_param_value(param) if param.getter else value
            if param.value != value:
                await self.server.send(
                    ws, MT.PARAM_SYNC, {"id": pid, "value": param.value}
                )
        except Exception as e:
            logger.exception(f"Error setting param '{pid}': {e}")
            await self.server.send(
                ws, MT.PARAM_SYNC, {"id": pid, "value": self._get_param_value(param)}
            )
            await self.server.send_error(ws, f"Error setting param '{pid}': {e}")

    # endregion

    # region Action target, validation, execution

    def _resolve_action_target(
        self, action: ActionMetadata, target: Any
    ) -> Optional[Dict[str, Any]]:
        def invalid(message: str) -> Dict[str, str]:
            return {"code": "invalid_target", "message": message}

        scope = action.scope or "model"
        if scope == "model":
            return invalid("This action does not accept a target.") if target is not None else None
        if not isinstance(target, dict) or target.get("type") != scope:
            return invalid(f"Action '{action.id}' requires a {scope} target.")
        env_id = target.get("env_id")
        environment = (
            self.environments.get(env_id) if isinstance(env_id, str) else None
        )
        if environment is None:
            return invalid(f"Unknown environment: {env_id}.")
        if scope == "env":
            return None
        layer_id = target.get("layer_id")
        registration = (
            environment.layers.get(layer_id) if isinstance(layer_id, str) else None
        )
        if registration is None:
            return invalid(f"Unknown layer: {layer_id}.")
        if scope == "layer":
            return None
        agent_id = target.get("agent_id")
        items = layer_items(registration.build_state())
        if not any(item.get("id") == agent_id for item in items):
            return invalid(f"Unknown agent: {agent_id}.")
        return None

    @staticmethod
    def _matches_action_value(definition: Dict[str, Any], value: Any) -> bool:
        """Protocol kwargs types (not generic Python type coercion)."""
        kind = definition.get("type")
        if kind == "json":
            return True
        if kind == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if kind == "integer":
            return isinstance(value, int) and not isinstance(value, bool)
        if kind == "string":
            return isinstance(value, str)
        if kind == "boolean":
            return isinstance(value, bool)
        if kind == "enum":
            return isinstance(value, str) and value in definition.get("options", [])
        return False

    @staticmethod
    def _validated_action_kwargs(
        action: ActionMetadata, supplied: Any
    ) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        if supplied is None:
            supplied = {}
        if not isinstance(supplied, dict):
            return None, {
                "code": "invalid_kwargs", "message": "Action kwargs must be an object.",
            }
        definitions = {
            definition["name"]: definition for definition in action.kwargs or []
        }
        unknown = set(supplied) - set(definitions)
        if unknown:
            return None, {
                "code": "invalid_kwargs",
                "message": f"Unknown action kwargs: {', '.join(sorted(unknown))}.",
            }
        result: Dict[str, Any] = {}
        for name, definition in definitions.items():
            if name not in supplied:
                if definition.get("required"):
                    return None, {
                        "code": "invalid_kwargs",
                        "message": f"Missing required action kwarg: {name}.",
                    }
                if "default" in definition:
                    result[name] = definition["default"]
                continue
            value = supplied[name]
            if not SimulationScenario._matches_action_value(definition, value):
                return None, {
                    "code": "invalid_kwargs",
                    "message": f"Invalid value for action kwarg: {name}.",
                }
            if definition.get("type") in {"number", "integer"} and (
                (definition.get("min") is not None and value < definition["min"])
                or (definition.get("max") is not None and value > definition["max"])
            ):
                return None, {
                    "code": "invalid_kwargs",
                    "message": f"Action kwarg out of range: {name}.",
                }
            result[name] = value
        return result, None

    async def _call_action_handler(
        self, handler: Callable, metadata: ActionMetadata,
        kwargs: Optional[Dict[str, Any]], target: Any, fast: bool,
    ) -> Any:
        """Run synchronous handlers in the executor; keep the tick fast path."""
        call_kwargs = {} if fast else dict(kwargs or {})
        if not fast and metadata.scope not in (None, "model"):
            signature = inspect.signature(handler)
            if "target" in signature.parameters or any(
                p.kind is inspect.Parameter.VAR_KEYWORD
                for p in signature.parameters.values()
            ):
                call_kwargs["target"] = target
        if inspect.iscoroutinefunction(handler):
            return await handler(**call_kwargs)
        loop = asyncio.get_event_loop()
        if fast:
            return await loop.run_in_executor(None, handler)
        return await loop.run_in_executor(None, lambda: handler(**call_kwargs))

    async def _on_action_invoke(self, ws: Any, payload: Dict[str, Any]) -> None:
        action_id = payload.get("id")
        request_id = payload.get("request_id") or payload.get("tick_id") or uuid4().hex
        handler = (
            self._action_handlers.get(action_id) if isinstance(action_id, str) else None
        )
        if handler is None:
            await self.server.send_action_result(
                ws, str(action_id), request_id=request_id,
                error={"code": "unknown_action", "message": f"No handler for action: {action_id}"},
            )
            return

        metadata = self.actions[str(action_id)]
        supplied = payload.get("kwargs")
        fast = (
            metadata.scope in (None, "model")
            and not metadata.kwargs
            and payload.get("target") is None
            and (supplied is None or isinstance(supplied, dict) and not supplied)
        )
        kwargs: Optional[Dict[str, Any]] = None
        if not fast:
            target_error = self._resolve_action_target(metadata, payload.get("target"))
            kwargs, kwargs_error = self._validated_action_kwargs(metadata, supplied)
            if target_error or kwargs_error:
                await self.server.send_action_result(
                    ws, str(action_id), request_id=request_id,
                    error=target_error or kwargs_error,
                )
                return

        async with self._action_lock:
            started = time.perf_counter() if self._collect_action_timings else None
            try:
                result = await self._call_action_handler(
                    handler, metadata, kwargs, payload.get("target"), fast
                )
                options: Dict[str, Any] = {
                    "request_id": request_id,
                    "continue_": bool(payload.get("continuous")) and bool(result),
                }
                if started is not None:
                    options["simulate_ms"] = (time.perf_counter() - started) * 1000.0
                await self.server.send_action_result(ws, str(action_id), **options)
            except Exception as error:
                logger.exception("Action handler error (%s): %s", action_id, error)
                options = {
                    "request_id": request_id,
                    "error": {"code": "handler_error", "message": str(error)},
                }
                if started is not None:
                    options["simulate_ms"] = (time.perf_counter() - started) * 1000.0
                await self.server.send_action_result(ws, str(action_id), **options)

    # endregion

    # region Transactional scene restore

    async def _send_restore_result(
        self, ws: Any, result: Dict[str, Any], *, begin: bool = False,
        cache: bool = True,
    ) -> None:
        """Keep BEGIN/END ordering and cache completed (but not busy) requests."""
        request_id = result["request_id"]
        if cache:
            self._scene_restore_results[request_id] = result
        if begin:
            await self.server.send(ws, MT.SCENE_RESTORE_BEGIN, {"request_id": request_id})
        await self.server.send(ws, MT.SCENE_RESTORE_END, result)

    async def _on_scene_restore(self, ws: Any, payload: Dict[str, Any]) -> None:
        request_id = payload.get("request_id") or uuid4().hex
        cached = self._scene_restore_results.get(request_id)
        if cached is not None:
            await self._send_restore_result(ws, cached, begin=True, cache=False)
            return
        if self._action_lock.locked():
            await self._send_restore_result(ws, {
                "request_id": request_id, "status": "rejected",
                "error": {"code": "busy", "message": "Wait for the active operation."},
            }, begin=True, cache=False)
            return
        async with self._action_lock:
            await self._perform_scene_restore(ws, payload)

    def _restore_rejection(self, payload: Dict[str, Any]) -> Dict[str, str] | None:
        """Validate protocol identity/capability before touching model-owned state."""
        projected = any(key in payload for key in ("time", "parameters", "envs"))
        if payload.get("model_id") != self.model_id:
            return {
                "code": "model_mismatch",
                "message": "scene_restore model_id does not match this simulator.",
            }
        if payload.get("expected_instance_id") not in (None, self.instance_id):
            return {
                "code": "instance_mismatch",
                "message": "scene_restore expected_instance_id is stale.",
            }
        if self.state_schema_version is not None and payload.get(
            "state_schema_version"
        ) not in (None, self.state_schema_version):
            return {
                "code": "state_schema_mismatch",
                "message": "scene_restore state schema is incompatible.",
            }
        if self._scene_restore is None and projected:
            return {
                "code": "unsupported_capability",
                "message": "Projected scene restore is not configured.",
            }
        if payload.get("checkpoint") is not None and (
            self._checkpoint_capture is None or self._checkpoint_restore is None
        ):
            return {
                "code": "unsupported_capability",
                "message": "Checkpoint restore is not configured.",
            }
        if not any(k in payload for k in ("checkpoint", "time", "parameters", "envs")):
            return {
                "code": "invalid_restore",
                "message": "scene_restore contains no restorable state.",
            }
        return None

    async def _invoke_restore_hook(self, name: str, *args: Any) -> None:
        """Support both synchronous and asynchronous composed restore hooks."""
        hook = getattr(self._scene_restore, name, None)
        if hook is not None:
            value = hook(*args)
            if inspect.isawaitable(value):
                await value

    async def _rollback_scene_restore(
        self, checkpoint: Any, strategy: BoundModelReinitializer | None,
        pending: Dict[str, Any], init_kwargs: Dict[str, Any],
    ) -> None:
        await self._apply_model_checkpoint(checkpoint)
        if strategy is not None:
            strategy._restore_pending_values(pending)
            strategy.init_kwargs = init_kwargs
        await self._invoke_restore_hook("rebind_targets")
        if self._after_model_restore is not None:
            await self._after_model_restore()

    async def _perform_scene_restore(self, ws: Any, payload: Dict[str, Any]) -> None:
        request_id = payload.get("request_id") or uuid4().hex
        cached = self._scene_restore_results.get(request_id)
        if cached is not None:
            await self._send_restore_result(ws, cached, begin=True, cache=False)
            return

        rejection = self._restore_rejection(payload)
        if rejection is not None:
            await self._send_restore_result(ws, {
                "request_id": request_id, "status": "rejected", "error": rejection,
            }, begin=True)
            return

        projected = any(k in payload for k in ("time", "parameters", "envs"))
        checkpoint = payload.get("checkpoint")
        # Reject invalid composed projections *before* starting a transaction.
        if projected and checkpoint is None:
            try:
                await self._invoke_restore_hook("prepare", payload)
            except Exception as error:
                await self._send_restore_result(ws, {
                    "request_id": request_id, "status": "rejected",
                    "error": {"code": "invalid_restore", "message": str(error)},
                }, begin=True)
                return

        previous_ids = {
            "actions": list(self.actions), "parameters": list(self.parameters),
            "envs": list(self.environments), "monitors": list(self.monitors),
        }
        previous_time, previous_initialized = self._time_step, self._initialized
        strategy = self._model_reinitializer
        pending = strategy._capture_pending_values() if strategy else {}
        init_kwargs = dict(strategy.init_kwargs) if strategy else {}
        can_rollback = (
            self._checkpoint_capture is not None
            and self._checkpoint_restore is not None
        )
        rollback_checkpoint: Any = None
        if can_rollback:
            try:
                rollback_checkpoint = self._checkpoint_capture()  # type: ignore[misc]
                if inspect.isawaitable(rollback_checkpoint):
                    rollback_checkpoint = await rollback_checkpoint
            except Exception as error:
                await self._send_restore_result(ws, {
                    "request_id": request_id, "status": "failed",
                    "error": {
                        "code": "restore_failed",
                        "message": f"capture rollback checkpoint: {error}",
                    },
                }, begin=True)
                return

        await self.server.send(ws, MT.SCENE_RESTORE_BEGIN, {"request_id": request_id})
        try:
            if checkpoint is not None:
                await self._apply_model_checkpoint(decode_checkpoint(checkpoint))
                await self._invoke_restore_hook("rebind_targets")
            if projected:
                projection = {k: v for k, v in payload.items() if k != "checkpoint"}
                if checkpoint is not None:
                    await self._invoke_restore_hook("prepare", projection)
                result = self._scene_restore(projection)  # type: ignore[misc]
                if inspect.isawaitable(result):
                    await result

            await self._invoke_restore_hook("rebind_targets")
            if self._after_model_restore is not None:
                await self._after_model_restore()
            if "time" in payload:
                self._time_step = int(payload["time"])
            await self._send_restore_state(ws, previous_ids)
            await self._send_restore_result(
                ws, {"request_id": request_id, "status": "ok"}
            )
        except Exception as error:
            logger.exception("Scene restore failed")
            self._time_step = previous_time
            rollback_error: Exception | None = None
            if can_rollback:
                try:
                    await self._rollback_scene_restore(
                        rollback_checkpoint, strategy, pending, init_kwargs
                    )
                except Exception as caught:
                    rollback_error = caught
                    logger.exception("Scene restore rollback failed")
            self._time_step = previous_time
            self._initialized = previous_initialized
            message = str(error)
            if rollback_error is not None:
                message = f"{message}; rollback failed: {rollback_error}"
            await self._send_restore_result(ws, {
                "request_id": request_id, "status": "failed",
                "error": {"code": "restore_failed", "message": message},
            })

    async def _apply_model_checkpoint(self, data: Any) -> None:
        """Restore model data, then refresh constructor controls from that model."""
        strategy = self._model_reinitializer
        result = self._checkpoint_restore(data)  # type: ignore[misc]
        if inspect.isawaitable(result):
            await result
        if strategy is not None:
            strategy.sync_from_model()

    async def _send_restore_state(
        self, ws: Any, previous_ids: Dict[str, List[str]]
    ) -> None:
        """Replace renderer inventory; charts intentionally remain untouched."""
        for category, msg_type in (
            ("monitors", MT.MONITOR_DELETE), ("actions", MT.ACTION_DELETE),
            ("parameters", MT.PARAM_DELETE), ("envs", MT.ENV_DELETE),
        ):
            for item_id in previous_ids[category]:
                await self.server.send(ws, msg_type, {"id": item_id})

        for action in self.actions.values():
            await self.server.send(ws, MT.ACTION_CREATE, action.to_dict())
        for parameter in self.parameters.values():
            definition = parameter.to_dict()
            definition["value"] = self._get_param_value(parameter)
            await self.server.send(ws, MT.PARAM_CREATE, definition)
        for environment in self.environments.values():
            state = environment.build_state()
            await send_env_snapshot(ws, self.server, state)
            environment.seed_item_deltas_from_state(state, False)
        for monitor, _ in self.monitors.values():
            await self.server.send(ws, MT.MONITOR_CREATE, monitor.to_dict())
        await self.server.send(ws, MT.METADATA_UPDATE, {"time": self._time_step})
        await self.broadcast_monitors(ws=ws)
        await self.server.send_asset_meta(ws)

    # endregion

    # region Checkpoint capture

    async def _on_scene_capture(self, ws: Any, payload: Dict[str, Any]) -> None:
        if self._action_lock.locked():
            await self.server.send_error(
                ws,
                "Wait for the active operation.",
                code="busy",
                request_id=payload.get("request_id"),
            )
            return
        async with self._action_lock:
            await self._perform_scene_capture(ws, payload)

    async def _perform_scene_capture(self, ws: Any, payload: Dict[str, Any]) -> None:
        request_id = payload.get("request_id") or uuid4().hex
        if self._checkpoint_capture is None or self._checkpoint_restore is None:
            await self.server.send_error(
                ws, "Checkpoint capture is not configured.",
                code="unsupported_capability", request_id=request_id,
            )
            return
        try:
            data = self._checkpoint_capture()
            if inspect.isawaitable(data):
                data = await data
            checkpoint = encode_checkpoint(data, use_msgpack=self.server.use_msgpack)
            result = {"request_id": request_id, "model_id": self.model_id}
            if self.state_schema_version is not None:
                result["state_schema_version"] = self.state_schema_version
            result["checkpoint"] = checkpoint
            await self.server.send(ws, MT.SCENE_CAPTURE_RESULT, result)
        except Exception as error:
            await self.server.send_error(
                ws, str(error), code="capture_failed", request_id=request_id
            )

    # endregion

    # region Chart and monitor broadcasts

    async def broadcast_charts(
        self, step: Optional[int] = None, ws: Optional[Any] = None
    ) -> None:
        if not self.charts:
            return
        updates: List[Dict[str, Any]] = []
        for chart, getter in self.charts.values():
            try:
                value = await asyncio.get_event_loop().run_in_executor(None, getter)
                updates.extend(format_chart_update(chart, value, step))
            except Exception as error:
                logger.exception("Chart getter error for '%s': %s", chart.id, error)
        if updates:
            if ws is None:
                await self.server.broadcast(MT.CHART_UPDATE, {"updates": updates})
            else:
                await self.server.send(ws, MT.CHART_UPDATE, {"updates": updates})

    async def clear_charts(self, chart_ids: Optional[List[str]] = None) -> None:
        if not self.charts:
            return
        ids = chart_ids or list(self.charts.keys())
        ops = [
            {"id": cid, "kind": "group", "operation": "clear"}
            for cid in ids
            if cid in self.charts
        ]
        if ops:
            await self.server.broadcast(MT.CHART_UPDATE, {"operations": ops})

    async def broadcast_monitors(self, ws: Optional[Any] = None) -> None:
        """Read declarative monitors and deliver their latest values."""
        send = (
            self.server.broadcast if ws is None
            else lambda mt, data: self.server.send(ws, mt, data)
        )
        for monitor, getter in self.monitors.values():
            try:
                if inspect.iscoroutinefunction(getter):
                    value = await getter()
                else:
                    value = await asyncio.get_event_loop().run_in_executor(None, getter)
                await send(MT.MONITOR_UPDATE, {"id": monitor.id, "value": value})
            except Exception as error:
                logger.exception("Monitor getter error for '%s': %s", monitor.id, error)

    # endregion

    # region Registry: environments and layers

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
        env_binding, layers = binding_api.bindings(target)
        if env_binding is None:
            raise ValueError(f"Target has no attached environment binding: {target}")
        if dry_run:
            return merge_registry_changes(
                _registry_change("environments", [env_binding.id]),
                _registry_change("layers", (
                    _layer_registry_id(env_binding.id, layer.layer_id)
                    for layer in layers
                )),
            )
        changes = [self.add_environment_binding(env_binding)]
        changes.extend(
            self.add_layer_binding(env_binding.id, layer, target) for layer in layers
        )
        return merge_registry_changes(*changes)

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
            environment.invalidate_topology()
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
        return merge_registry_changes(*changes) or _registry_change("layers", [])

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
            return merge_registry_changes(
                _registry_change("environments", []),
                _registry_change("layers", []),
            )
        return merge_registry_changes(
            _registry_change("environments", [binder_id]),
            _registry_change(
                "layers", _layer_registry_ids(binder_id, environment.layers)
            ),
        )

    def remove_all_environments(self) -> Dict[str, List[str]]:
        env_ids = list(self.environments)
        layer_ids = [
            key for env_id, env in self.environments.items()
            for key in _layer_registry_ids(env_id, env.layers)
        ]
        self.environments.clear()
        return merge_registry_changes(
            _registry_change("environments", env_ids),
            _registry_change("layers", layer_ids),
        )

    # endregion

    # region Registry: parameters

    def add_parameters(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *cfg_suggest: BindParametersConfig,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Inspect annotated fields and register their live value accessors."""
        parameters = binding_api.parameters(target, *cfg_suggest)
        if dry_run:
            return _registry_change("parameters", (p.id for _, p in parameters))
        added = []
        for name, param in parameters:
            getter, setter = (
                make_dict_getter_and_setter(name, target)
                if isinstance(target, dict)
                else make_attr_getter_and_setter(name, target)
            )
            self._register_parameter(param, getter, setter)
            added.append(param.id)
        return _registry_change("parameters", added)

    def _register_parameter(
        self,
        param: Parameter,
        getter: Optional[Callable] = None,
        setter: Optional[Callable] = None,
    ) -> None:
        self.parameters[param.id] = param.instantiate(
            getter=param.getter if param.getter is not None else getter,
            setter=param.setter if param.setter is not None else setter,
        )

    def remove_parameters(self, param_ids: List[str]) -> Dict[str, List[str]]:
        return _registry_change("parameters", _pop_registered(self.parameters, param_ids))

    def remove_all_parameters(self) -> Dict[str, List[str]]:
        removed = list(self.parameters)
        self.parameters.clear()
        return _registry_change("parameters", removed)

    # endregion

    # region Registry: charts

    def add_charts(
        self, target: Union[Dict[str, Any], ModuleType, object],
        *, dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Inspect annotated chart getters and register the callable pairs."""
        added = []
        for _, func, chart in binding_api.charts(target):
            if func is not None:
                added.append(chart.id)
                if not dry_run:
                    self.charts[chart.id] = (chart, func)
        return _registry_change("charts", added)

    def remove_charts(self, chart_ids: List[str]) -> Dict[str, List[str]]:
        return _registry_change("charts", _pop_registered(self.charts, chart_ids))

    def remove_all_charts(self) -> Dict[str, List[str]]:
        removed = list(self.charts)
        self.charts.clear()
        return _registry_change("charts", removed)

    # endregion

    # region Registry: monitors and restore declaration

    def add_monitors(
        self, target: Union[Dict[str, Any], ModuleType, object],
        *, dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Register @monitor getters; advertise capability when actually installed."""
        added = []
        for _, getter, monitor in binding_api.monitors(target):
            if getter is not None:
                added.append(monitor.id)
                if not dry_run:
                    self.monitors[monitor.id] = (monitor, getter)
        if added and not dry_run:
            self.capabilities.add("monitor")
            self._refresh_simulator_info()
        return _registry_change("monitors", added)

    def remove_monitors(self, monitor_ids: List[str]) -> Dict[str, List[str]]:
        removed = [
            mid for mid in monitor_ids if self.monitors.pop(mid, None) is not None
        ]
        if not self.monitors and "monitor" not in self._declared_capabilities:
            self.capabilities.discard("monitor")
            self._refresh_simulator_info()
        return _registry_change("monitors", removed)

    def remove_all_monitors(self) -> Dict[str, List[str]]:
        return self.remove_monitors(list(self.monitors))

    def add_scene_restore(
        self, target: Union[Dict[str, Any], ModuleType, object]
    ) -> bool:
        """Install a model's ``@scene_restore`` declaration, if present."""
        binding = binding_api.scene_restore_binding(target)
        if binding is None:
            return False
        restore, checkpoint_capture, checkpoint_restore = binding.bind(target, self)
        self.configure_scene_restore(
            restore,
            checkpoint_capture=checkpoint_capture,
            checkpoint_restore=checkpoint_restore,
        )
        return True

    # endregion

    # region Registry: actions

    def _register_action(self, meta: ActionMetadata, handler: Callable) -> None:
        self.actions[meta.id] = meta
        self._action_handlers[meta.id] = handler

    def add_actions(
        self, target: Union[Dict[str, Any], ModuleType, object],
        *, dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Register declared actions without re-registering built-in actions."""
        added = []
        for _, func, meta in binding_api.actions(target):
            if func is not None:
                added.append(meta.id)
                if not dry_run:
                    self._register_action(meta, func)
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

    # region Registry: bulk registration and removal

    def add_all(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *cfg_suggest: BindParametersConfig,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Register declarations in environment → parameter → action → chart order."""
        if binding_api.environment_binding(target) is not None:
            environment_changes = self.add_environment(target, dry_run=dry_run)
        else:
            environment_changes = merge_registry_changes(
                _registry_change("environments", []),
                _registry_change("layers", []),
            )
        configs = BindParametersConfig.get_configs(type(target))
        parameter_configs = cfg_suggest or (
            (BindParametersConfig.EXPLICIT_ONLY,) if not configs else ()
        )
        changes = [
            environment_changes,
            self.add_parameters(target, *parameter_configs, dry_run=dry_run),
            self.add_actions(target, dry_run=dry_run),
            self.add_charts(target, dry_run=dry_run),
        ]
        # Restore hooks are handshake capabilities, not renderer registrations.
        if not dry_run:
            self.add_scene_restore(target)
        monitors = self.add_monitors(target, dry_run=dry_run)
        if monitors["monitors"]:
            changes.append(monitors)
        return merge_registry_changes(*changes)

    def remove_all(self) -> Dict[str, List[str]]:
        action_ids = [
            action_id
            for action_id in self.actions
            if action_id not in self._builtin_action_ids
        ]
        action_changes = [self.remove_action(action_id) for action_id in action_ids]
        changes = [
            self.remove_all_charts(),
            merge_registry_changes(*action_changes) or _registry_change("actions", []),
            self.remove_all_parameters(),
            self.remove_all_environments(),
        ]
        monitor_changes = self.remove_all_monitors()
        if monitor_changes["monitors"]:
            changes.append(monitor_changes)
        return merge_registry_changes(*changes)

    def remove_by_dict(self, removals: Dict[str, List[str]]) -> Dict[str, List[str]]:
        """Remove layered dependencies before their owning environments."""
        changes: List[Dict[str, List[str]]] = []
        for kind, remove in (
            ("charts", self.remove_charts), ("monitors", self.remove_monitors),
        ):
            if kind in removals:
                changes.append(remove(removals[kind]))
        if "actions" in removals:
            changed = merge_registry_changes(*(
                self.remove_action(action_id) for action_id in removals["actions"]
            ))
            changes.append(changed or _registry_change("actions", []))
        if "parameters" in removals:
            changes.append(self.remove_parameters(removals["parameters"]))
        if "layers" in removals:
            changed = []
            for item in removals["layers"]:
                parsed = _split_layer_registry_id(item, self.environments)
                if parsed is not None:
                    changed.append(self.remove_layer(*parsed))
            changes.append(
                merge_registry_changes(*changed) or _registry_change("layers", [])
            )
        if "environments" in removals:
            changed = merge_registry_changes(*(
                self.remove_environment(env_id) for env_id in removals["environments"]
            ))
            changes.append(changed or merge_registry_changes(
                _registry_change("environments", []),
                _registry_change("layers", []),
            ))
        return merge_registry_changes(*changes)

    # endregion

    # region Transport lifecycle

    async def run(self) -> None:
        await self.server.run()

    # endregion


