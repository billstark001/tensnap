"""Tests for TenSnap server functionality"""

import pytest
import asyncio
import json
from unittest.mock import Mock, AsyncMock
from tensnap.server import (
    TenSnapServer,
    encode_message,
    ServerToClientMessageType,
    ClientToServerMessageType,
)
from tensnap.bindings.basic import NumberParameter, ActionParameter, ChartGroupMetadata
from tensnap.models import GridEnvironmentBinder


class TestMessageEncoding:
    """Test message encoding functionality"""

    def test_encode_message_json(self):
        """Test JSON message encoding"""
        msg_type = ServerToClientMessageType.TIME_STEP_START
        payload = {"time": 10}
        result = encode_message(msg_type, payload, use_msgpack=False)

        assert isinstance(result, str)
        decoded = json.loads(result)
        assert decoded["type"] == "time_step_start"
        assert decoded["payload"]["time"] == 10

    def test_encode_message_msgpack(self):
        """Test MessagePack encoding"""
        import msgpack

        msg_type = ServerToClientMessageType.ENVIRONMENT_UPDATE
        payload = {"id": "env1", "data": {"x": 5}}
        result = encode_message(msg_type, payload, use_msgpack=True)

        assert isinstance(result, bytes)
        decoded = msgpack.unpackb(result, raw=False)
        assert decoded["type"] == "environment_update"
        assert decoded["payload"]["id"] == "env1"


class TestTenSnapServer:
    """Test TenSnapServer class"""

    @pytest.fixture
    def server(self):
        """Create a test server instance"""
        return TenSnapServer(host="localhost", port=8765, use_msgpack=False)

    def test_server_initialization(self, server: TenSnapServer):
        """Test server is initialized correctly"""
        assert server.host == "localhost"
        assert server.port == 8765
        assert server.use_msgpack is False
        assert len(server.clients) == 0
        assert len(server.environments) == 0
        assert len(server.parameters) == 0
        assert len(server.charts) == 0

    def test_add_environment(self, server: TenSnapServer):
        """Test adding an environment to the server"""
        # Create a mock environment
        env = Mock()
        env.id = "test_env"
        env.get_model_dict = Mock(return_value={"id": "test_env", "type": "grid"})
        env.get_agent_list = Mock(return_value=[])

        server.add_environment(env)

        assert "test_env" in server.environments
        assert server.environments["test_env"] == env

    def test_remove_environment(self, server: TenSnapServer):
        """Test removing an environment from the server"""
        env = Mock()
        env.id = "test_env"
        env.get_model_dict = Mock(return_value={})
        env.get_agent_list = Mock(return_value=[])

        server.add_environment(env)
        assert "test_env" in server.environments

        server.remove_environment("test_env")
        assert "test_env" not in server.environments

    def test_add_parameter(self, server: TenSnapServer):
        """Test adding a parameter to the server"""
        param = NumberParameter(
            id="test_param",
            label="Test Parameter",
            value=10.0,
            min=0.0,
            max=100.0,
            step=1.0,
        )

        server.add_parameter(param)

        assert "test_param" in server.parameters
        assert server.parameters["test_param"].value == 10.0  # type: ignore

    def test_add_parameter_with_getter_setter(self, server: TenSnapServer):
        """Test adding a parameter with getter and setter"""
        test_value = {"val": 5.0}

        def getter():
            return test_value["val"]

        def setter(value):
            test_value["val"] = value

        param = NumberParameter(
            id="dynamic_param", label="Dynamic", value=0.0, min=0.0, max=100.0
        )

        server.add_parameter(param, getter=getter, setter=setter)

        # Test getter
        assert server.get_parameter("dynamic_param") == 5.0

        # Test setter
        server.set_parameter("dynamic_param", 15.0)
        assert test_value["val"] == 15.0

    def test_remove_parameter(self, server: TenSnapServer):
        """Test removing a parameter from the server"""
        param = NumberParameter(id="test_param", value=10.0)
        server.add_parameter(param)

        assert "test_param" in server.parameters

        server.remove_parameter("test_param")
        assert "test_param" not in server.parameters

    def test_add_chart(self, server: TenSnapServer):
        """Test adding a chart to the server"""
        chart = ChartGroupMetadata(
            id="test_chart",
            label="Test Chart",
        )

        def getter():
            return 42

        server.add_chart(getter, chart)

        assert "test_chart" in server.charts
        assert server.charts["test_chart"][0] == chart
        assert server.charts["test_chart"][1] == getter

    def test_remove_chart(self, server: TenSnapServer):
        """Test removing a chart from the server"""
        chart = ChartGroupMetadata(id="test_chart", label="Test")
        getter = lambda: 42

        server.add_chart(getter, chart)
        assert "test_chart" in server.charts

        server.remove_chart("test_chart")
        assert "test_chart" not in server.charts

    def test_add_action(self, server: TenSnapServer):
        """Test adding an action to the server"""
        action_param = ActionParameter(id="test_action", label="Test Action")

        handler_called = {"value": False}

        def handler():
            handler_called["value"] = True

        server.add_action(action_param, handler, add_parameter=True)

        assert "test_action" in server.parameters
        assert "test_action" in server.button_handlers

        # Test handler can be called
        server.button_handlers["test_action"]()
        assert handler_called["value"] is True

    def test_remove_action(self, server: TenSnapServer):
        """Test removing an action from the server"""
        action_param = ActionParameter(id="test_action", label="Test")
        handler = lambda: None

        server.add_action(action_param, handler, add_parameter=True)
        assert "test_action" in server.button_handlers
        assert "test_action" in server.parameters

        server.remove_action("test_action", remove_parameter=True)
        assert "test_action" not in server.button_handlers
        assert "test_action" not in server.parameters

    def test_dump_parameters(self, server: TenSnapServer):
        """Test dumping all parameter values"""
        param1 = NumberParameter(id="param1", value=10.0)
        param2 = NumberParameter(id="param2", value=20.0)
        action = ActionParameter(id="action1")

        server.add_parameter(param1)
        server.add_parameter(param2)
        server.add_parameter(action)

        dump = server.dump_parameters()

        assert "param1" in dump
        assert "param2" in dump
        assert "action1" not in dump  # Actions should not be dumped
        assert dump["param1"] == 10.0
        assert dump["param2"] == 20.0

    @pytest.mark.asyncio
    async def test_broadcast(self, server: TenSnapServer):
        """Test broadcasting messages to clients"""
        # Mock client
        mock_client = AsyncMock()
        mock_client.closed = False
        server.clients.add(mock_client)

        await server._broadcast(ServerToClientMessageType.TIME_STEP_START, {"time": 5})

        # Flush the queue
        await server._queue.flush()

        # Check that the client received the message
        assert mock_client.send.called

    @pytest.mark.asyncio
    async def test_update_environment(self, server: TenSnapServer):
        """Test updating environment data"""
        mock_client = AsyncMock()
        mock_client.closed = False
        server.clients.add(mock_client)

        await server.update_environment(
            "env1", data={"x": 10, "y": 20}, agents=[{"id": 1, "x": 5}]
        )

        await server._queue.flush()

        assert mock_client.send.called

    @pytest.mark.asyncio
    async def test_update_charts(self, server: TenSnapServer):
        """Test updating charts"""
        chart = ChartGroupMetadata(id="test_chart", label="Test")

        call_count = {"value": 0}

        def getter():
            call_count["value"] += 1
            return 42

        server.add_chart(getter, chart)

        await server.update_charts(time=10)

        assert call_count["value"] == 1

    @pytest.mark.asyncio
    async def test_log_message(self, server: TenSnapServer):
        """Test logging a message"""
        mock_client = AsyncMock()
        server.clients.add(mock_client)

        await server.log_message("info", "Test log message")

        await server._queue.flush()

        # Message was queued
        assert len(server.clients) == 1

    @pytest.mark.asyncio
    async def test_compute_parameter_deltas(self, server: TenSnapServer):
        """Test computing parameter deltas for state sync"""
        param1 = NumberParameter(id="param1", value=10.0)
        param2 = NumberParameter(id="param2", value=20.0)

        server.add_parameter(param1)
        server.add_parameter(param2)

        # Client state: only has param1
        client_state = [{"id": "param1", "type": "number", "value": 10.0}]

        result = await server._compute_parameter_deltas(client_state)  # type: ignore

        # param2 should be added
        assert len(result["added"]) == 1
        assert result["added"][0]["id"] == "param2"

        # No parameters should be removed or updated
        assert len(result["removed"]) == 0
        assert len(result["updated"]) == 0

    @pytest.mark.asyncio
    async def test_handle_param_change(self, server: TenSnapServer):
        """Test handling parameter change from client"""
        test_value = {"val": 10.0}

        def setter(value):
            test_value["val"] = value

        param = NumberParameter(id="test_param", value=10.0)
        server.add_parameter(param, setter=setter)

        mock_ws = AsyncMock()

        await server._handle_param_change(mock_ws, {"id": "test_param", "value": 25.0})

        assert test_value["val"] == 25.0

    @pytest.mark.asyncio
    async def test_handle_button_click(self, server: TenSnapServer):
        """Test handling button click from client"""
        clicked = {"value": False}

        def handler():
            clicked["value"] = True

        action = ActionParameter(id="test_action")
        server.add_action(action, handler)

        mock_ws = AsyncMock()

        await server._handle_button_click(mock_ws, {"action": "test_action"})

        assert clicked["value"] is True
