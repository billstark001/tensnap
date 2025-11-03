"""
TenSnap WebSocket Server

Main server implementation for handling WebSocket connections and
broadcasting simulation updates to connected clients.
"""

from typing import Any, Dict, List, TYPE_CHECKING, Callable, Union, Optional
import types
import inspect
import asyncio
import json
import logging
from websockets.server import WebSocketServerProtocol, serve
from websockets.exceptions import ConnectionClosed
import msgpack
from enum import Enum
from collections import defaultdict

from .bindings.basic import Parameter, Chart, button

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .models import EnvironmentModel, StateSyncRequest, StateSyncResponse


class ServerToClientMessageType(Enum):
    """WebSocket message types"""

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
    """ClientToServerMessageType message types"""

    STATE_SYNC = "state_sync"
    PARAMETER_CHANGE = "parameter_change"
    BUTTON_CLICK = "button_click"
    ERROR = "error"


class MessageEncoder:
    """Optimized message encoder with caching and pre-serialization"""

    def __init__(self, use_msgpack: bool = False):
        self.use_msgpack = use_msgpack
        self._type_cache = {}

    def encode_message(
        self, msg_type: ServerToClientMessageType, payload: Any
    ) -> str | bytes:
        """Encode message with caching for repeated payloads"""
        type_str = self._get_cached_type(msg_type)

        # For simple payloads, cache the entire message
        ret = {"type": type_str, "payload": payload}

        if isinstance(payload, (str, int, float, bool)) or payload is None:
            cache_key = (msg_type, payload)
            if cache_key not in self._type_cache:
                self._type_cache[cache_key] = (
                    msgpack.packb(ret, use_bin_type=True)
                    if self.use_msgpack
                    else json.dumps(ret, separators=(",", ":"))
                )
            return self._type_cache[cache_key]

        # For complex payloads, serialize normally but cache type

        return (
            msgpack.packb(ret, use_bin_type=True)
            if self.use_msgpack
            else json.dumps(ret, separators=(",", ":"))
        )  # type: ignore

    def _get_cached_type(self, msg_type: ServerToClientMessageType) -> str:
        """Cache message type strings"""
        if msg_type not in self._type_cache:
            self._type_cache[msg_type] = msg_type.value
        return self._type_cache[msg_type]


class BatchedMessageQueue:
    """Queue for batching and optimizing message delivery"""

    def __init__(self, batch_size: int = 50, flush_interval: float = 0.01):
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self._queue = []
        self._last_flush = 0
        self._task = None

    async def add_message(self, clients: set, message: str | bytes) -> None:
        """Add message to batch queue"""
        self._queue.append((clients.copy(), message))

        current_time = asyncio.get_event_loop().time()

        # Flush if batch is full or interval exceeded
        if (
            len(self._queue) >= self.batch_size
            or current_time - self._last_flush >= self.flush_interval
        ):
            await self._flush()

    async def _flush(self) -> None:
        """Flush queued messages"""
        if not self._queue:
            return

        # Group messages by client to reduce redundant sends
        client_messages = defaultdict(list)

        for clients, message in self._queue:
            for client in clients:
                client_messages[client].append(message)

        # Send batched messages
        tasks = []
        for client, messages in client_messages.items():
            if len(messages) == 1:
                tasks.append(self._safe_send(client, messages[0]))
            else:
                # For multiple messages to same client, could batch them
                for message in messages:
                    tasks.append(self._safe_send(client, message))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        self._queue.clear()
        self._last_flush = asyncio.get_event_loop().time()

    async def _safe_send(self, client: WebSocketServerProtocol, message: str) -> None:
        """Safely send message to client"""
        try:
            await client.send(message)
        except Exception:
            # Client disconnected or other error, ignore silently
            pass


def convert_parameter_state(param: "Parameter") -> Dict[str, Any]:
    return {
        "id": param.id,
        "type": param.type,
        "label": param.label,
        "value": param.value,
        "min": param.min,
        "max": param.max,
        "step": param.step,
        "options": param.options,
        "allow_runtime_change": param.allow_runtime_change,
    }


def convert_environment_state(env: "EnvironmentModel") -> Dict[str, Any]:
    """Convert environment to state dict"""
    # For environments, we typically don't cache since they change frequently
    env_dict = env.get_model_dict()
    agent_list = env.get_agent_list(is_update=False)
    env_dict["agents"] = agent_list
    return env_dict


def convert_chart_state(chart: "Chart") -> Dict[str, Any]:
    """Convert chart to state dict with caching"""
    # Use the chart object itself as the key instead of its ID
    return {
        "id": chart.id,
        "label": chart.label,
        "color": chart.color,
    }


class TenSnapServer:
    """Main server class for TenSnap visualization"""

    def __init__(self, host: str = "localhost", port: int = 8765, use_msgpack: bool = False):
        self.host = host
        self.port = port
        self.clients: set[WebSocketServerProtocol] = set()
        self.environments: Dict[Union[str, int], "EnvironmentModel"] = {}
        self.parameters: Dict[str, "Parameter"] = {}
        self.charts: Dict[str, "Chart"] = {}
        self.button_handlers: Dict[str, Callable] = {}
        self.parameter_setters: Dict[str, Callable] = {}
        self.parameter_getters: Dict[str, Callable] = {}
        self.chart_getters: Dict[str, Callable] = {}
        self._running = False

        # Performance optimization components
        self._encoder = MessageEncoder(use_msgpack=use_msgpack)
        self._message_queue = BatchedMessageQueue()

        # Background task for periodic operations
        self._background_task = None

    def add_environment(self, environment: "EnvironmentModel") -> None:
        """Add an environment to the server"""
        self.environments[environment.id] = environment

    def add_parameter(self, param: "Parameter") -> None:
        """Add a parameter to the server"""
        self.parameters[param.id] = param
        if param.setter:
            self.parameter_setters[param.id] = param.setter
        if param.getter:
            self.parameter_getters[param.id] = param.getter

    def add_chart(self, chart: "Chart") -> None:
        """Add a chart to the server"""
        self.charts[chart.id] = chart
        if chart.getter:
            self.chart_getters[chart.id] = chart.getter

    def register_button(
        self,
        action: str,
        handler: Callable,
        register_parameter: bool = True,
        suggested_label: Optional[str] = None,
        suggested_allow_runtime_change: bool = True,
    ) -> None:
        """Register a button action handler"""
        if not hasattr(handler, "_tensnap_parameter"):
            handler = button(
                action,
                label=suggested_label,
                allow_runtime_change=suggested_allow_runtime_change,
            )(handler)
        if register_parameter:
            self.add_parameter(handler._tensnap_parameter)
        self.button_handlers[action] = handler

    async def handle_client(
        self, websocket: WebSocketServerProtocol, path: str
    ) -> None:
        """Handle a client connection"""
        self.clients.add(websocket)
        logger.info(f"Client connected from {websocket.remote_address}")
        try:
            async for message in websocket:
                # Process message in background to avoid blocking
                asyncio.create_task(self.handle_message(websocket, message))
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)  # Use discard instead of remove
            logger.info(f"Client disconnected from {websocket.remote_address}")

    async def handle_message(
        self, websocket: WebSocketServerProtocol, message: Union[str, bytes]
    ) -> None:
        """Handle incoming message from client"""
        try:
            if isinstance(message, bytes):
                data = msgpack.unpackb(message, raw=False)
            else:
                data = json.loads(message)

            msg_type = data.get("type")
            payload = data.get("payload", {})

            if msg_type == ClientToServerMessageType.STATE_SYNC.value:
                await self.handle_state_sync(websocket, payload)
            elif msg_type == ClientToServerMessageType.PARAMETER_CHANGE.value:
                await self.handle_parameter_change(payload)
            elif msg_type == ClientToServerMessageType.BUTTON_CLICK.value:
                await self.handle_button_click(payload)
            elif msg_type == ClientToServerMessageType.ERROR.value:
                logger.error(f"Client error: {payload.get('error')}")
            else:
                logger.warning(f"Unknown message type: {msg_type}")

        except Exception as e:
            logger.error(f"Error handling message: {e}")
            await self.send_error(websocket, str(e))

    async def _build_state_sync_response(self, client_request: "StateSyncRequest"):
        parameter_task = asyncio.create_task(
            self._compute_parameter_deltas_async(client_request)
        )
        environment_task = asyncio.create_task(
            self._compute_environment_deltas_async(client_request)
        )
        chart_task = asyncio.create_task(
            self._compute_chart_deltas_async(client_request)
        )

        parameter_deltas, environment_deltas, chart_deltas = await asyncio.gather(
            parameter_task, environment_task, chart_task
        )

        # Build response
        from .models import StateSyncResponse

        response = StateSyncResponse(
            mode="incremental",
            added_parameters=parameter_deltas["added"],
            removed_parameters=parameter_deltas["removed"],
            updated_parameters=parameter_deltas["updated"],
            added_environments=environment_deltas["added"],
            removed_environments=environment_deltas["removed"],
            updated_environments=environment_deltas["updated"],
            added_charts=chart_deltas["added"],
            removed_charts=chart_deltas["removed"],
            updated_charts=chart_deltas["updated"],
        )

        return response

    async def send_state_sync(self):
        """Send state sync to all connected clients"""
        if not self.clients:
            return

        # Build a generic client request with empty lists
        client_request: "StateSyncRequest" = {
            "parameters": [],
            "environments": [],
            "charts": [],
        }

        response = await self._build_state_sync_response(client_request)

        await self.broadcast(ServerToClientMessageType.STATE_SYNC, response)

    async def handle_state_sync(
        self, websocket: WebSocketServerProtocol, client_request: "StateSyncRequest"
    ) -> None:
        """Handle unified state sync request and send response"""
        response = await self._build_state_sync_response(client_request)

        await self.send_to_client(
            websocket, ServerToClientMessageType.STATE_SYNC, response
        )

    async def _compute_parameter_deltas_async(
        self, client_request: "StateSyncRequest"
    ) -> Dict[str, List]:
        """Async version of parameter delta computation"""
        return await asyncio.get_event_loop().run_in_executor(
            None, self._compute_parameter_deltas, client_request
        )

    async def _compute_environment_deltas_async(
        self, client_request: "StateSyncRequest"
    ) -> Dict[str, List]:
        """Async version of environment delta computation"""
        return await asyncio.get_event_loop().run_in_executor(
            None, self._compute_environment_deltas, client_request
        )

    async def _compute_chart_deltas_async(
        self, client_request: "StateSyncRequest"
    ) -> Dict[str, List]:
        """Async version of chart delta computation"""
        return await asyncio.get_event_loop().run_in_executor(
            None, self._compute_chart_deltas, client_request
        )

    def _compute_parameter_deltas(
        self, client_request: "StateSyncRequest"
    ) -> Dict[str, List]:
        """Compute parameter deltas between client and server state"""
        client_parameter_ids = set(
            x["id"] for x in client_request.get("parameters", [])
        )
        server_parameter_ids = set(self.parameters.keys())
        parameter_cache = client_request.get("parameter_cache", {})

        added_ids = server_parameter_ids - client_parameter_ids
        removed_ids = client_parameter_ids - server_parameter_ids
        common_ids = server_parameter_ids & client_parameter_ids
        updated_ids = set()

        # Update parameter values and check for changes
        for param_id in common_ids:
            param = self.parameters[param_id]
            current_value = self._get_parameter_value(param)

            # Apply cached value if available
            cached_value = parameter_cache.get(param_id)
            if cached_value is not None and param.setter:
                self._set_parameter_value(param, cached_value)
                current_value = cached_value

            # Check if value changed
            if current_value != param.value:
                updated_ids.add(param_id)
                param.value = current_value

        return {
            "added": [
                convert_parameter_state(self.parameters[pid]) for pid in added_ids
            ],
            "removed": list(removed_ids),
            "updated": [
                convert_parameter_state(self.parameters[pid]) for pid in updated_ids
            ],
        }

    def _compute_environment_deltas(
        self, client_request: "StateSyncRequest"
    ) -> Dict[str, List]:
        """Compute environment deltas between client and server state"""
        client_environment_ids = set(
            x["id"] for x in client_request.get("environments", [])
        )
        server_environment_ids = set(self.environments.keys())

        added_ids = server_environment_ids - client_environment_ids
        removed_ids = client_environment_ids - server_environment_ids
        updated_ids = server_environment_ids & client_environment_ids

        return {
            "added": [
                convert_environment_state(self.environments[eid]) for eid in added_ids
            ],
            "removed": list(removed_ids),
            "updated": [
                convert_environment_state(self.environments[eid]) for eid in updated_ids
            ],
        }

    def _compute_chart_deltas(
        self, client_request: "StateSyncRequest"
    ) -> Dict[str, List]:
        """Compute chart deltas between client and server state"""
        client_chart_ids = set(x["id"] for x in client_request.get("charts", []))
        server_chart_ids = set(self.charts.keys())

        added_ids = server_chart_ids - client_chart_ids
        removed_ids = client_chart_ids - server_chart_ids
        updated_ids = server_chart_ids & client_chart_ids

        return {
            "added": [convert_chart_state(self.charts[cid]) for cid in added_ids],
            "removed": list(removed_ids),
            "updated": [convert_chart_state(self.charts[cid]) for cid in updated_ids],
        }

    def _get_parameter_value(self, param: "Parameter") -> Any:
        """Get current parameter value, using getter if available"""
        if param.getter:
            try:
                return param.getter()
            except Exception as e:
                logger.error(f"Error getting parameter {param.id}: {e}")
        return param.value

    def _set_parameter_value(self, param: "Parameter", value: Any) -> None:
        """Set parameter value, using setter if available"""
        if param.setter:
            try:
                param.setter(value)
                param.value = value
            except Exception as e:
                logger.error(f"Error setting parameter {param.id}: {e}")

    async def handle_parameter_change(self, payload: Dict[str, Any]) -> None:
        """Handle parameter change from client"""
        param_id = payload.get("id")
        value = payload.get("value")

        if param_id in self.parameter_setters:
            try:
                # Run setter in executor to avoid blocking
                await asyncio.get_event_loop().run_in_executor(
                    None, self.parameter_setters[param_id], value
                )
                if param_id in self.parameters:
                    self.parameters[param_id].value = value
            except Exception as e:
                logger.error(f"Error setting parameter {param_id}: {e}")

    async def handle_button_click(self, payload: Dict[str, Any]) -> None:
        """Handle button click from client"""
        action = payload.get("action")
        if action in self.button_handlers:
            try:
                handler = self.button_handlers[action]
                if asyncio.iscoroutinefunction(handler):
                    await handler()
                else:
                    # Run sync handler in executor
                    await asyncio.get_event_loop().run_in_executor(None, handler)
            except Exception as e:
                logger.error(f"Error handling button {action}: {e}")

    async def broadcast(
        self, msg_type: ServerToClientMessageType, payload: Any
    ) -> None:
        """Broadcast message to all connected clients using optimized queue"""
        if not self.clients:
            return

        message = self._encoder.encode_message(msg_type, payload)
        await self._message_queue.add_message(self.clients, message)

    async def send_to_client(
        self,
        websocket: WebSocketServerProtocol,
        msg_type: ServerToClientMessageType,
        payload: Any,
    ) -> None:
        """Send message to specific client"""
        message = self._encoder.encode_message(msg_type, payload)
        try:
            await websocket.send(message)
        except Exception:
            # Client disconnected, remove from clients set
            self.clients.discard(websocket)

    async def send_error(self, websocket: WebSocketServerProtocol, error: str) -> None:
        """Send error message to client"""
        await self.send_to_client(
            websocket, ServerToClientMessageType.ERROR, {"error": error}
        )

    async def start_time_step(self, time: int) -> None:
        """Start a new time step"""
        await self.broadcast(ServerToClientMessageType.TIME_STEP_START, {"time": time})

    async def end_time_step(self, time: Optional[int] = None) -> None:
        """End current time step with optimized chart data collection"""

        # Collect chart data in parallel
        if self.charts:
            chart_tasks = []
            for chart in self.charts.values():
                if chart.getter:
                    chart_tasks.append(self._get_chart_update_async(chart, time))

            if chart_tasks:
                chart_results = await asyncio.gather(
                    *chart_tasks, return_exceptions=True
                )
                chart_update_array = [
                    result
                    for result in chart_results
                    if not isinstance(result, Exception)
                ]

                chart_update = {"updates": chart_update_array}

                if chart_update_array:
                    await self.broadcast(
                        ServerToClientMessageType.CHART_UPDATE, chart_update
                    )

        payload = {}
        if time is not None:
            payload["time"] = time
        await self.broadcast(ServerToClientMessageType.TIME_STEP_END, payload)

    async def _get_chart_update_async(
        self, chart: "Chart", time: int | None
    ) -> Dict[str, Any]:
        """Get chart data asynchronously"""
        try:
            value = await asyncio.get_event_loop().run_in_executor(None, chart.getter)
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
        """Update environment data"""
        await self.broadcast(
            ServerToClientMessageType.ENVIRONMENT_UPDATE, {"id": env_id, "data": data}
        )

    async def update_agent(
        self, env_id: Union[str, int], agent_id: Union[str, int], data: Dict[str, Any]
    ) -> None:
        """Update single agent"""
        await self.broadcast(
            ServerToClientMessageType.AGENT_UPDATE,
            {"environment_id": env_id, "agent_id": agent_id, "data": data},
        )

    async def update_agents_batch(
        self, env_id: Union[str, int], updates: List[Dict[str, Any]]
    ) -> None:
        """Update multiple agents at once"""
        await self.broadcast(
            ServerToClientMessageType.AGENT_BATCH_UPDATE,
            {"environment_id": env_id, "updates": updates},
        )

    async def _background_maintenance(self) -> None:
        """Background task for periodic maintenance"""
        while self._running:
            try:
                # Flush any pending messages
                await self._message_queue._flush()

                # Clean up disconnected clients
                active_clients = set()
                for client in self.clients.copy():
                    if not client.closed:
                        active_clients.add(client)
                self.clients = active_clients

                # Sleep efficiently - use event-driven approach instead of polling
                await asyncio.sleep(0.1)

            except Exception as e:
                logger.error(f"Error in background maintenance: {e}")

    async def run(self) -> None:
        """Run the WebSocket server with optimized event loop"""
        self._running = True
        logger.info(f"Starting TenSnap server on {self.host}:{self.port}")

        # Start background maintenance task
        self._background_task = asyncio.create_task(self._background_maintenance())

        try:
            async with serve(self.handle_client, self.host, self.port):
                # Use event-driven waiting instead of polling
                stop_event = asyncio.Event()

                def stop_handler():
                    stop_event.set()

                # In a real implementation, you'd hook this to signal handlers
                # For now, we'll use the existing pattern but more efficiently
                await stop_event.wait()

        finally:
            self._running = False
            if self._background_task:
                self._background_task.cancel()
                try:
                    await self._background_task
                except asyncio.CancelledError:
                    pass

    def stop(self) -> None:
        """Stop the server"""
        self._running = False

    # ... rest of the methods remain the same for auto-registration ...
    def auto_register_from_namespace(self, namespace: Dict[str, Any]) -> None:
        """Automatically register parameters, charts, and buttons from a namespace"""
        for name, obj in namespace.items():
            if hasattr(obj, "_tensnap_parameter"):
                param: "Parameter" = obj._tensnap_parameter
                self.add_parameter(param)
                if param.type == "button":
                    self.register_button(param.id, obj, False)
            elif hasattr(obj, "_tensnap_chart"):
                chart = obj._tensnap_chart
                self.add_chart(chart)
            elif hasattr(obj, "param"):
                param = obj.param
                self.add_parameter(param)

    def auto_register_from_module(self, module: types.ModuleType) -> None:
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
