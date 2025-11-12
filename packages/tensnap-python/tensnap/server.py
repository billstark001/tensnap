"""
TenSnap WebSocket Server

Main server implementation for handling WebSocket connections and
broadcasting simulation updates to connected clients.
"""

from typing import Any, Dict, List, TYPE_CHECKING, Callable, Union, Optional, Tuple, Set

import asyncio
import json
import logging
import datetime
from websockets.server import WebSocketServerProtocol, serve
from websockets.exceptions import ConnectionClosed
import msgpack
from enum import Enum
from collections import defaultdict

from .utils.ws import BatchedMessageQueue
from .utils.object import json_default, msgpack_default, find_objects_by_error
from .bindings.basic import (
    Parameter,
    ActionParameter,
    ChartGroupMetadata,
    ChartMetadataDict,
    ChartGroupMetadataDict,
    categorize_charts,
)
from .models import (
    StateSyncResponse,
    LogPayload,
    ParameterState,
    EnvironmentStateWithAgentsOmitted,
)

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .models import EnvironmentBinderProtocol, StateSyncRequest


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
    try:

        return (
            msgpack.packb(msg, default=msgpack_default, use_bin_type=True)
            if use_msgpack
            else json.dumps(msg, default=json_default, separators=(",", ":"))
        )  # type: ignore
    except TypeError as e:
        e_str = e.args[0] if e.args else str(e)
        err_obj = find_objects_by_error(payload, e_str)
        raise TypeError(
            f"Failed to serialize message of type {msg_type}: {e_str}. Problematic object(s): {err_obj}"
        ) from e


def convert_env_state(env: "EnvironmentBinderProtocol") -> Dict[str, Any]:
    env_dict = env.get_model_dict()
    env_dict["agents"] = env.get_agent_list()
    return env_dict


class TenSnapServer:
    def __init__(
        self, host: str = "localhost", port: int = 8765, use_msgpack: bool = False
    ):
        self.host, self.port = host, port
        self.use_msgpack = use_msgpack

        self.clients: set[WebSocketServerProtocol] = set()
        self.environments: Dict[str, "EnvironmentBinderProtocol"] = {}
        self.parameters: Dict[str, "Parameter"] = {}
        self.charts: Dict[str, Tuple["ChartGroupMetadata", Callable]] = {}
        self.button_handlers: Dict[str, Callable] = {}
        self._running = False
        self._queue = BatchedMessageQueue()
        self._bg_task = None

    def add_environment(self, env: "EnvironmentBinderProtocol") -> None:
        self.environments[env.id] = env

    def add_parameter(
        self,
        param: "Parameter",
        getter: Callable | None = None,
        setter: Callable | None = None,
    ) -> None:
        param_inst = param.instantiate(getter=getter, setter=setter)
        self.parameters[param.id] = param_inst

    def add_chart(self, getter: Callable, chart: "ChartGroupMetadata") -> None:
        self.charts[chart.id] = (chart, getter)

    def add_action(
        self,
        action_parameter: ActionParameter,
        handler: Callable,
        add_parameter: bool = True,
    ) -> None:
        if add_parameter:
            self.add_parameter(action_parameter)
        self.button_handlers[action_parameter.id] = handler

    def remove_environment(self, env_id: Union[str, int]) -> None:
        if env_id in self.environments:
            del self.environments[env_id]

    def remove_all_environments(self) -> None:
        self.environments.clear()

    def remove_parameter(self, param_id: str) -> None:
        if param_id in self.parameters:
            del self.parameters[param_id]

    def remove_all_parameters(self, include_actions = False) -> None:
        if include_actions:
            self.parameters.clear()
            return
        for param_id in list(self.parameters.keys()):
            if (
                param_id in self.parameters
                and self.parameters[param_id].type != "action"
            ):
                del self.parameters[param_id]

    def remove_chart(self, chart_id: str) -> None:
        if chart_id in self.charts:
            del self.charts[chart_id]

    def remove_all_charts(self) -> None:
        self.charts.clear()

    def remove_action(
        self,
        action_id: str,
        remove_parameter: bool = True,
    ) -> None:
        if action_id in self.button_handlers:
            del self.button_handlers[action_id]
        if remove_parameter:
            self.remove_parameter(action_id)

    def remove_all_actions(self, remove_parameters: bool = True) -> None:
        self.button_handlers.clear()
        if remove_parameters:
            for action_id in list(self.parameters.keys()):
                if (
                    action_id in self.parameters
                    and self.parameters[action_id].type == "action"
                ):
                    del self.parameters[action_id]

    async def handle_client(
        self, websocket: WebSocketServerProtocol, path: str
    ) -> None:
        self.clients.add(websocket)
        logger.info(f"Client connected from {websocket.remote_address}")
        try:
            async for message in websocket:
                try:
                    await self._handle_message(websocket, message)
                except Exception as e:
                    logger.exception(
                        f"Error handling message from {websocket.remote_address}: {e}"
                    )
                    # Continue processing next messages even if one fails
        except ConnectionClosed:
            pass
        except Exception as e:
            logger.exception(f"Connection error with {websocket.remote_address}: {e}")
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
                await self._handle_param_change(ws, payload)
            elif msg_type == ClientToServerMessageType.BUTTON_CLICK.value:
                await self._handle_button_click(ws, payload)
            elif msg_type == ClientToServerMessageType.ERROR.value:
                logger.error(f"Client error: {payload.get('error')}")
            else:
                logger.warning(f"Unknown message type: {msg_type}")

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            try:
                await self._send_error(ws, str(e))
            except Exception as send_error:
                logger.exception(f"Failed to send error message: {send_error}")

    async def _build_sync_response(self, req: "StateSyncRequest"):
        params, envs, charts = await asyncio.gather(
            self._compute_parameter_deltas(req.get("parameters", [])),
            self._compute_environment_deltas(req.get("environments", [])),
            self._compute_chart_deltas(req.get("charts", [])),
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

    async def _compute_parameter_deltas(self, req: List[ParameterState]):
        client_ids = set(x["id"] for x in req)
        server_ids = set(self.parameters.keys())

        added = server_ids - client_ids
        removed = client_ids - server_ids
        common_ids: Set[str] = server_ids & client_ids

        # Handle parameter value updates
        req_dict = {x["id"]: x for x in req}
        updated_set = set()
        for pid in common_ids:
            param = self.parameters[pid]
            param_client = req_dict[pid]
            # Check for type or other metadata changed
            if param_client["type"] != param.type:
                updated_set.add(pid)
                continue
            # Skip action parameters
            if param.type == "action":
                continue
            # Check for value changes
            client_value = param_client.get("value")
            if client_value is None:
                updated_set.add(pid)
                continue
            else:
                current = self._get_param_value(param)
                if client_value != current:
                    self._set_param_value(param, client_value)
                    current = client_value

        return {
            "added": [self.parameters[i].to_dict() for i in added],
            "removed": list(removed),
            "updated": [self.parameters[i].to_dict() for i in updated_set],
        }

    async def _compute_chart_deltas(self, req: List[ChartMetadataDict]):
        server_charts: List[ChartGroupMetadataDict] = [c[0].to_dict() for c in self.charts.values()]  # type: ignore
        return categorize_charts(req, server_charts)

    async def _compute_environment_deltas(
        self, req: List[EnvironmentStateWithAgentsOmitted]
    ) -> Dict[str, List]:
        client_ids = set(x["id"] for x in req)
        server_ids = set(self.environments.keys())

        added = server_ids - client_ids
        removed = client_ids - server_ids
        updated = server_ids & client_ids

        return {
            "added": [convert_env_state(self.environments[i]) for i in added],
            "removed": list(removed),
            "updated": [convert_env_state(self.environments[i]) for i in updated],
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
                logger.exception(f"Error setting parameter {param.id}: {e}")

    def get_parameter(self, param_id: str) -> Any:
        if param_id in self.parameters:
            param = self.parameters[param_id]
            return self._get_param_value(param)
        return None

    def set_parameter(self, param_id: str, value: Any) -> None:
        if param_id in self.parameters:
            param = self.parameters[param_id]
            self._set_param_value(param, value)

    def dump_parameters(self) -> Dict[str, Any]:
        return {
            pid: self._get_param_value(param)
            for pid, param in self.parameters.items()
            if param.type != "action"
        }

    async def _handle_state_sync(
        self, ws: WebSocketServerProtocol, req: "StateSyncRequest"
    ) -> None:
        response = await self._build_sync_response(req)
        await self._send(ws, ServerToClientMessageType.STATE_SYNC, response)

    async def _handle_param_change(
        self, ws: WebSocketServerProtocol, payload: Dict[str, Any]
    ) -> None:
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
                logger.exception(f"Error setting parameter {pid}: {e}")
                await self._send_error(ws, f"Error setting parameter {pid}: {e}")

    async def _handle_button_click(
        self, ws: WebSocketServerProtocol, payload: Dict[str, Any]
    ) -> None:
        action = payload.get("action")
        if action not in self.button_handlers:
            logger.warning(f"No handler found for button action: {action}")
            return

        handler = self.button_handlers[action]
        try:
            if asyncio.iscoroutinefunction(handler):
                await handler()
            else:
                await asyncio.get_event_loop().run_in_executor(None, handler)
        except Exception as e:
            logger.exception(f"Error handling button {action}: {e}")
            await self._send_error(ws, f"Error handling button {action}: {e}")

    async def _broadcast(
        self, msg_type: ServerToClientMessageType, payload: dict
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
        except Exception as e:
            logger.exception(f"Error sending message to client: {e}")
            self.clients.discard(ws)

    async def _send_error(self, ws: WebSocketServerProtocol, error: str) -> None:
        try:
            await self._send(ws, ServerToClientMessageType.ERROR, {"error": error})
        except Exception as e:
            logger.exception(f"Failed to send error message to client: {e}")

    async def start_time_step(self, time: int) -> None:
        await self._broadcast(ServerToClientMessageType.TIME_STEP_START, {"time": time})

    async def end_time_step(self, time: Optional[int] = None) -> None:
        payload = {"time": time} if time is not None else {}
        await self._broadcast(ServerToClientMessageType.TIME_STEP_END, payload)

    async def update_charts(self, time: Optional[int] = None) -> None:
        if not self.charts:
            return
        results_raw = await asyncio.gather(
            *[self._get_chart_update(c, g, time) for c, g in self.charts.values()],
            return_exceptions=True,
        )
        updates = []
        for r in results_raw:
            if isinstance(r, Exception):
                logger.exception(f"Error getting chart update: {r}")
            else:
                updates.extend(r)  # type: ignore
        if updates:
            await self._broadcast(
                ServerToClientMessageType.CHART_UPDATE, {"updates": updates}
            )

    async def clear_charts(self, chart_ids: Optional[List[str]] = None) -> None:
        if not self.charts:
            return
        if not chart_ids:
            chart_ids = list(self.charts.keys())
        operations = [
            {"id": cid, "operation": "clear"} for cid in chart_ids if cid in self.charts
        ]
        if operations:
            await self._broadcast(
                ServerToClientMessageType.CHART_UPDATE, {"operations": operations}
            )

    async def log_message(self, level: str, message: str) -> None:
        cur_timestamp_millis = int(
            datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000
        )
        await self._broadcast(
            ServerToClientMessageType.LOG,
            LogPayload(
                timestamp=cur_timestamp_millis,
                level=level,  # type: ignore
                message=message,
            ),
        )

    async def _get_chart_update(
        self, chart: "ChartGroupMetadata", getter: Callable, time: Optional[int]
    ) -> List[Dict[str, Any]]:
        try:
            value = await asyncio.get_event_loop().run_in_executor(None, getter)
            ret: List[Dict[str, Any]] = []
            if not chart.data_list:
                ret.append({"id": chart.id, "value": value})
            else:
                if isinstance(value, dict):
                    for data_meta in chart.data_list:
                        if data_meta.id in value:
                            ret.append(
                                {"id": data_meta.id, "value": value[data_meta.id]}
                            )
                elif isinstance(value, (list, tuple)):
                    for data_meta, val in zip(chart.data_list, value):
                        ret.append({"id": data_meta.id, "value": val})
                elif len(chart.data_list) == 1:
                    ret.append({"id": chart.data_list[0].id, "value": value})
                else:
                    raise ValueError(
                        f"Chart getter returned invalid type for multiple data series: {type(value)}"
                    )
            return ret
        except Exception as e:
            logger.exception(f"Error getting chart data for {chart.id}: {e}")
            raise

    async def update_environment(
        self,
        env_id: Union[str, int],
        data: Dict[str, Any] | None = None,
        agents: List[Dict[str, Any]] | None = None,
    ) -> None:
        await self._broadcast(
            ServerToClientMessageType.ENVIRONMENT_UPDATE,
            {"id": env_id, "data": data, "agents": agents},
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
                await self._queue.flush()
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
