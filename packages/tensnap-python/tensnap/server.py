"""
TenSnap WebSocket Server

Main server implementation for handling WebSocket connections and
broadcasting simulation updates to connected clients.
"""

from typing import Any, Dict, List, TYPE_CHECKING, Callable, Union, Optional, Tuple, Set

import asyncio
import hashlib
import base64
import json
import logging
import datetime
from websockets.asyncio.server import serve, ServerConnection
from websockets.protocol import State as WebSocketState
from websockets.exceptions import ConnectionClosed
import msgpack
from enum import Enum
from collections import defaultdict

from .utils.ws import BatchedMessageQueue
from .utils.object import json_default, msgpack_default, find_objects_by_error
from .bindings.basic import (
    Parameter,
    ActionMetadata,
    ChartGroupMetadata,
    ChartMetadataDict,
    ChartGroupMetadataDict,
    categorize_charts,
)
from .models import (
    LogPayload,
    ParameterState,
)

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .models import EnvironmentBinderProtocol, StateSyncRequest


class ServerToClientMessageType(Enum):
    METADATA_UPDATE = "metadata_update"
    ACTION_END = "action_end"
    ACTION_CREATE = "action_create"
    ACTION_UPDATE = "action_update"
    ACTION_DELETE = "action_delete"
    ENV_CREATE = "env_create"
    ENV_DELETE = "env_delete"
    ENV_LAYER_CREATE = "env_layer_create"
    ENV_LAYER_UPDATE = "env_layer_update"
    ENV_LAYER_DELETE = "env_layer_delete"
    AGENT_CREATE = "agent_create"
    AGENT_UPDATE = "agent_update"
    AGENT_DELETE = "agent_delete"
    EDGE_CREATE = "edge_create"
    EDGE_UPDATE = "edge_update"
    EDGE_DELETE = "edge_delete"
    PARAM_CREATE = "param_create"
    PARAM_UPDATE = "param_update"
    PARAM_DELETE = "param_delete"
    PARAM_SYNC = "param_sync"
    CHART_CREATE = "chart_create"
    CHART_UPDATE = "chart_update"
    CHART_DELETE = "chart_delete"
    ASSET_META = "asset_meta"
    ASSET_DATA = "asset_data"
    ASSET_DELETE = "asset_delete"
    LOG = "log"
    ERROR = "error"


class ClientToServerMessageType(Enum):
    STATE_SYNC = "state_sync"
    PARAM_CHANGE = "param_change"
    ACTION_START = "action_start"
    ASSET_SYNC = "asset_sync"
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

        self.clients: set[ServerConnection] = set()
        self.environments: Dict[str, "EnvironmentBinderProtocol"] = {}
        self.parameters: Dict[str, "Parameter"] = {}
        self.actions: Dict[str, ActionMetadata] = {}
        self.charts: Dict[str, Tuple["ChartGroupMetadata", Callable]] = {}
        self.button_handlers: Dict[str, Callable] = {}
        # Assets: id → { id, hash, mime, size, label, data }
        self._assets: Dict[str, Dict[str, Any]] = {}
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
        action: ActionMetadata,
        handler: Callable,
    ) -> None:
        """Register an action (v0.2).  Actions are stored separately from
        parameters and sent via ``action_create`` messages.
        """
        self.actions[action.id] = action
        self.button_handlers[action.id] = handler

    def remove_environment(self, env_id: Union[str, int]) -> None:
        if env_id in self.environments:
            del self.environments[env_id]

    def remove_all_environments(self) -> None:
        self.environments.clear()

    def remove_parameter(self, param_id: str) -> None:
        if param_id in self.parameters:
            del self.parameters[param_id]

    def remove_all_parameters(self, include_actions: bool = False) -> None:
        """Remove all parameters.  ``include_actions`` is ignored (kept for
        backward compatibility) — actions are now in a separate store.
        """
        self.parameters.clear()

    def remove_chart(self, chart_id: str) -> None:
        if chart_id in self.charts:
            del self.charts[chart_id]

    def remove_all_charts(self) -> None:
        self.charts.clear()

    def remove_action(
        self,
        action_id: str,
        remove_parameter: bool = True,  # kept for backward compat, ignored
    ) -> None:
        self.actions.pop(action_id, None)
        self.button_handlers.pop(action_id, None)

    def remove_all_actions(
        self, remove_parameters: bool = True
    ) -> None:  # noqa: ARG002
        """Remove all actions and their handlers.

        ``remove_parameters`` is kept for backward compatibility but is
        ignored; actions are no longer stored in ``self.parameters``.
        """
        self.actions.clear()
        self.button_handlers.clear()

    async def handle_client(self, websocket: ServerConnection) -> None:
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
        self, ws: ServerConnection, msg: Union[str, bytes]
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
            elif msg_type == ClientToServerMessageType.PARAM_CHANGE.value:
                await self._handle_param_change(ws, payload)
            elif msg_type == ClientToServerMessageType.ACTION_START.value:
                await self._handle_action_start(ws, payload)
            elif msg_type == ClientToServerMessageType.ASSET_SYNC.value:
                await self._handle_asset_sync(ws, payload)
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

    async def _compute_action_deltas(self, req: List[Dict[str, Any]]):
        """Compute action CUD operations vs the client's reported actions."""
        client_ids = {x["id"] for x in req}
        server_ids = set(self.actions.keys())

        added = server_ids - client_ids
        removed = client_ids - server_ids
        common_ids = server_ids & client_ids

        # Detect metadata changes for common actions
        req_dict = {x["id"]: x for x in req}
        updated = set()
        for aid in common_ids:
            a = self.actions[aid]
            c = req_dict[aid]
            if (
                c.get("label") != a.label
                or c.get("continuous") != a.continuous
                or c.get("allowRuntimeChange", True) != a.allow_runtime_change
            ):
                updated.add(aid)

        return {
            "added": [self.actions[i].to_dict() for i in added],
            "removed": list(removed),
            "updated": [self.actions[i].to_dict() for i in updated],
        }

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
        self, req: List[Dict[str, Any]]
    ) -> Dict[str, List]:
        """req is now a list of { id, type, layers } dicts (v0.2 StateSyncRequest.envs)."""
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
        return param.value

    def _set_param_value(self, param: "Parameter", value: Any) -> None:
        if param.setter:
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
            pid: self._get_param_value(param) for pid, param in self.parameters.items()
        }

    async def broadcast_param_sync(self, param_id: str, value: Any) -> None:
        """Broadcast a param_sync message to notify clients of a server-side value change."""
        await self._broadcast(
            ServerToClientMessageType.PARAM_SYNC,
            {"id": param_id, "value": value},
        )

    async def _handle_state_sync(
        self, ws: ServerConnection, req: "StateSyncRequest"
    ) -> None:
        """v0.2: respond to state_sync with individual CUD messages."""
        params, actions, envs, charts = await asyncio.gather(
            self._compute_parameter_deltas(req.get("parameters", [])),
            self._compute_action_deltas(req.get("actions", [])),
            self._compute_environment_deltas(req.get("envs", [])),
            self._compute_chart_deltas(req.get("charts", [])),
        )

        # Actions (action_create / action_update / action_delete)
        for action_dict in actions["added"]:
            await self._send(ws, ServerToClientMessageType.ACTION_CREATE, action_dict)
        for action_id in actions["removed"]:
            await self._send(
                ws, ServerToClientMessageType.ACTION_DELETE, {"id": action_id}
            )
        for action_dict in actions["updated"]:
            await self._send(ws, ServerToClientMessageType.ACTION_UPDATE, action_dict)

        # Parameters
        for param_dict in params["added"]:
            await self._send(ws, ServerToClientMessageType.PARAM_CREATE, param_dict)
        for param_id in params["removed"]:
            await self._send(
                ws, ServerToClientMessageType.PARAM_DELETE, {"id": param_id}
            )
        for param_dict in params["updated"]:
            await self._send(ws, ServerToClientMessageType.PARAM_UPDATE, param_dict)

        # Environments (create env + layer + agents)
        for env_state in envs["added"]:
            env_id = env_state["id"]
            env_type = env_state.get("type", "uniform")
            v2_type = "2d" if env_type in ("grid", "graph") else "uniform"
            await self._send(
                ws,
                ServerToClientMessageType.ENV_CREATE,
                {"id": env_id, "type": v2_type},
            )
            await self._send(
                ws,
                ServerToClientMessageType.ENV_LAYER_CREATE,
                {
                    "env_id": env_id,
                    "layer_id": "",
                    "layer_type": env_type,
                    "data": {
                        k: v
                        for k, v in env_state.items()
                        if k not in ("id", "type", "agents")
                    },
                },
            )
            if env_state.get("agents"):
                await self._send(
                    ws,
                    ServerToClientMessageType.AGENT_CREATE,
                    {
                        "env_id": env_id,
                        "layer_id": "",
                        "agents": env_state["agents"],
                    },
                )
        for env_id in envs["removed"]:
            await self._send(ws, ServerToClientMessageType.ENV_DELETE, {"id": env_id})
        for env_state in envs["updated"]:
            env_id = env_state["id"]
            env_type = env_state.get("type", "uniform")
            await self._send(
                ws,
                ServerToClientMessageType.ENV_LAYER_UPDATE,
                {
                    "env_id": env_id,
                    "layer_id": "",
                    "data": {
                        k: v
                        for k, v in env_state.items()
                        if k not in ("id", "type", "agents")
                    },
                },
            )
            if env_state.get("agents") is not None:
                await self._send(
                    ws,
                    ServerToClientMessageType.AGENT_CREATE,
                    {
                        "env_id": env_id,
                        "layer_id": "",
                        "agents": env_state["agents"],
                    },
                )

        # Charts
        for chart_dict in charts["added"]:
            await self._send(ws, ServerToClientMessageType.CHART_CREATE, chart_dict)
        for chart_id in charts["removed"]:
            await self._send(
                ws, ServerToClientMessageType.CHART_DELETE, {"id": chart_id}
            )
        for chart_dict in charts["updated"]:
            await self._send(ws, ServerToClientMessageType.CHART_CREATE, chart_dict)

    async def _handle_param_change(
        self, ws: ServerConnection, payload: Dict[str, Any]
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
                param.value = value
            except Exception as e:
                logger.exception(f"Error setting parameter {pid}: {e}")
                await self._send_error(ws, f"Error setting parameter {pid}: {e}")

    async def _handle_action_start(
        self, ws: ServerConnection, payload: Dict[str, Any]
    ) -> None:
        action = payload.get("id")
        if action not in self.button_handlers:
            logger.warning(f"No handler found for action: {action}")
            return

        handler = self.button_handlers[action]
        try:
            if asyncio.iscoroutinefunction(handler):
                result = await handler()
            else:
                result = await asyncio.get_event_loop().run_in_executor(None, handler)
            # Send action_end; result can be False to stop a continuous loop
            continue_flag = None if result is None else bool(result)
            end_payload: Dict[str, Any] = {"id": action}
            if continue_flag is not None:
                end_payload["continue"] = continue_flag
            await self._send(ws, ServerToClientMessageType.ACTION_END, end_payload)
        except Exception as e:
            logger.exception(f"Error handling action {action}: {e}")
            await self._send_error(ws, f"Error handling action {action}: {e}")

    async def _broadcast(
        self, msg_type: ServerToClientMessageType, payload: dict
    ) -> None:
        if self.clients:
            await self._queue.add(
                self.clients, encode_message(msg_type, payload, self.use_msgpack)
            )

    async def _send(
        self,
        ws: ServerConnection,
        msg_type: ServerToClientMessageType,
        payload: Any,
    ) -> None:
        try:
            await ws.send(encode_message(msg_type, payload, self.use_msgpack))
        except Exception as e:
            logger.exception(f"Error sending message to client: {e}")
            self.clients.discard(ws)

    async def _send_error(self, ws: ServerConnection, error: str) -> None:
        try:
            await self._send(ws, ServerToClientMessageType.ERROR, {"error": error})
        except Exception as e:
            logger.exception(f"Failed to send error message to client: {e}")

    async def update_metadata(self, payload: Dict[str, Any]) -> None:
        await self._broadcast(ServerToClientMessageType.METADATA_UPDATE, payload)

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
        # v0.2: send env_layer_update for metadata, then agent_create for agent list
        if data:
            await self._broadcast(
                ServerToClientMessageType.ENV_LAYER_UPDATE,
                {"env_id": env_id, "layer_id": "", "data": data},
            )
        if agents is not None:
            await self._broadcast(
                ServerToClientMessageType.AGENT_CREATE,
                {"env_id": env_id, "layer_id": "", "agents": agents},
            )

    async def update_agent(
        self, env_id: Union[str, int], agent_id: Union[str, int], data: Dict[str, Any]
    ) -> None:
        diff = {"id": agent_id, **data}
        await self._broadcast(
            ServerToClientMessageType.AGENT_UPDATE,
            {"env_id": env_id, "layer_id": "", "agents": [diff]},
        )

    async def update_agents_batch(
        self, env_id: Union[str, int], updates: List[Dict[str, Any]]
    ) -> None:
        """Send agent CUD operations using v0.2 agent_create/agent_update/agent_delete."""
        creates: List[Dict[str, Any]] = []
        diffs: List[Dict[str, Any]] = []
        deletes: List[Any] = []

        for item in updates:
            op = item.get("operation")
            agent_id = item.get("id")
            if op == "create":
                agent_data = {k: v for k, v in item.items() if k != "operation"}
                creates.append(agent_data)
            elif op == "delete":
                deletes.append(agent_id)
            else:
                # update (default): use flat diff
                diff_data = item.get("data") or {}
                diff = {"id": agent_id, **diff_data}
                diffs.append(diff)

        if creates:
            await self._broadcast(
                ServerToClientMessageType.AGENT_CREATE,
                {"env_id": env_id, "layer_id": "", "agents": creates},
            )
        if diffs:
            await self._broadcast(
                ServerToClientMessageType.AGENT_UPDATE,
                {"env_id": env_id, "layer_id": "", "agents": diffs},
            )
        if deletes:
            await self._broadcast(
                ServerToClientMessageType.AGENT_DELETE,
                {"env_id": env_id, "layer_id": "", "ids": deletes},
            )

    # -------------------------------------------------------------------------
    # Asset management
    # -------------------------------------------------------------------------

    @staticmethod
    def _compute_asset_hash(data: bytes) -> str:
        """First 16 hex chars of SHA-256 of the raw data."""
        return hashlib.sha256(data).hexdigest()[:16]

    async def publish_asset(
        self,
        asset_id: str,
        data: bytes,
        mime: str,
        label: Optional[str] = None,
    ) -> None:
        """Register an asset and broadcast its metadata + data to all clients.

        If an asset with the same id and hash already exists, nothing is sent.
        """
        h = self._compute_asset_hash(data)
        existing = self._assets.get(asset_id)
        if existing and existing["hash"] == h:
            return  # unchanged

        self._assets[asset_id] = {
            "id": asset_id,
            "hash": h,
            "mime": mime,
            "size": len(data),
            "label": label,
            "data": data,
        }

        # Announce metadata first
        await self._broadcast(
            ServerToClientMessageType.ASSET_META,
            {
                "assets": [
                    {
                        "id": asset_id,
                        "hash": h,
                        "mime": mime,
                        "size": len(data),
                        "label": label,
                    }
                ]
            },
        )
        # Then push the actual data (base64 for JSON, raw bytes for msgpack)
        encoded: Union[str, bytes] = (
            base64.b64encode(data).decode("ascii") if not self.use_msgpack else data
        )
        await self._broadcast(
            ServerToClientMessageType.ASSET_DATA,
            {"id": asset_id, "hash": h, "mime": mime, "data": encoded},
        )

    async def delete_asset(self, asset_id: str) -> None:
        """Remove an asset from the cache and notify all clients."""
        if asset_id in self._assets:
            del self._assets[asset_id]
        await self._broadcast(
            ServerToClientMessageType.ASSET_DELETE,
            {"ids": [asset_id]},
        )

    async def _handle_asset_sync(
        self, ws: ServerConnection, payload: Dict[str, Any]
    ) -> None:
        """Client reports which assets it holds (id → hash).
        Respond with data for any asset the client is missing or has stale.
        """
        client_hashes: Dict[str, str] = payload.get("assets", {})
        for asset_id, asset in self._assets.items():
            client_hash = client_hashes.get(asset_id)
            if client_hash != asset["hash"]:
                encoded: Union[str, bytes] = (
                    base64.b64encode(asset["data"]).decode("ascii")
                    if not self.use_msgpack
                    else asset["data"]
                )
                await self._send(
                    ws,
                    ServerToClientMessageType.ASSET_DATA,
                    {
                        "id": asset_id,
                        "hash": asset["hash"],
                        "mime": asset["mime"],
                        "data": encoded,
                    },
                )

    async def _background_maintenance(self) -> None:
        while self._running:
            try:
                await self._queue.flush()
                self.clients = {
                    c for c in self.clients if c.state == WebSocketState.OPEN
                }
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
