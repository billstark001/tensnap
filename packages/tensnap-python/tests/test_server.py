"""Tests for TenSnap server functionality"""

import pytest
import asyncio
import json
import logging
from unittest.mock import Mock, AsyncMock
from websockets.exceptions import ConnectionClosedOK
from websockets.protocol import State
from tensnap.server import (
    TenSnapServer,
    encode_message,
    ServerToClientMessageType,
    ClientToServerMessageType,
)
from tensnap.bindings.basic import NumberParameter, ActionMetadata, ChartGroupMetadata
from tensnap.models import GridEnvironmentBinder, GraphEnvironmentBinder


class TestMessageEncoding:
    """Test message encoding functionality"""

    def test_encode_message_json(self):
        """Test JSON message encoding"""
        msg_type = ServerToClientMessageType.METADATA_UPDATE
        payload = {"time": 10}
        result = encode_message(msg_type, payload, use_msgpack=False)

        assert isinstance(result, str)
        decoded = json.loads(result)
        assert decoded["type"] == "metadata_update"
        assert decoded["payload"]["time"] == 10

    def test_encode_message_msgpack(self):
        """Test MessagePack encoding"""
        import msgpack

        msg_type = ServerToClientMessageType.ENV_LAYER_UPDATE
        payload = {"env_id": "env1", "layer_id": "", "data": {"x": 5}}
        result = encode_message(msg_type, payload, use_msgpack=True)

        assert isinstance(result, bytes)
        decoded = msgpack.unpackb(result, raw=False)
        assert decoded["type"] == "env_layer_update"
        assert decoded["payload"]["env_id"] == "env1"

    def test_encode_message_screenshot_request_json(self):
        """Test JSON screenshot request encoding"""
        msg_type = ServerToClientMessageType.SCREENSHOT_REQUEST
        payload = {"request_id": "shot-1", "env_id": "main"}
        result = encode_message(msg_type, payload, use_msgpack=False)

        decoded = json.loads(result)
        assert decoded["type"] == "screenshot_request"
        assert decoded["payload"]["request_id"] == "shot-1"


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
        assert len(server.actions) == 0
        assert len(server.charts) == 0

    def test_add_environment(self, server: TenSnapServer):
        """Test adding an environment to the server"""
        # Create a mock environment
        env = Mock()
        env.id = "test_env"
        env.get_state = Mock(
            return_value={
                "id": "test_env",
                "type": "2d",
                "layers": [{"layer_id": "grid", "layer_type": "grid"}],
            }
        )

        server.add_environment(env)

        assert "test_env" in server.environments
        assert server.environments["test_env"] == env

    def test_remove_environment(self, server: TenSnapServer):
        """Test removing an environment from the server"""
        env = Mock()
        env.id = "test_env"
        env.get_state = Mock(
            return_value={"id": "test_env", "type": "uniform", "layers": []}
        )

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
        """Test adding an action to the server (v0.2 — stored separately from parameters)"""
        action_meta = ActionMetadata(id="test_action", label="Test Action")

        handler_called = {"value": False}

        def handler():
            handler_called["value"] = True

        server.add_action(action_meta, handler)

        # v0.2: actions are in server.actions, NOT in server.parameters
        assert "test_action" in server.actions
        assert "test_action" not in server.parameters
        assert "test_action" in server.button_handlers

        # Test handler can be called
        server.button_handlers["test_action"]()
        assert handler_called["value"] is True

    def test_remove_action(self, server: TenSnapServer):
        """Test removing an action from the server"""
        action_meta = ActionMetadata(id="test_action", label="Test")
        handler = lambda: None

        server.add_action(action_meta, handler)
        assert "test_action" in server.actions
        assert "test_action" in server.button_handlers

        server.remove_action("test_action")
        assert "test_action" not in server.actions
        assert "test_action" not in server.button_handlers

    def test_dump_parameters(self, server: TenSnapServer):
        """Test dumping all parameter values — actions must not appear"""
        param1 = NumberParameter(id="param1", value=10.0)
        param2 = NumberParameter(id="param2", value=20.0)
        action_meta = ActionMetadata(id="action1")

        server.add_parameter(param1)
        server.add_parameter(param2)
        server.add_action(action_meta, lambda: None)

        dump = server.dump_parameters()

        assert "param1" in dump
        assert "param2" in dump
        assert "action1" not in dump  # Actions are stored separately; must not appear
        assert dump["param1"] == 10.0
        assert dump["param2"] == 20.0

    @pytest.mark.asyncio
    async def test_broadcast(self, server: TenSnapServer):
        """Test broadcasting messages to clients"""
        # Mock client
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server._broadcast(ServerToClientMessageType.METADATA_UPDATE, {"time": 5})

        # Flush the queue
        await server._queue.flush()

        # Check that the client received the message
        assert mock_client.send.called

    @pytest.mark.asyncio
    async def test_send_ignores_manual_disconnect(
        self, server: TenSnapServer, caplog: pytest.LogCaptureFixture
    ):
        """Sending to a cleanly closed client should not emit an exception traceback."""
        mock_client = AsyncMock()
        mock_client.send.side_effect = ConnectionClosedOK(None, None, None)
        server.clients.add(mock_client)

        with caplog.at_level(logging.ERROR, logger="tensnap.server"):
            await server._send(
                mock_client,
                ServerToClientMessageType.METADATA_UPDATE,
                {"time": 5},
            )

        assert mock_client not in server.clients
        assert not caplog.records

    @pytest.mark.asyncio
    async def test_broadcast_ignores_manual_disconnect(
        self, server: TenSnapServer, caplog: pytest.LogCaptureFixture
    ):
        """Queued sends should also treat clean disconnects as expected."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        mock_client.send.side_effect = ConnectionClosedOK(None, None, None)
        server.clients.add(mock_client)

        with caplog.at_level(logging.ERROR, logger="tensnap.utils.ws"):
            await server._broadcast(
                ServerToClientMessageType.METADATA_UPDATE, {"time": 5}
            )
            await server._queue.flush()

        assert not caplog.records

    @pytest.mark.asyncio
    async def test_update_layer_metadata(self, server: TenSnapServer):
        """Layer-scoped metadata helpers should preserve the caller's layer id."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.update_layer_metadata("env1", "grid", {"x": 10, "y": 20})

        await server._queue.flush()

        sent_message = json.loads(mock_client.send.await_args_list[0].args[0])
        assert sent_message == {
            "type": "env_layer_update",
            "payload": {
                "env_id": "env1",
                "layer_id": "grid",
                "data": {"x": 10, "y": 20},
            },
        }

    @pytest.mark.asyncio
    async def test_update_layer_agents(self, server: TenSnapServer):
        """Layer-scoped agent helpers should preserve the caller's layer id."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.update_layer_agents(
            "env1",
            "agents",
            creates=[{"id": 1, "x": 1}],
            updates=[{"id": 1, "x": 2}],
            deletes=[1],
        )
        await server._queue.flush()

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]

        assert [msg["type"] for msg in sent_messages] == [
            "agent_create",
            "agent_update",
            "agent_delete",
        ]
        assert all(msg["payload"]["layer_id"] == "agents" for msg in sent_messages)

    @pytest.mark.asyncio
    async def test_update_layer_edges(self, server: TenSnapServer):
        """Layer-scoped edge helpers should preserve the caller's layer id."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.update_layer_edges(
            "env1",
            "edges",
            creates=[{"source": 1, "target": 2}],
            updates=[{"source": 2, "target": 3, "color": "#ff0000"}],
            deletes=[{"source": 3, "target": 4}],
        )
        await server._queue.flush()

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]

        assert [msg["type"] for msg in sent_messages] == [
            "edge_create",
            "edge_update",
            "edge_delete",
        ]
        assert all(msg["payload"]["layer_id"] == "edges" for msg in sent_messages)

    @pytest.mark.asyncio
    async def test_replace_layer_state(self, server: TenSnapServer):
        """Replacing a layer should recreate it with fresh payloads."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.replace_layer_state(
            "env1",
            {
                "layer_id": "patches",
                "layer_type": "agent",
                "data": {"width": 2, "height": 2},
                "agents": [{"id": "patch:0:0", "x": 0, "y": 0}],
            },
        )
        await server._queue.flush()

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]

        assert [msg["type"] for msg in sent_messages] == [
            "env_layer_delete",
            "env_layer_create",
            "agent_create",
        ]
        assert sent_messages[1]["payload"]["layer_id"] == "patches"
        assert sent_messages[1]["payload"]["data"] == {"width": 2, "height": 2}

    @pytest.mark.asyncio
    async def test_replace_environment_layers(self, server: TenSnapServer):
        """Replacing environment layers should recreate the environment snapshot."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.replace_environment_layers(
            "env1",
            "2d",
            [
                {
                    "layer_id": "agents",
                    "layer_type": "agent",
                    "agents": [{"id": "agent1", "x": 1, "y": 2}],
                }
            ],
        )
        await server._queue.flush()

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]

        assert [msg["type"] for msg in sent_messages] == [
            "env_delete",
            "env_create",
            "env_layer_create",
            "agent_create",
        ]
        assert sent_messages[1]["payload"] == {"id": "env1", "type": "2d"}

    @pytest.mark.asyncio
    async def test_state_sync_replays_layered_graph_environment(
        self, server: TenSnapServer
    ):
        """State sync should replay graph binders as 2d env + edge layer."""

        class GraphEnv:
            def __init__(self):
                self.edges = [
                    {"source": 1, "target": 2},
                    {"source": 2, "target": 3},
                ]
                self.agents = [{"id": 1}, {"id": 2}, {"id": 3}]

        binder = GraphEnvironmentBinder(
            id="graph_env",
            environment=GraphEnv(),
            agent_accessor=lambda agent: agent,
        )
        server.add_environment(binder)

        mock_ws = AsyncMock()
        await server._handle_state_sync(
            mock_ws,
            {
                "request_id": "sync-1",
                "parameters": [],
                "actions": [],
                "envs": [
                    {
                        "id": "graph_env",
                        "type": "2d",
                        "layers": [
                            {"layer_id": "agents", "layer_type": "agent"},
                            {"layer_id": "edges", "layer_type": "edge"},
                        ],
                    }
                ],
                "charts": [],
            },
        )

        sent_messages = [
            json.loads(call.args[0]) for call in mock_ws.send.await_args_list
        ]
        assert sent_messages[0] == {
            "type": "state_sync_begin",
            "payload": {"request_id": "sync-1"},
        }
        assert sent_messages[-1] == {
            "type": "state_sync_end",
            "payload": {"request_id": "sync-1"},
        }
        assert any(
            msg["type"] == "edge_create"
            and msg["payload"]["layer_id"] == "edges"
            and len(msg["payload"]["edges"]) == 2
            for msg in sent_messages
        )
        assert any(
            msg["type"] == "env_layer_create" and msg["payload"]["layer_type"] == "edge"
            for msg in sent_messages
        )

    @pytest.mark.asyncio
    async def test_publish_asset_uses_data_url_in_json_mode(
        self, server: TenSnapServer
    ):
        """Asset payloads should use explicit data URLs in JSON mode."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.publish_asset(
            "icon",
            b"hello",
            "text/plain",
            label="Greeting",
        )
        await server._queue.flush()

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]
        asset_data_messages = [
            msg for msg in sent_messages if msg["type"] == "asset_data"
        ]
        assert len(asset_data_messages) == 1
        assert asset_data_messages[0]["payload"]["data"].startswith(
            "data:text/plain;base64,"
        )

    @pytest.mark.asyncio
    async def test_queue_close_flushes_pending_messages(self, server: TenSnapServer):
        """Closing the queue should still deliver already-enqueued messages."""
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server._broadcast(ServerToClientMessageType.METADATA_UPDATE, {"time": 5})
        await server._queue.close()

        assert mock_client.send.called

    @pytest.mark.asyncio
    async def test_asset_sync_uses_data_url_in_json_mode(self, server: TenSnapServer):
        """Asset sync responses should also use explicit data URLs in JSON mode."""
        await server.publish_asset("icon", b"hello", "text/plain")

        mock_ws = AsyncMock()
        await server._handle_asset_sync(mock_ws, {"assets": {}})

        sent_messages = [
            json.loads(call.args[0]) for call in mock_ws.send.await_args_list
        ]
        assert len(sent_messages) == 1
        assert sent_messages[0]["type"] == "asset_data"
        assert sent_messages[0]["payload"]["data"].startswith("data:text/plain;base64,")

    @pytest.mark.asyncio
    async def test_request_screenshot_round_trip(self, server: TenSnapServer):
        """Server should send screenshot_request and resolve the matching screenshot_response."""
        mock_ws = AsyncMock()
        server.clients.add(mock_ws)

        task = asyncio.create_task(
            server.request_screenshot(env_id="main", request_id="shot-1", timeout=1)
        )
        await asyncio.sleep(0)

        sent_messages = [
            json.loads(call.args[0]) for call in mock_ws.send.await_args_list
        ]
        assert sent_messages[0]["type"] == "screenshot_request"
        assert sent_messages[0]["payload"] == {"request_id": "shot-1", "env_id": "main"}

        await server._handle_message(
            mock_ws,
            json.dumps(
                {
                    "type": "screenshot_response",
                    "payload": {
                        "request_id": "shot-1",
                        "mime": "image/png",
                        "data": "data:image/png;base64,AAAA",
                    },
                }
            ),
        )

        response = await task
        assert response["request_id"] == "shot-1"
        assert response["mime"] == "image/png"

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
    async def test_compute_action_deltas(self, server: TenSnapServer):
        """Test computing action deltas for state sync (v0.2 custom actions)."""
        action1 = ActionMetadata(id="start", label="Start")
        action2 = ActionMetadata(id="stop", label="Stop")

        server.add_action(action1, lambda: None)
        server.add_action(action2, lambda: None)

        # Client has only "start"
        client_state = [
            {
                "id": "start",
                "label": "Start",
                "continuous": False,
                "allowRuntimeChange": True,
            }
        ]
        result = await server._compute_action_deltas(client_state)

        assert len(result["added"]) == 1
        assert result["added"][0]["id"] == "stop"
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
    async def test_handle_action_start(self, server: TenSnapServer):
        """Test handling action_start from client (v0.2)"""
        clicked = {"value": False}

        def handler():
            clicked["value"] = True

        action_meta = ActionMetadata(id="test_action")
        server.add_action(action_meta, handler)

        mock_ws = AsyncMock()

        await server._handle_action_start(
            mock_ws, {"id": "test_action", "tick_id": "tick-1"}
        )

        assert clicked["value"] is True
        sent_messages = [
            json.loads(call.args[0]) for call in mock_ws.send.await_args_list
        ]
        assert len(sent_messages) == 1
        assert sent_messages[0]["type"] == "action_end"
        assert sent_messages[0]["payload"]["id"] == "test_action"
        assert sent_messages[0]["payload"]["tick_id"] == "tick-1"
        assert "continue" not in sent_messages[0]["payload"]
        assert sent_messages[0]["payload"]["timings"]["simulate_ms"] >= 0
