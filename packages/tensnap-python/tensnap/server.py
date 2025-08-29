from typing import Any, Dict, List, TYPE_CHECKING, Callable, Union, Optional
import types
import inspect

import asyncio
import json
import logging
import websockets
from websockets.server import WebSocketServerProtocol, serve
from websockets.exceptions import ConnectionClosed
import msgpack
import numpy as np
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)


if TYPE_CHECKING:
    from .models import Parameter, Chart, Environment, ClientStateRequest, StateSyncResponse
    from .decorators import ParameterProperty, ChartProperty



class MessageType(Enum):
    """WebSocket message types"""
    TIME_STEP_START = "time_step_start"
    TIME_STEP_END = "time_step_end"
    ENVIRONMENT_UPDATE = "environment_update"
    AGENT_UPDATE = "agent_update"
    AGENT_BATCH_UPDATE = "agent_batch_update"
    CHART_DATA = "chart_data"
    STATE_SYNC = "state_sync"  # 合并后的状态同步消息
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
        except ConnectionClosed:
            pass
        finally:
            self.clients.remove(websocket)
            logger.info(f"Client disconnected from {websocket.remote_address}")
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
            
            if msg_type == MessageType.STATE_SYNC.value:
                await self.handle_state_sync(websocket, payload)
            elif msg_type == MessageType.PARAMETER_CHANGE.value:
                await self.handle_parameter_change(payload)
            elif msg_type == MessageType.BUTTON_CLICK.value:
                await self.handle_button_click(payload)
            else:
                logger.warning(f"Unknown message type: {msg_type}")
                
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            await self.send_error(websocket, str(e))
            
    async def handle_state_sync(self, websocket: WebSocketServerProtocol, client_request: 'ClientStateRequest') -> None:
        """Handle unified state sync request and send response"""
        from .models import StateSyncResponse, ParameterState, EnvironmentState, ChartState
        
        # 计算参数的增量
        client_parameter_ids = set(client_request.get('parameters', []))
        server_parameter_ids = set(self.parameters.keys())
        
        added_parameter_ids = server_parameter_ids - client_parameter_ids
        removed_parameter_ids = client_parameter_ids - server_parameter_ids
        
        # 检查更新的参数（服务器端有，客户端也有的参数）
        common_parameter_ids = server_parameter_ids & client_parameter_ids
        updated_parameter_ids = set()
        
        parameter_cache = client_request.get('parameter_cache', {})
        for param_id in common_parameter_ids:
            param = self.parameters[param_id]
            # 获取当前参数值
            current_value = param.value
            if param.getter:
                try:
                    current_value = param.getter()
                except Exception as e:
                    logger.error(f"Error getting parameter {param_id}: {e}")
            
            # 检查是否接受客户端缓存的值
            cached_value = parameter_cache.get(param_id)
            if cached_value is not None and param.setter:
                try:
                    param.setter(cached_value)
                    param.value = cached_value
                    current_value = cached_value
                except Exception as e:
                    logger.error(f"Error setting cached parameter {param_id}: {e}")
            
            # 如果值发生变化，标记为需要更新
            if current_value != param.value:
                updated_parameter_ids.add(param_id)
                param.value = current_value
        
        # 构建参数状态
        def build_parameter_state(param: 'Parameter') -> ParameterState:
            return ParameterState(
                id=param.id,
                type=param.type,
                label=param.label,
                value=param.value,
                min=param.min,
                max=param.max,
                step=param.step,
                options=param.options,
                allow_runtime_change=param.allow_runtime_change,
                last_cached_value=parameter_cache.get(param.id)
            )
        
        # 构建环境状态
        def build_environment_state(env: 'Environment') -> EnvironmentState:
            env_dict = env.to_dict()
            return EnvironmentState(
                id=env_dict['id'],
                type=env_dict['type'],
                width=env_dict.get('width'),
                height=env_dict.get('height'),
                agents=env_dict.get('agents', []),
                nodes=env_dict.get('nodes'),
                edges=env_dict.get('edges'),
                background=env_dict.get('background')
            )
        
        # 构建图表状态
        def build_chart_state(chart: 'Chart') -> ChartState:
            return ChartState(
                id=chart.id,
                label=chart.label,
                color=chart.color,
                data=chart.data
            )
        
        # 计算环境的增量
        client_environment_ids = set(client_request.get('environments', []))
        server_environment_ids = set(self.environments.keys())
        
        added_environment_ids = server_environment_ids - client_environment_ids
        removed_environment_ids = client_environment_ids - server_environment_ids
        
        # 检查环境更新逻辑 - 简单起见，假设所有已存在的环境都可能更新
        common_environment_ids = server_environment_ids & client_environment_ids
        updated_environment_ids = common_environment_ids  # 可以优化为只更新实际变化的环境
        
        # 计算图表的增量
        client_chart_ids = set(client_request.get('charts', []))
        server_chart_ids = set(self.charts.keys())
        
        added_chart_ids = server_chart_ids - client_chart_ids
        removed_chart_ids = client_chart_ids - server_chart_ids
        
        # 检查图表更新逻辑 - 简单起见，假设所有已存在的图表都可能更新
        common_chart_ids = server_chart_ids & client_chart_ids
        updated_chart_ids = common_chart_ids  # 可以优化为只更新实际变化的图表
        
        # 构建统一的状态同步响应
        response: StateSyncResponse = StateSyncResponse(
            added_parameters=[build_parameter_state(self.parameters[pid]) for pid in added_parameter_ids],
            removed_parameters=list(removed_parameter_ids),
            updated_parameters=[build_parameter_state(self.parameters[pid]) for pid in updated_parameter_ids],
            added_environments=[build_environment_state(self.environments[eid]) for eid in added_environment_ids],
            removed_environments=list(removed_environment_ids),
            updated_environments=[build_environment_state(self.environments[eid]) for eid in updated_environment_ids],
            added_charts=[build_chart_state(self.charts[cid]) for cid in added_chart_ids],
            removed_charts=list(removed_chart_ids),
            updated_charts=[build_chart_state(self.charts[cid]) for cid in updated_chart_ids]
        )
        
        await self.send_to_client(websocket, MessageType.STATE_SYNC, response)
        
    async def send_state(self, websocket: WebSocketServerProtocol) -> None:
        """Send current state to a client (deprecated, kept for compatibility)"""
        # 发送空的客户端请求来触发完整状态同步
        empty_request: 'ClientStateRequest' = {
            'parameters': [],
            'environments': [],
            'charts': [],
            'parameter_cache': {}
        }
        await self.handle_state_sync(websocket, empty_request)
        
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
        """End current time step and update charts"""
        # Update all charts
        chart_data = []
        for chart in self.charts.values():
            if chart.getter:
                try:
                    value = chart.getter()
                    chart_data.append({
                        "id": chart.id,
                        "time": self.current_time,
                        "value": value
                    })
                except Exception as e:
                    logger.error(f"Error getting chart data for {chart.id}: {e}")
        
        # Send chart data if any
        if chart_data:
            await self.broadcast(MessageType.CHART_DATA, chart_data)
            
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
        
        async with serve(self.handle_client, self.host, self.port):
            while self._running:
                await asyncio.sleep(0.1)
                
    def stop(self) -> None:
        """Stop the server"""
        self._running = False
        
    def auto_register_from_namespace(self, namespace: Dict[str, Any]) -> None:
        """Automatically register parameters, charts, and buttons from a namespace"""
        for name, obj in namespace.items():
            if hasattr(obj, '_tensnap_parameter'):
                # Handle decorated parameter functions
                param = obj._tensnap_parameter
                self.add_parameter(param)
                if hasattr(obj, '_tensnap_button_action'):
                    self.register_button(obj._tensnap_button_action, obj)
            elif hasattr(obj, '_tensnap_chart'):
                # Handle decorated chart functions
                chart = obj._tensnap_chart
                self.add_chart(chart)
            elif hasattr(obj, 'param'):
                # Handle ParameterProperty objects
                param = obj.param
                self.add_parameter(param)
                
    def auto_register_from_module(self, module: types.ModuleType) -> None:
        """Automatically register parameters, charts, and buttons from a module"""
        self.auto_register_from_namespace(vars(module))
        
    def auto_register_from_instance(self, instance: Any) -> None:
        """Automatically register parameters, charts, and buttons from a class instance"""
        # Get all attributes of the instance
        namespace = {}
        for name in dir(instance):
            if not name.startswith('_'):  # Skip private attributes
                try:
                    attr = getattr(instance, name)
                    namespace[name] = attr
                except Exception:
                    # Skip attributes that can't be accessed
                    continue
        
        self.auto_register_from_namespace(namespace)
        
    def auto_register_from_globals(self, global_dict: Optional[Dict[str, Any]] = None) -> None:
        """Automatically register from global namespace"""
        if global_dict is None:
            # Get caller's globals
            frame = inspect.currentframe()
            if frame and frame.f_back:
                global_dict = frame.f_back.f_globals
            else:
                logger.warning("Could not access caller's globals")
                return
                
        self.auto_register_from_namespace(global_dict)
