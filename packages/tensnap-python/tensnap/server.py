"""
TenSnap WebSocket Server — pure I/O layer.

Responsibilities: message codec, connection lifecycle, event dispatch for
incoming messages, and typed send/broadcast helpers. No business logic.
"""

import asyncio
import base64
import datetime
import hashlib
import json
import logging
import time
from copy import deepcopy
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, Optional, Set, Union, cast
from uuid import uuid4

import msgpack
from websockets.asyncio.server import serve, ServerConnection
from websockets.exceptions import ConnectionClosed
from websockets.protocol import State as WebSocketState

from .utils.codec import find_objects_by_error, json_default, msgpack_default
from .utils.ws import BatchedMessageQueue

logger = logging.getLogger(__name__)

# region Message type enums


class ServerToClientMessageType(Enum):
    METADATA_UPDATE = "metadata_update"
    STATE_SYNC_BEGIN = "state_sync_begin"
    STATE_SYNC_END = "state_sync_end"
    ACTION_END = "action_end"
    ACTION_CREATE = "action_create"
    ACTION_UPDATE = "action_update"
    ACTION_DELETE = "action_delete"
    ENV_CREATE = "env_create"
    ENV_DELETE = "env_delete"
    ENV_LAYER_CREATE = "env_layer_create"
    ENV_LAYER_UPDATE = "env_layer_update"
    ENV_LAYER_DELETE = "env_layer_delete"
    ITEM_CREATE = "item_create"
    ITEM_UPDATE = "item_update"
    ITEM_DELETE = "item_delete"
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
    SCREENSHOT_REQUEST = "screenshot_request"
    LOG = "log"
    ERROR = "error"


class ClientToServerMessageType(Enum):
    STATE_SYNC = "state_sync"
    PARAM_CHANGE = "param_change"
    ACTION_START = "action_start"
    ASSET_SYNC = "asset_sync"
    SCREENSHOT_RESPONSE = "screenshot_response"
    ERROR = "error"


# endregion

# region Codec


def encode_message(
    msg_type: ServerToClientMessageType, payload: Any, use_msgpack: bool = False
) -> Union[str, bytes]:
    msg = {"type": msg_type.value, "payload": payload}
    try:
        return cast(
            Union[str, bytes],
            (
                msgpack.packb(msg, default=msgpack_default, use_bin_type=True)
                if use_msgpack
                else json.dumps(msg, default=json_default, separators=(",", ":"))
            ),
        )
    except TypeError as e:
        e_str = e.args[0] if e.args else str(e)
        raise TypeError(
            f"Failed to serialize {msg_type}: {e_str}. "
            f"Problematic object(s): {find_objects_by_error(payload, e_str)}"
        ) from e


def decode_message(raw: Union[str, bytes]) -> tuple[str, Any]:
    """Decode an incoming WebSocket frame. Returns ``(type_str, payload)``."""
    data = (
        msgpack.unpackb(raw, raw=False) if isinstance(raw, bytes) else json.loads(raw)
    )
    return data.get("type"), data.get("payload", {})


# endregion

# region Server


class TenSnapServer:
    """
    Pure WebSocket I/O layer.

    Assign async callables to the ``on_*`` event slots to handle incoming
    messages. Use ``send`` / ``broadcast`` (or the typed convenience wrappers)
    to push messages to clients.

    Event slot signatures:
        on_state_sync / on_param_change / on_action_start / on_asset_sync:
            async (ws: ServerConnection, payload: Any) -> None
        on_screenshot_response:
            async (payload: Any) -> None
        on_client_connect / on_client_disconnect:
            async (ws: ServerConnection) -> None
    """

    def __init__(
        self, host: str = "localhost", port: int = 8765, use_msgpack: bool = False
    ) -> None:
        self.host = host
        self.port = port
        self.use_msgpack = use_msgpack

        self.clients: Set[ServerConnection] = set()
        # Asset cache: id → {id, hash, mime, size, label, data}
        self._assets: Dict[str, Dict[str, Any]] = {}
        self._pending_screenshots: Dict[str, "asyncio.Future[Dict[str, Any]]"] = {}
        self._running = False
        self._queue = BatchedMessageQueue()
        self._bg_task: Optional[asyncio.Task] = None

        # Incoming-message event slots (single callable each for zero-overhead dispatch)
        self.on_state_sync: Optional[
            Callable[[ServerConnection, Any], Awaitable[None]]
        ] = None
        self.on_param_change: Optional[
            Callable[[ServerConnection, Any], Awaitable[None]]
        ] = None
        self.on_action_start: Optional[
            Callable[[ServerConnection, Any], Awaitable[None]]
        ] = None
        self.on_asset_sync: Optional[
            Callable[[ServerConnection, Any], Awaitable[None]]
        ] = None
        self.on_screenshot_response: Optional[Callable[[Any], Awaitable[None]]] = None
        self.on_client_connect: Optional[
            Callable[[ServerConnection], Awaitable[None]]
        ] = None
        self.on_client_disconnect: Optional[
            Callable[[ServerConnection], Awaitable[None]]
        ] = None

    # region Low-level transport

    async def send(
        self,
        ws: ServerConnection,
        msg_type: ServerToClientMessageType,
        payload: Any,
    ) -> None:
        try:
            await ws.send(encode_message(msg_type, payload, self.use_msgpack))
        except ConnectionClosed as e:
            logger.debug(f"Connection closed during send: {e}")
            self.clients.discard(ws)
        except Exception as e:
            logger.exception(f"Send error: {e}")
            self.clients.discard(ws)

    async def broadcast(
        self, msg_type: ServerToClientMessageType, payload: Any
    ) -> None:
        if self.clients:
            await self._queue.add(
                self.clients, encode_message(msg_type, payload, self.use_msgpack)
            )

    # endregion

    # region Typed outgoing helpers

    async def send_action_end(
        self,
        ws: ServerConnection,
        action_id: str,
        *,
        tick_id: Optional[str] = None,
        continue_: Optional[bool] = None,
        simulate_ms: float = 0.0,
    ) -> None:
        payload: Dict[str, Any] = {
            "id": action_id,
            "timings": {"simulate_ms": max(0.0, simulate_ms)},
        }
        if tick_id is not None:
            payload["tick_id"] = tick_id
        if continue_ is not None:
            payload["continue"] = continue_
        await self.send(ws, ServerToClientMessageType.ACTION_END, payload)

    async def send_error(self, ws: ServerConnection, error: str) -> None:
        await self.send(ws, ServerToClientMessageType.ERROR, {"error": error})

    async def broadcast_metadata_update(self, metadata: Dict[str, Any]) -> None:
        await self.broadcast(ServerToClientMessageType.METADATA_UPDATE, metadata)

    async def broadcast_param_sync(self, param_id: str, value: Any) -> None:
        await self.broadcast(
            ServerToClientMessageType.PARAM_SYNC, {"id": param_id, "value": value}
        )

    async def broadcast_log(self, level: str, message: str) -> None:
        ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
        await self.broadcast(
            ServerToClientMessageType.LOG,
            {"timestamp": ts, "level": level, "message": message},
        )

    # endregion

    # region Asset management (pure I/O state; no business logic)

    @staticmethod
    def _asset_hash(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()[:16]

    @staticmethod
    def _asset_meta_payload(asset: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": asset["id"],
            "hash": asset["hash"],
            "mime": asset["mime"],
            "size": asset["size"],
            "label": asset.get("label"),
        }

    def _encode_asset_data(self, data: bytes, mime: str) -> Union[str, bytes]:
        if self.use_msgpack:
            return data
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

    async def send_asset_meta(self, ws: ServerConnection) -> None:
        if not self._assets:
            return
        await self.send(
            ws,
            ServerToClientMessageType.ASSET_META,
            {"assets": [self._asset_meta_payload(asset) for asset in self._assets.values()]},
        )

    async def publish_asset(
        self,
        asset_id: str,
        data: bytes,
        mime: str,
        label: Optional[str] = None,
    ) -> None:
        h = self._asset_hash(data)
        existing = self._assets.get(asset_id)
        if existing and existing["hash"] == h:
            return
        self._assets[asset_id] = {
            "id": asset_id,
            "hash": h,
            "mime": mime,
            "size": len(data),
            "label": label,
            "data": data,
        }
        await self.broadcast(
            ServerToClientMessageType.ASSET_META,
            {"assets": [self._asset_meta_payload(self._assets[asset_id])]},
        )
        await self.broadcast(
            ServerToClientMessageType.ASSET_DATA,
            {
                "id": asset_id,
                "hash": h,
                "mime": mime,
                "data": self._encode_asset_data(data, mime),
            },
        )

    async def delete_asset(self, asset_id: str) -> None:
        self._assets.pop(asset_id, None)
        await self.broadcast(
            ServerToClientMessageType.ASSET_DELETE, {"ids": [asset_id]}
        )

    # endregion

    # region Screenshot (bidirectional I/O; lives here not in scenario)

    async def request_screenshot(
        self,
        env_id: Optional[str] = None,
        chart_id: Optional[str] = None,
        *,
        request_id: Optional[str] = None,
        format: str = "png",
        quality: Optional[float] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Request a rendered screenshot from a connected renderer."""
        if (env_id is None) == (chart_id is None):
            raise ValueError("Exactly one of env_id or chart_id must be specified.")
        if format not in {"png", "jpeg"}:
            raise ValueError("format must be 'png' or 'jpeg'.")
        if quality is not None and not 0.0 <= quality <= 1.0:
            raise ValueError("quality must be between 0 and 1.")
        if not self.clients:
            raise RuntimeError("No connected renderer.")

        rid = request_id or uuid4().hex
        if rid in self._pending_screenshots:
            raise ValueError(f"Screenshot request '{rid}' already pending.")

        payload: Dict[str, Any] = {"request_id": rid}
        if env_id is not None:
            payload["env_id"] = env_id
        if chart_id is not None:
            payload["chart_id"] = chart_id
        if format != "png":
            payload["format"] = format
        if quality is not None:
            payload["quality"] = quality

        future: asyncio.Future[Dict[str, Any]] = (
            asyncio.get_running_loop().create_future()
        )
        self._pending_screenshots[rid] = future
        try:
            for client in list(self.clients):
                await self.send(
                    client, ServerToClientMessageType.SCREENSHOT_REQUEST, payload
                )
            return await (
                asyncio.wait_for(future, timeout) if timeout is not None else future
            )
        finally:
            self._pending_screenshots.pop(rid, None)

    # endregion

    # region Incoming message dispatch

    async def handle_client(self, ws: ServerConnection) -> None:
        self.clients.add(ws)
        logger.info(f"Client connected: {ws.remote_address}")
        await self.send_asset_meta(ws)
        if self.on_client_connect:
            await self.on_client_connect(ws)
        try:
            async for raw in ws:
                try:
                    await self._dispatch(ws, raw)
                except Exception as e:
                    logger.exception(f"Message handling error: {e}")
        except ConnectionClosed:
            pass
        except Exception as e:
            logger.exception(f"Connection error: {e}")
        finally:
            self.clients.discard(ws)
            logger.info(f"Client disconnected: {ws.remote_address}")
            if self.on_client_disconnect:
                await self.on_client_disconnect(ws)

    async def _dispatch(self, ws: ServerConnection, raw: Union[str, bytes]) -> None:
        try:
            msg_type, payload = decode_message(raw)
            if msg_type == ClientToServerMessageType.STATE_SYNC.value:
                if self.on_state_sync:
                    await self.on_state_sync(ws, payload)
            elif msg_type == ClientToServerMessageType.PARAM_CHANGE.value:
                if self.on_param_change:
                    await self.on_param_change(ws, payload)
            elif msg_type == ClientToServerMessageType.ACTION_START.value:
                if self.on_action_start:
                    await self.on_action_start(ws, payload)
            elif msg_type == ClientToServerMessageType.ASSET_SYNC.value:
                await self._handle_asset_sync(ws, payload)
            elif msg_type == ClientToServerMessageType.SCREENSHOT_RESPONSE.value:
                await self._handle_screenshot_response(payload)
            elif msg_type == ClientToServerMessageType.ERROR.value:
                logger.error(f"Client error: {payload.get('error')}")
            else:
                logger.warning(f"Unknown message type: {msg_type}")
        except Exception as e:
            logger.exception(f"Dispatch error: {e}")
            try:
                await self.send_error(ws, str(e))
            except Exception:
                pass

    async def _handle_asset_sync(
        self, ws: ServerConnection, payload: Dict[str, Any]
    ) -> None:
        client_hashes: Dict[str, str] = payload.get("assets", {})
        for asset_id, asset in self._assets.items():
            if client_hashes.get(asset_id) != asset["hash"]:
                await self.send(
                    ws,
                    ServerToClientMessageType.ASSET_DATA,
                    {
                        "id": asset_id,
                        "hash": asset["hash"],
                        "mime": asset["mime"],
                        "data": self._encode_asset_data(asset["data"], asset["mime"]),
                    },
                )

    async def _handle_screenshot_response(self, payload: Dict[str, Any]) -> None:
        rid = payload.get("request_id")
        if not rid:
            logger.warning("screenshot_response missing request_id")
            return
        future = self._pending_screenshots.get(rid)
        if future is None:
            logger.warning(f"Unknown screenshot request_id: {rid}")
            return
        if not future.done():
            future.set_result(deepcopy(payload))

    # endregion

    # region Lifecycle

    async def _background_maintenance(self) -> None:
        while self._running:
            try:
                await self._queue.flush()
                self.clients = {
                    c for c in self.clients if c.state == WebSocketState.OPEN
                }
                await asyncio.sleep(0.1)
            except Exception as e:
                logger.error(f"Background maintenance error: {e}")

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

    # endregion


# endregion
