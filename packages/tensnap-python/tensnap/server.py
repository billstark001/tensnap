"""
TenSnap WebSocket Server

Main server implementation for handling WebSocket connections and
broadcasting simulation updates to connected clients.
"""

import inspect
from types import ModuleType
from typing import Any, Dict, List, TYPE_CHECKING, Callable, Union, Optional, Tuple
import asyncio
import json
import logging
from websockets.server import WebSocketServerProtocol, serve
from websockets.exceptions import ConnectionClosed
import msgpack
from enum import Enum
from collections import defaultdict

from .bindings.basic import Parameter, ActionParameter, ChartMetadata

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .models import EnvironmentModel, StateSyncRequest, StateSyncResponse


class ServerToClientMessageType(Enum):
    TIME_STEP_START = "time_step_start"
    TIME_STEP_END = "time_step_end"
    ENVIRONMENT_UPDATE = "environment_update"
    AGENT_UPDATE = "agent_update"
    AGENT_BATCH_UPDATE = "agent_batch_update"
    CHART_UPDATE = "chart_update"
    STATE_SYNC = "state_sync"
    LOG = "log"
    ERROR = "error"


class ClientToServerMessageType(Enum):
    STATE_SYNC = "state_sync"
    PARAMETER_CHANGE = "parameter_change"
    BUTTON_CLICK = "button_click"
    ERROR = "error"


def encode_message(
    msg_type: ServerToClientMessageType, payload: Any, use_msgpack: bool = False
) -> str | bytes:
    type_str = msg_type.value
    msg = {"type": type_str, "payload": payload}
    return (
        msgpack.packb(msg, use_bin_type=True)
        if use_msgpack
        else json.dumps(msg, separators=(",", ":"))
    )  # type: ignore


class BatchedMessageQueue:
    def __init__(self, batch_size: int = 50, flush_interval: float = 0.01):
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self._queue = []
        self._last_flush = 0

    async def add(self, clients: set, message: str | bytes) -> None:
        self._queue.append((clients.copy(), message))

        if (
            len(self._queue) >= self.batch_size
            or asyncio.get_event_loop().time() - self._last_flush >= self.flush_interval
        ):
            await self._flush()

    async def _flush(self) -> None:
        if not self._queue:
            return

        client_msgs = defaultdict(list)
        for clients, msg in self._queue:
            for client in clients:
                client_msgs[client].append(msg)

        await asyncio.gather(
            *[self._send(c, m) for c, msgs in client_msgs.items() for m in msgs],
            return_exceptions=True,
        )

        self._queue.clear()
        self._last_flush = asyncio.get_event_loop().time()

    @staticmethod
    async def _send(client: WebSocketServerProtocol, message: str | bytes) -> None:
        try:
            await client.send(message)
        except Exception:
            pass


def convert_env_state(env: "EnvironmentModel") -> Dict[str, Any]:
    env_dict = env.get_model_dict()
    env_dict["agents"] = env.get_agent_list(is_update=False)
    return env_dict


class TenSnapServer:
    def __init__(
        self, host: str = "localhost", port: int = 8765, use_msgpack: bool = False
    ):
        self.host, self.port = host, port
        self.use_msgpack = use_msgpack

        self.clients: set[WebSocketServerProtocol] = set()
        self.environments: Dict[Union[str, int], "EnvironmentModel"] = {}
        self.parameters: Dict[str, "Parameter"] = {}
        self.charts: Dict[str, Tuple["ChartMetadata", Callable]] = {}
        self.button_handlers: Dict[str, Callable] = {}
        self._running = False
        self._queue = BatchedMessageQueue()
        self._bg_task = None

    def add_environment(self, env: "EnvironmentModel") -> None:
        self.environments[env.id] = env

    def add_parameter(self, param: "Parameter") -> None:
        self.parameters[param.id] = param

    def add_chart(self, getter: Callable, chart: "ChartMetadata") -> None:
        self.charts[chart.id] = (chart, getter)

    def register_action(
        self,
        action_parameter: ActionParameter,
        handler: Callable,
        register_parameter: bool = True,
    ) -> None:
        if register_parameter:
            self.add_parameter(action_parameter)
        self.button_handlers[action_parameter.id] = handler

    async def handle_client(
        self, websocket: WebSocketServerProtocol, path: str
    ) -> None:
        self.clients.add(websocket)
        logger.info(f"Client connected from {websocket.remote_address}")
        try:
            async for message in websocket:
                asyncio.create_task(self._handle_message(websocket, message))
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            logger.info(f"Client disconnected from {websocket.remote_address}")

    async def _handle_message(
        self, ws: WebSocketServerProtocol, msg: Union[str, bytes]
    ) -> None:
        try:
            data = (
                msgpack.unpackb(msg, raw=False)
                if isinstance(msg, bytes)
                else json.loads(msg)
            )
            msg_type, payload = data.get("type"), data.get("payload", {})

            if msg_type == ClientToServerMessageType.STATE_SYNC.value:
                await self._handle_state_sync(ws, payload)
            elif msg_type == ClientToServerMessageType.PARAMETER_CHANGE.value:
                await self._handle_param_change(payload)
            elif msg_type == ClientToServerMessageType.BUTTON_CLICK.value:
                await self._handle_button_click(payload)
            elif msg_type == ClientToServerMessageType.ERROR.value:
                logger.error(f"Client error: {payload.get('error')}")
            else:
                logger.warning(f"Unknown message type: {msg_type}")

        except Exception as e:
            logger.error(f"Error handling message: {e}")
            await self._send_error(ws, str(e))

    async def _build_sync_response(self, req: "StateSyncRequest"):
        params, envs, charts = await asyncio.gather(
            self._compute_deltas(
                "parameters", req, self.parameters, lambda p: p.to_dict()
            ),
            self._compute_deltas(
                "environments", req, self.environments, convert_env_state
            ),
            self._compute_deltas("charts", req, self.charts, lambda c: c[0].to_dict()),
        )

        return StateSyncResponse(
            mode="incremental",
            added_parameters=params["added"],
            removed_parameters=params["removed"],
            updated_parameters=params["updated"],
            added_environments=envs["added"],
            removed_environments=envs["removed"],
            updated_environments=envs["updated"],
            added_charts=charts["added"],
            removed_charts=charts["removed"],
            updated_charts=charts["updated"],
        )

    async def _compute_deltas(
        self, key: str, req: "StateSyncRequest", server_items: Dict, converter: Callable
    ) -> Dict[str, List]:
        client_ids = set(x["id"] for x in req.get(key, []))
        server_ids = set(server_items.keys())

        added = server_ids - client_ids
        removed = client_ids - server_ids
        updated = server_ids & client_ids

        # Handle parameter value updates
        if key == "parameters":
            cache = req.get("parameter_cache", {})
            updated_set = set()
            for pid in updated:
                param = server_items[pid]
                if param.type == "action":
                    continue
                current = self._get_param_value(param)
                cached = cache.get(pid)
                if cached is not None and param.setter:
                    self._set_param_value(param, cached)
                    current = cached
                if current != param.value:
                    updated_set.add(pid)
                    param.value = current
            updated = updated_set

        return {
            "added": [converter(server_items[i]) for i in added],
            "removed": list(removed),
            "updated": [converter(server_items[i]) for i in updated],
        }

    def _get_param_value(self, param: "Parameter") -> Any:
        if param.getter:
            try:
                return param.getter()
            except Exception as e:
                logger.error(f"Error getting parameter {param.id}: {e}")
        return None if param.type == "action" else param.value

    def _set_param_value(self, param: "Parameter", value: Any) -> None:
        if param.setter and param.type != "action":
            try:
                param.setter(value)
                param.value = value
            except Exception as e:
                logger.error(f"Error setting parameter {param.id}: {e}")

    async def send_state_sync(self):
        if not self.clients:
            return
        response = await self._build_sync_response(
            {"parameters": [], "environments": [], "charts": []}
        )
        await self._broadcast(ServerToClientMessageType.STATE_SYNC, response)

    async def _handle_state_sync(
        self, ws: WebSocketServerProtocol, req: "StateSyncRequest"
    ) -> None:
        response = await self._build_sync_response(req)
        await self._send(ws, ServerToClientMessageType.STATE_SYNC, response)

    async def _handle_param_change(self, payload: Dict[str, Any]) -> None:
        pid, value = payload.get("id"), payload.get("value")
        if value is None or pid not in self.parameters:
            return

        param = self.parameters[pid]
        if param.setter:
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, param.setter, value
                )
                if param.type != "action":
                    param.value = value
            except Exception as e:
                logger.error(f"Error setting parameter {pid}: {e}")

    async def _handle_button_click(self, payload: Dict[str, Any]) -> None:
        action = payload.get("action")
        if action not in self.button_handlers:
            return

        handler = self.button_handlers[action]
        try:
            if asyncio.iscoroutinefunction(handler):
                await handler()
            else:
                await asyncio.get_event_loop().run_in_executor(None, handler)
        except Exception as e:
            logger.error(f"Error handling button {action}: {e}")

    async def _broadcast(
        self, msg_type: ServerToClientMessageType, payload: Any
    ) -> None:
        if self.clients:
            await self._queue.add(
                self.clients, encode_message(msg_type, payload, self.use_msgpack)
            )

    async def _send(
        self,
        ws: WebSocketServerProtocol,
        msg_type: ServerToClientMessageType,
        payload: Any,
    ) -> None:
        try:
            await ws.send(encode_message(msg_type, payload, self.use_msgpack))
        except Exception:
            self.clients.discard(ws)

    async def _send_error(self, ws: WebSocketServerProtocol, error: str) -> None:
        await self._send(ws, ServerToClientMessageType.ERROR, {"error": error})

    async def start_time_step(self, time: int) -> None:
        await self._broadcast(ServerToClientMessageType.TIME_STEP_START, {"time": time})

    async def end_time_step(self, time: Optional[int] = None) -> None:
        if self.charts:
            results = await asyncio.gather(
                *[self._get_chart_update(c, g, time) for c, g in self.charts.values()],
                return_exceptions=True,
            )
            updates = [r for r in results if not isinstance(r, Exception)]
            if updates:
                await self._broadcast(
                    ServerToClientMessageType.CHART_UPDATE, {"updates": updates}
                )

        payload = {"time": time} if time is not None else {}
        await self._broadcast(ServerToClientMessageType.TIME_STEP_END, payload)

    async def _get_chart_update(
        self, chart: "ChartMetadata", getter: Callable, time: Optional[int]
    ) -> Dict[str, Any]:
        try:
            value = await asyncio.get_event_loop().run_in_executor(None, getter)
            ret = {"id": chart.id, "value": value}
            if time is not None:
                ret["time"] = time
            return ret
        except Exception as e:
            logger.error(f"Error getting chart data for {chart.id}: {e}")
            raise

    async def update_environment(
        self, env_id: Union[str, int], data: Dict[str, Any]
    ) -> None:
        await self._broadcast(
            ServerToClientMessageType.ENVIRONMENT_UPDATE, {"id": env_id, "data": data}
        )

    async def update_agent(
        self, env_id: Union[str, int], agent_id: Union[str, int], data: Dict[str, Any]
    ) -> None:
        await self._broadcast(
            ServerToClientMessageType.AGENT_UPDATE,
            {"environment_id": env_id, "agent_id": agent_id, "data": data},
        )

    async def update_agents_batch(
        self, env_id: Union[str, int], updates: List[Dict[str, Any]]
    ) -> None:
        await self._broadcast(
            ServerToClientMessageType.AGENT_BATCH_UPDATE,
            {"environment_id": env_id, "updates": updates},
        )

    async def _background_maintenance(self) -> None:
        while self._running:
            try:
                await self._queue._flush()
                self.clients = {c for c in self.clients if not c.closed}
                await asyncio.sleep(0.1)
            except Exception as e:
                logger.error(f"Error in background maintenance: {e}")

    async def run(self) -> None:
        self._running = True
        logger.info(f"Starting TenSnap server on {self.host}:{self.port}")
        self._bg_task = asyncio.create_task(self._background_maintenance())

        try:
            async with serve(self.handle_client, self.host, self.port):
                await asyncio.Event().wait()
        finally:
            self._running = False
            if self._bg_task:
                self._bg_task.cancel()
                try:
                    await self._bg_task
                except asyncio.CancelledError:
                    pass

    def stop(self) -> None:
        self._running = False

    # ... rest of the methods remain the same for auto-registration ...
    def auto_register_from_namespace(self, namespace: Dict[str, Any]) -> None:
        """Automatically register parameters, charts, and buttons from a namespace"""
        for name, obj in namespace.items():
            if hasattr(obj, "_tensnap_action"):
                param: "Parameter" = obj._tensnap_action
                self.add_parameter(param)
                if param.type == "action":
                    self.register_action(param, obj, False)
            elif hasattr(obj, "_tensnap_chart"):
                chart = obj._tensnap_chart
                self.add_chart(obj, chart)
            elif hasattr(obj, "param"):
                param = obj.param
                self.add_parameter(param)

    def auto_register_from_module(self, module: ModuleType) -> None:
        """Automatically register parameters, charts, and buttons from a module"""
        self.auto_register_from_namespace(vars(module))

    def auto_register_from_instance(self, instance: Any) -> None:
        """Automatically register parameters, charts, and buttons from a class instance"""
        namespace = {}
        for name in dir(instance):
            if not name.startswith("_"):
                try:
                    attr = getattr(instance, name)
                    namespace[name] = attr
                except Exception:
                    continue
        self.auto_register_from_namespace(namespace)

    def auto_register_from_globals(
        self, global_dict: Optional[Dict[str, Any]] = None
    ) -> None:
        """Automatically register from global namespace"""
        if global_dict is None:
            frame = inspect.currentframe()
            if frame and frame.f_back:
                global_dict = frame.f_back.f_globals
            else:
                logger.warning("Could not access caller's globals")
                return
        self.auto_register_from_namespace(global_dict)
