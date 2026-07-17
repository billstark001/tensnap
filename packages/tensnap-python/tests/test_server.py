"""Tests for the current TenSnapServer I/O surface."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from websockets.exceptions import ConnectionClosedOK
from websockets.protocol import State

from tensnap.server import (
    ClientToServerMessageType,
    ServerToClientMessageType,
    TenSnapServer,
    encode_message,
)


class TestMessageEncoding:
    def test_encode_message_json(self):
        result = encode_message(
            ServerToClientMessageType.METADATA_UPDATE,
            {"time": 10},
            use_msgpack=False,
        )

        assert isinstance(result, str)
        assert json.loads(result) == {
            "type": "metadata_update",
            "payload": {"time": 10},
        }

    def test_encode_message_msgpack(self):
        import msgpack

        result = encode_message(
            ServerToClientMessageType.ENV_LAYER_UPDATE,
            {"env_id": "env1", "layer_id": "grid", "data": {"x": 5}},
            use_msgpack=True,
        )

        decoded = msgpack.unpackb(result, raw=False)
        assert decoded == {
            "type": "env_layer_update",
            "payload": {"env_id": "env1", "layer_id": "grid", "data": {"x": 5}},
        }


class TestTenSnapServer:
    @pytest.fixture
    def server(self) -> TenSnapServer:
        return TenSnapServer(host="localhost", port=8765, use_msgpack=False)

    def test_server_initialization(self, server: TenSnapServer):
        assert server.host == "localhost"
        assert server.port == 8765
        assert server.use_msgpack is False
        assert server.clients == set()
        assert server._assets == {}

    @pytest.mark.asyncio
    async def test_send_drops_closed_client(self, server: TenSnapServer):
        mock_client = AsyncMock()
        mock_client.send.side_effect = ConnectionClosedOK(None, None, None)
        server.clients.add(mock_client)

        await server.send(
            mock_client,
            ServerToClientMessageType.METADATA_UPDATE,
            {"time": 5},
        )

        assert mock_client not in server.clients

    @pytest.mark.asyncio
    async def test_broadcast_flushes_to_connected_clients(self, server: TenSnapServer):
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.broadcast(ServerToClientMessageType.METADATA_UPDATE, {"time": 5})
        await server._queue.flush()

        sent = json.loads(mock_client.send.await_args_list[0].args[0])
        assert sent == {"type": "metadata_update", "payload": {"time": 5}}

    @pytest.mark.asyncio
    async def test_action_result_waits_for_queued_state_updates(
        self, server: TenSnapServer
    ):
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.broadcast(ServerToClientMessageType.METADATA_UPDATE, {"time": 1})
        await server.broadcast(
            ServerToClientMessageType.ITEM_UPDATE,
            {"env_id": "main", "layer_id": "agents", "items": [{"id": 1, "x": 2}]},
        )
        await server.send_action_end(mock_client, "step", tick_id="tick-1")

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]
        assert [message["type"] for message in sent_messages] == [
            "metadata_update",
            "item_update",
            "action_result",
        ]
        assert sent_messages[-1]["payload"] == {
            "id": "step",
            "request_id": "tick-1",
        }

    @pytest.mark.asyncio
    async def test_publish_asset_broadcasts_metadata_and_data(
        self, server: TenSnapServer
    ):
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.publish_asset("icon", b"hello", "text/plain", label="Greeting")
        await server._queue.flush()

        sent_messages = [
            json.loads(call.args[0]) for call in mock_client.send.await_args_list
        ]
        assert [message["type"] for message in sent_messages] == [
            "asset_metadata",
            "asset_data",
        ]
        assert sent_messages[0]["payload"]["assets"][0]["id"] == "icon"
        assert sent_messages[1]["payload"]["data"].startswith("data:text/plain;base64,")

    @pytest.mark.asyncio
    async def test_send_asset_meta_announces_assets_published_before_connect(
        self, server: TenSnapServer
    ):
        await server.publish_asset("icon", b"hello", "text/plain", label="Greeting")
        mock_ws = AsyncMock()

        await server.send_asset_meta(mock_ws)

        sent = json.loads(mock_ws.send.await_args_list[0].args[0])
        assert sent["type"] == "asset_metadata"
        assert sent["payload"]["assets"] == [
            {
                "id": "icon",
                "hash": server._assets["icon"]["hash"],
                "mime": "text/plain",
                "size": 5,
                "label": "Greeting",
            }
        ]

    @pytest.mark.asyncio
    async def test_delete_asset_broadcasts_delete(self, server: TenSnapServer):
        mock_client = AsyncMock()
        mock_client.state = State.OPEN
        server.clients.add(mock_client)

        await server.publish_asset("icon", b"hello", "text/plain")
        await server._queue.flush()
        mock_client.send.reset_mock()

        await server.delete_asset("icon")
        await server._queue.flush()

        sent = json.loads(mock_client.send.await_args_list[0].args[0])
        assert sent == {"type": "asset_delete", "payload": {"ids": ["icon"]}}

    @pytest.mark.asyncio
    async def test_handle_asset_sync_sends_outdated_assets(self, server: TenSnapServer):
        await server.publish_asset("icon", b"hello", "text/plain")
        mock_ws = AsyncMock()

        await server._handle_asset_sync(mock_ws, {"assets": {}})

        sent = json.loads(mock_ws.send.await_args_list[0].args[0])
        assert sent["type"] == "asset_data"
        assert sent["payload"]["id"] == "icon"
        assert sent["payload"]["data"].startswith("data:text/plain;base64,")

    @pytest.mark.asyncio
    async def test_request_screenshot_round_trip(self, server: TenSnapServer):
        mock_client = AsyncMock()
        server.clients.add(mock_client)

        task = asyncio.create_task(
            server.request_screenshot(env_id="main", request_id="shot-1")
        )
        await asyncio.sleep(0)

        sent = json.loads(mock_client.send.await_args_list[0].args[0])
        assert sent == {
            "type": "screenshot_request",
            "payload": {"request_id": "shot-1", "env_id": "main"},
        }

        await server._handle_screenshot_response(
            {"request_id": "shot-1", "mime": "image/png", "data": "abc"}
        )
        result = await task

        assert result == {"request_id": "shot-1", "mime": "image/png", "data": "abc"}

    @pytest.mark.asyncio
    async def test_request_screenshot_validates_target(self, server: TenSnapServer):
        mock_client = AsyncMock()
        server.clients.add(mock_client)

        with pytest.raises(ValueError):
            await server.request_screenshot(request_id="bad")

    @pytest.mark.asyncio
    async def test_dispatch_routes_state_sync_messages(self, server: TenSnapServer):
        mock_ws = AsyncMock()
        server.on_state_sync = AsyncMock()

        raw = json.dumps(
            {
                "type": ClientToServerMessageType.STATE_SYNC.value,
                "payload": {"request_id": "sync-1"},
            }
        )
        await server._dispatch(mock_ws, raw)

        server.on_state_sync.assert_awaited_once_with(mock_ws, {"request_id": "sync-1"})

    @pytest.mark.asyncio
    async def test_dispatch_routes_screenshot_response_messages(
        self, server: TenSnapServer
    ):
        future = asyncio.get_running_loop().create_future()
        server._pending_screenshots["shot-1"] = future

        raw = json.dumps(
            {
                "type": ClientToServerMessageType.SCREENSHOT_RESPONSE.value,
                "payload": {"request_id": "shot-1", "data": "abc"},
            }
        )
        await server._dispatch(AsyncMock(), raw)

        assert future.done()
        assert future.result() == {"request_id": "shot-1", "data": "abc"}
