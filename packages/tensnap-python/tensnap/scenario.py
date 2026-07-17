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
from uuid import uuid4


from . import bindings as binding_api
from .bindings import (
    BindParametersConfig,
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
    ActionMetadata,
    ChartGroupMetadata,
    MonitorMetadata,
)
from .protocol import (
    compute_action_deltas,
    compute_chart_deltas,
    compute_environment_deltas,
    compute_monitor_deltas,
    compute_parameter_deltas,
    format_chart_update,
    layer_items,
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
        *,
        model_id: str = "tensnap.python.model",
        model_name: Optional[str] = None,
        model_description: Optional[str] = None,
        model_version: Optional[str] = None,
        state_schema_version: Optional[str] = None,
        capabilities: Optional[Iterable[str]] = None,
        capability_details: Optional[Dict[str, Any]] = None,
        scene_restore: Optional[Callable[[Dict[str, Any]], Any]] = None,
        checkpoint_capture: Optional[Callable[[], Any]] = None,
        collect_action_timings: bool = False,
    ) -> None:
        self.server = TenSnapServer(host=host, port=port, use_msgpack=use_msgpack)
        self.step_interval = step_interval
        if not model_id:
            raise ValueError("model_id must be a non-empty stable string")
        self.model_id = model_id
        self.state_schema_version = state_schema_version
        self.instance_id = uuid4().hex
        self._state_revision = 0
        self._scene_restore = scene_restore
        self._checkpoint_capture = checkpoint_capture
        # Timings are optional protocol diagnostics. Avoid a clock read and a
        # nested payload allocation on every continuous tick unless requested.
        self._collect_action_timings = collect_action_timings
        self._declared_capabilities = set(capabilities or [])
        self.capabilities = set(self._declared_capabilities)
        if scene_restore is not None:
            self.capabilities.add("scene.restore.projected")
        if checkpoint_capture is not None and scene_restore is not None:
            self.capabilities.add("scene.restore.checkpoint")
        model: Dict[str, Any] = {"id": model_id}
        if model_name is not None:
            model["name"] = model_name
        if model_description is not None:
            model["description"] = model_description
        if model_version is not None:
            model["version"] = model_version
        if state_schema_version is not None:
            model["state_schema_version"] = state_schema_version
        simulator_info: Dict[str, Any] = {
            "protocol_version": "0.3",
            "binding": {
                "name": "tensnap-python",
                "version": "0.3.0",
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

    # endregion

    def _refresh_simulator_info(self) -> None:
        """Refresh pre-connection handshake metadata after declarative setup."""
        self._simulator_info["capabilities"] = sorted(self.capabilities)
        self.server.set_simulator_info(self._simulator_info)

    def configure_scene_restore(
        self,
        restore: Optional[Callable[[Dict[str, Any]], Any]],
        *,
        checkpoint_capture: Optional[Callable[[], Any]] = None,
    ) -> None:
        """Declare explicit inverse hooks before clients connect.

        A binding never infers these hooks from projected state: callers must
        supply the model-specific inverse themselves.
        """
        self._scene_restore = restore
        self._checkpoint_capture = checkpoint_capture
        if restore is None:
            self.capabilities.discard("scene.restore.projected")
            self.capabilities.discard("scene.restore.checkpoint")
        else:
            self.capabilities.add("scene.restore.projected")
            if checkpoint_capture is not None:
                self.capabilities.add("scene.restore.checkpoint")
            else:
                self.capabilities.discard("scene.restore.checkpoint")
        self._refresh_simulator_info()

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

    async def _fire_step(self, step: int) -> bool:
        should_continue = True
        for h in self._handlers:
            result = await h.on_step(step)
            if result is not None:
                should_continue = should_continue and bool(result)
        return should_continue

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
        request_id = req.get("request_id") or uuid4().hex
        if req.get("model_id") not in (None, self.model_id):
            await self.server.send_error(
                ws,
                "state_sync model_id does not match this simulator.",
                code="model_mismatch",
                request_id=request_id,
            )
            return
        mode = "reconcile" if req.get("instance_id") == self.instance_id else "replace"
        begin = {
            "request_id": request_id,
            "model_id": self.model_id,
            "instance_id": self.instance_id,
            "mode": mode,
        }
        await self.server.send(ws, MT.STATE_SYNC_BEGIN, begin)
        await self._ensure_initialized()

        # All delta computations are pure (non-blocking) — no need for gather
        action_d = compute_action_deltas(self.actions, req.get("actions", []))
        param_d = compute_parameter_deltas(
            self.parameters, req.get("parameters", []), self._get_param_value
        )
        env_d = compute_environment_deltas(self.environments, req.get("envs", []))
        chart_d = compute_chart_deltas(self.charts, req.get("charts", []))
        monitor_d = compute_monitor_deltas(self.monitors, req.get("monitors", []))

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
                await self.server.send(ws, MT.CHART_DELETE, {"kind": "group", "id": cid})
            for item in chart_d["updated"]:
                await self.server.send(ws, MT.CHART_CREATE, item)
            # Monitor metadata has no distinct update message; create is the
            # canonical declaration/upsert frame.
            for item in [*monitor_d["added"], *monitor_d["updated"]]:
                await self.server.send(ws, MT.MONITOR_CREATE, item)
            for monitor_id in monitor_d["removed"]:
                await self.server.send(ws, MT.MONITOR_DELETE, {"id": monitor_id})
            await self._send_current_state(ws)
        finally:
            self._state_revision += 1
            await self.server.send(
                ws,
                MT.STATE_SYNC_END,
                {"request_id": request_id, "state_revision": str(self._state_revision)},
            )

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

    async def _on_action_start(self, ws: Any, payload: Dict[str, Any]) -> None:
        """Backward-compatible local hook name for the v0.3 action router."""
        await self._on_action_invoke(ws, payload)

    def _resolve_action_target(
        self, action: ActionMetadata, target: Any
    ) -> Optional[Dict[str, Any]]:
        scope = action.scope or "model"
        if scope == "model":
            return {"code": "invalid_target", "message": "This action does not accept a target."} if target is not None else None
        if not isinstance(target, dict) or target.get("type") != scope:
            return {"code": "invalid_target", "message": f"Action '{action.id}' requires a {scope} target."}
        env_id = target.get("env_id")
        environment = self.environments.get(env_id)
        if environment is None:
            return {"code": "invalid_target", "message": f"Unknown environment: {env_id}."}
        if scope == "env":
            return None
        layer_id = target.get("layer_id")
        registration = environment.layers.get(layer_id)
        if registration is None:
            return {"code": "invalid_target", "message": f"Unknown layer: {layer_id}."}
        if scope == "layer":
            return None
        state = registration.build_state()
        agent_id = target.get("agent_id")
        if not any(item.get("id") == agent_id for item in layer_items(state)):
            return {"code": "invalid_target", "message": f"Unknown agent: {agent_id}."}
        return None

    @staticmethod
    def _validated_action_kwargs(
        action: ActionMetadata, supplied: Any
    ) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        if supplied is None:
            supplied = {}
        if not isinstance(supplied, dict):
            return None, {"code": "invalid_kwargs", "message": "Action kwargs must be an object."}
        definitions = {definition["name"]: definition for definition in action.kwargs or []}
        unknown = set(supplied) - set(definitions)
        if unknown:
            return None, {"code": "invalid_kwargs", "message": f"Unknown action kwargs: {', '.join(sorted(unknown))}."}
        result: Dict[str, Any] = {}
        for name, definition in definitions.items():
            if name not in supplied:
                if definition.get("required"):
                    return None, {"code": "invalid_kwargs", "message": f"Missing required action kwarg: {name}."}
                if "default" in definition:
                    result[name] = definition["default"]
                continue
            value = supplied[name]
            kind = definition.get("type")
            valid = (
                kind == "json"
                or (kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool))
                or (kind == "integer" and isinstance(value, int) and not isinstance(value, bool))
                or (kind == "string" and isinstance(value, str))
                or (kind == "boolean" and isinstance(value, bool))
                or (kind == "enum" and isinstance(value, str) and value in definition.get("options", []))
            )
            if not valid:
                return None, {"code": "invalid_kwargs", "message": f"Invalid value for action kwarg: {name}."}
            if kind in {"number", "integer"} and (
                (definition.get("min") is not None and value < definition["min"])
                or (definition.get("max") is not None and value > definition["max"])
            ):
                return None, {"code": "invalid_kwargs", "message": f"Action kwarg out of range: {name}."}
            result[name] = value
        return result, None

    async def _on_action_invoke(self, ws: Any, payload: Dict[str, Any]) -> None:
        action_id = payload.get("id")
        request_id = payload.get("request_id") or payload.get("tick_id") or uuid4().hex
        handler = (
            self._action_handlers.get(action_id) if isinstance(action_id, str) else None
        )
        if handler is None:
            await self.server.send_action_end(
                ws,
                str(action_id),
                request_id=request_id,
                error={"code": "unknown_action", "message": f"No handler for action: {action_id}"},
            )
            return
        metadata = self.actions[str(action_id)]
        supplied_kwargs = payload.get("kwargs")
        fast_model_action = (
            metadata.scope in (None, "model")
            and not metadata.kwargs
            and payload.get("target") is None
            and (supplied_kwargs is None or (isinstance(supplied_kwargs, dict) and not supplied_kwargs))
        )
        kwargs: Optional[Dict[str, Any]] = None
        if not fast_model_action:
            target_error = self._resolve_action_target(metadata, payload.get("target"))
            kwargs, kwargs_error = self._validated_action_kwargs(metadata, supplied_kwargs)
            if target_error or kwargs_error:
                await self.server.send_action_end(
                    ws,
                    str(action_id),
                    request_id=request_id,
                    error=target_error or kwargs_error,
                )
                return
        async with self._action_lock:
            started_at = time.perf_counter() if self._collect_action_timings else None
            try:
                if fast_model_action:
                    if inspect.iscoroutinefunction(handler):
                        result = await handler()
                    else:
                        result = await asyncio.get_event_loop().run_in_executor(
                            None, handler
                        )
                else:
                    call_kwargs = dict(kwargs or {})
                    if metadata.scope not in (None, "model"):
                        signature = inspect.signature(handler)
                        if "target" in signature.parameters or any(
                            parameter.kind is inspect.Parameter.VAR_KEYWORD
                            for parameter in signature.parameters.values()
                        ):
                            call_kwargs["target"] = payload.get("target")
                    if inspect.iscoroutinefunction(handler):
                        result = await handler(**call_kwargs)
                    else:
                        result = await asyncio.get_event_loop().run_in_executor(
                            None, lambda: handler(**call_kwargs)
                        )
                continue_flag = bool(payload.get("continuous")) and bool(result)
                result_kwargs: Dict[str, Any] = {
                    "request_id": request_id,
                    "continue_": continue_flag,
                }
                if started_at is not None:
                    result_kwargs["simulate_ms"] = (time.perf_counter() - started_at) * 1000.0
                await self.server.send_action_end(ws, action_id, **result_kwargs)  # type: ignore[arg-type]
            except Exception as e:
                logger.exception(f"Action handler error ({action_id}): {e}")
                result_kwargs = {
                    "request_id": request_id,
                    "error": {"code": "handler_error", "message": str(e)},
                }
                if started_at is not None:
                    result_kwargs["simulate_ms"] = (time.perf_counter() - started_at) * 1000.0
                await self.server.send_action_end(ws, str(action_id), **result_kwargs)  # type: ignore[arg-type]

    async def _on_scene_restore(self, ws: Any, payload: Dict[str, Any]) -> None:
        request_id = payload.get("request_id") or uuid4().hex
        await self.server.send(ws, MT.SCENE_RESTORE_BEGIN, {"request_id": request_id})
        if self._scene_restore is None:
            error = {"code": "unsupported_capability", "message": "Projected scene restore is not configured."}
            await self.server.send(ws, MT.SCENE_RESTORE_END, {"request_id": request_id, "status": "rejected", "error": error})
            return
        if payload.get("model_id") != self.model_id:
            error = {"code": "model_mismatch", "message": "scene_restore model_id does not match this simulator."}
            await self.server.send(ws, MT.SCENE_RESTORE_END, {"request_id": request_id, "status": "rejected", "error": error})
            return
        if self.state_schema_version is not None and payload.get("state_schema_version") not in (None, self.state_schema_version):
            error = {"code": "state_schema_mismatch", "message": "scene_restore state schema is incompatible."}
            await self.server.send(ws, MT.SCENE_RESTORE_END, {"request_id": request_id, "status": "rejected", "error": error})
            return
        try:
            result = self._scene_restore(payload)
            if inspect.isawaitable(result):
                await result
            if "time" in payload:
                self._time_step = int(payload["time"])
            await self.server.send(ws, MT.METADATA_UPDATE, {"time": self._time_step})
            await self.server.send(ws, MT.SCENE_RESTORE_END, {"request_id": request_id, "status": "ok"})
        except Exception as error:
            logger.exception("Scene restore failed")
            await self.server.send(ws, MT.SCENE_RESTORE_END, {"request_id": request_id, "status": "failed", "error": {"code": "restore_failed", "message": str(error)}})

    async def _on_scene_capture(self, ws: Any, payload: Dict[str, Any]) -> None:
        request_id = payload.get("request_id") or uuid4().hex
        if self._scene_restore is None or self._checkpoint_capture is None:
            await self.server.send_error(ws, "Checkpoint capture is not configured.", code="unsupported_capability", request_id=request_id)
            return
        try:
            checkpoint = self._checkpoint_capture()
            if inspect.isawaitable(checkpoint):
                checkpoint = await checkpoint
            await self.server.send(ws, MT.SCENE_CAPTURE_RESULT, {"request_id": request_id, "model_id": self.model_id, **({"state_schema_version": self.state_schema_version} if self.state_schema_version is not None else {}), "checkpoint": checkpoint})
        except Exception as error:
            await self.server.send_error(ws, str(error), code="capture_failed", request_id=request_id)

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
        ops = [
            {"id": cid, "kind": "group", "operation": "clear"}
            for cid in ids
            if cid in self.charts
        ]
        if ops:
            await self.server.broadcast(MT.CHART_UPDATE, {"operations": ops})

    async def broadcast_monitors(self, ws: Optional[Any] = None) -> None:
        """Evaluate declarative monitor getters and emit their latest values."""
        for monitor, getter in self.monitors.values():
            try:
                if inspect.iscoroutinefunction(getter):
                    value = await getter()
                else:
                    value = await asyncio.get_event_loop().run_in_executor(None, getter)
                payload = {"id": monitor.id, "value": value}
                if ws is None:
                    await self.server.broadcast(MT.MONITOR_UPDATE, payload)
                else:
                    await self.server.send(ws, MT.MONITOR_UPDATE, payload)
            except Exception as error:
                logger.exception("Monitor getter error for '%s': %s", monitor.id, error)

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

    # region State management — monitors and scene restore

    def add_monitors(
        self,
        target: Union[Dict[str, Any], ModuleType, object],
        *,
        dry_run: bool = False,
    ) -> Dict[str, List[str]]:
        """Register ``@monitor`` getters declared by ``target``."""
        added: List[str] = []
        for _, getter, monitor in binding_api.monitors(target):
            if getter is None:
                continue
            added.append(monitor.id)
            if not dry_run:
                self.monitors[monitor.id] = (monitor, getter)
        if added and not dry_run:
            self.capabilities.add("monitor")
            self._refresh_simulator_info()
        return _registry_change("monitors", added)

    def remove_monitors(self, monitor_ids: List[str]) -> Dict[str, List[str]]:
        removed = [monitor_id for monitor_id in monitor_ids if self.monitors.pop(monitor_id, None) is not None]
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
        restore, checkpoint_capture = binding.bind(target)
        self.configure_scene_restore(restore, checkpoint_capture=checkpoint_capture)
        return True

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

        # 1. environment
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

        # 2. parameters
        param_bindings = (
            BindParametersConfig.get_configs(target.__class__)
            if hasattr(target, "__class__")
            else None
        )
        parameter_configs = cfg_suggest or (
            (BindParametersConfig.EXPLICIT_ONLY,) if not param_bindings else ()
        )
        changes.append(self.add_parameters(target, *parameter_configs, dry_run=dry_run))

        # 3. actions
        changes.append(self.add_actions(target, dry_run=dry_run))

        # 4. charts
        changes.append(self.add_charts(target, dry_run=dry_run))

        # 5. optional model-specific restore hooks. They are deliberately
        # omitted from registry changes because they are handshake capabilities,
        # not renderer-owned inventory.
        if not dry_run:
            self.add_scene_restore(target)

        # 6. monitors
        monitor_changes = self.add_monitors(target, dry_run=dry_run)
        if monitor_changes["monitors"]:
            changes.append(monitor_changes)

        return _merge_registry_changes(*changes)

    def remove_all(self) -> Dict[str, List[str]]:
        action_ids = [
            action_id
            for action_id in self.actions
            if action_id not in self._builtin_action_ids
        ]
        action_changes = [self.remove_action(action_id) for action_id in action_ids]
        changes = [
            self.remove_all_charts(),
            _merge_registry_changes(*action_changes) or _registry_change("actions", []),
            self.remove_all_parameters(),
            self.remove_all_environments(),
        ]
        monitor_changes = self.remove_all_monitors()
        if monitor_changes["monitors"]:
            changes.append(monitor_changes)
        return _merge_registry_changes(*changes)

    def remove_by_dict(self, removals: Dict[str, List[str]]) -> Dict[str, List[str]]:
        changes: List[Dict[str, List[str]]] = []

        if "charts" in removals:
            changes.append(self.remove_charts(removals["charts"]))
        if "monitors" in removals:
            changes.append(self.remove_monitors(removals["monitors"]))
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
