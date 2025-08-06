from typing import Any, Dict, List, TYPE_CHECKING, Callable, Union

import asyncio
import json
import logging
import websockets
from websockets.server import WebSocketServerProtocol
import msgpack
import numpy as np
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)


if TYPE_CHECKING:
    from .models import Parameter, Chart, Environment



class MessageType(Enum):
    """WebSocket message types"""
    TIME_STEP_START = "time_step_start"
    TIME_STEP_END = "time_step_end"
    ENVIRONMENT_UPDATE = "environment_update"
    AGENT_UPDATE = "agent_update"
    AGENT_BATCH_UPDATE = "agent_batch_update"
    PARAMETERS = "parameters"
    ENVIRONMENTS_LIST = "environments_list"
    CHART_DATA = "chart_data"
    GET_STATE = "get_state"
    PARAMETER_CHANGE = "parameter_change"
    BUTTON_CLICK = "button_click"
    ERROR = "error"


class TenSnapServer:
    """Main server class for TenSnap visualization"""
    
    def __init__(self, host: str = "localhost", port: int = 8765):
        self.host = host
        self.port = port
        self.clients: set[WebSocketServerProtocol] = set()
        self.current_time: int = 0
        self.environments: Dict[Union[str, int], 'Environment'] = {}
        self.parameters: Dict[str, 'Parameter'] = {}
        self.charts: Dict[str, 'Chart'] = {}
        self.button_handlers: Dict[str, Callable] = {}
        self.parameter_setters: Dict[str, Callable] = {}
        self.parameter_getters: Dict[str, Callable] = {}
        self.chart_getters: Dict[str, Callable] = {}
        self._running = False
        
    def add_environment(self, environment: 'Environment') -> None:
        """Add an environment to the server"""
        self.environments[environment.id] = environment
        
    def add_parameter(self, param: 'Parameter') -> None:
        """Add a parameter to the server"""
        self.parameters[param.id] = param
        if param.setter:
            self.parameter_setters[param.id] = param.setter
        if param.getter:
            self.parameter_getters[param.id] = param.getter
            
    def add_chart(self, chart: 'Chart') -> None:
        """Add a chart to the server"""
        self.charts[chart.id] = chart
        if chart.getter:
            self.chart_getters[chart.id] = chart.getter
            
    def register_button(self, action: str, handler: Callable) -> None:
        """Register a button action handler"""
        self.button_handlers[action] = handler
        
    async def handle_client(self, websocket: WebSocketServerProtocol, path: str) -> None:
        """Handle a client connection"""
        self.clients.add(websocket)
        logger.info(f"Client connected from {websocket.remote_address}")
        
        try:
            async for message in websocket:
                await self.handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.remove(websocket)
            logger.info(f"Client disconnected from {websocket.remote_address}")
            
    async def handle_message(self, websocket: WebSocketServerProtocol, message: Union[str, bytes]) -> None:
        """Handle incoming message from client"""
        try:
            if isinstance(message, bytes):
                data = msgpack.unpackb(message, raw=False)
            else:
                data = json.loads(message)
                
            msg_type = data.get("type")
            payload = data.get("payload", {})
            
            if msg_type == MessageType.GET_STATE.value:
                await self.send_state(websocket)
            elif msg_type == MessageType.PARAMETER_CHANGE.value:
                await self.handle_parameter_change(payload)
            elif msg_type == MessageType.BUTTON_CLICK.value:
                await self.handle_button_click(payload)
            else:
                logger.warning(f"Unknown message type: {msg_type}")
                
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            await self.send_error(websocket, str(e))
            
    async def send_state(self, websocket: WebSocketServerProtocol) -> None:
        """Send current state to a client"""
        # Send parameters
        params_data = []
        for param in self.parameters.values():
            param_dict = {
                "id": param.id,
                "type": param.type,
                "label": param.label,
                "value": param.value,
            }
            if param.type == "slider":
                param_dict.update({
                    "min": param.min,
                    "max": param.max,
                    "step": param.step,
                })
            elif param.type == "enum":
                param_dict["options"] = param.options
                
            params_data.append(param_dict)
            
        await self.send_to_client(websocket, MessageType.PARAMETERS, params_data)
        
        # Send environments
        envs_data = []
        for env in self.environments.values():
            envs_data.append(env.to_dict())
            
        await self.send_to_client(websocket, MessageType.ENVIRONMENTS_LIST, envs_data)
        
    async def handle_parameter_change(self, payload: Dict[str, Any]) -> None:
        """Handle parameter change from client"""
        param_id = payload.get("id")
        value = payload.get("value")
        
        if param_id in self.parameter_setters:
            try:
                self.parameter_setters[param_id](value)
                if param_id in self.parameters:
                    self.parameters[param_id].value = value
            except Exception as e:
                logger.error(f"Error setting parameter {param_id}: {e}")
                
    async def handle_button_click(self, payload: Dict[str, Any]) -> None:
        """Handle button click from client"""
        action = payload.get("action")
        
        if action in self.button_handlers:
            try:
                self.button_handlers[action]()
            except Exception as e:
                logger.error(f"Error handling button {action}: {e}")
                
    async def broadcast(self, msg_type: MessageType, payload: Any) -> None:
        """Broadcast message to all connected clients"""
        message = json.dumps({
            "type": msg_type.value,
            "payload": payload,
            "timestamp": self.current_time
        })
        
        if self.clients:
            await asyncio.gather(
                *[client.send(message) for client in self.clients],
                return_exceptions=True
            )
            
    async def send_to_client(self, websocket: WebSocketServerProtocol, msg_type: MessageType, payload: Any) -> None:
        """Send message to specific client"""
        message = json.dumps({
            "type": msg_type.value,
            "payload": payload,
            "timestamp": self.current_time
        })
        
        await websocket.send(message)
        
    async def send_error(self, websocket: WebSocketServerProtocol, error: str) -> None:
        """Send error message to client"""
        await self.send_to_client(websocket, MessageType.ERROR, {"error": error})
        
    async def start_time_step(self, time: int) -> None:
        """Start a new time step"""
        self.current_time = time
        await self.broadcast(MessageType.TIME_STEP_START, {"time": time})
        
    async def end_time_step(self) -> None:
        """End current time step"""
        await self.broadcast(MessageType.TIME_STEP_END, {"time": self.current_time})
        
    async def update_environment(self, env_id: Union[str, int], data: Dict[str, Any]) -> None:
        """Update environment data"""
        await self.broadcast(MessageType.ENVIRONMENT_UPDATE, {
            "id": env_id,
            "data": data
        })
        
    async def update_agent(self, env_id: Union[str, int], agent_id: Union[str, int], data: Dict[str, Any]) -> None:
        """Update single agent"""
        await self.broadcast(MessageType.AGENT_UPDATE, {
            "environment_id": env_id,
            "agent_id": agent_id,
            "data": data
        })
        
    async def update_agents_batch(self, env_id: Union[str, int], updates: List[Dict[str, Any]]) -> None:
        """Update multiple agents at once"""
        await self.broadcast(MessageType.AGENT_BATCH_UPDATE, {
            "environment_id": env_id,
            "updates": updates
        })
        
    async def run(self) -> None:
        """Run the WebSocket server"""
        self._running = True
        logger.info(f"Starting TenSnap server on {self.host}:{self.port}")
        
        async with websockets.serve(self.handle_client, self.host, self.port):
            while self._running:
                await asyncio.sleep(0.1)
                
    def stop(self) -> None:
        """Stop the server"""
        self._running = False
