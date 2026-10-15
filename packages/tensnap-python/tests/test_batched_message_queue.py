"""Batched transport delivery must not strand frames around I/O boundaries."""

import asyncio
from typing import cast

import pytest
from websockets.asyncio.server import ServerConnection
from websockets.protocol import State

from tensnap.utils.ws import BatchedMessageQueue


class Client:
    state = State.OPEN

    def __init__(self, block_first: bool = False) -> None:
        self.messages: list[str | bytes] = []
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.received = asyncio.Event()
        if not block_first:
            self.release.set()

    async def send(self, message: str | bytes) -> None:
        self.started.set()
        await self.release.wait()
        self.messages.append(message)
        self.received.set()

    @property
    def connection(self) -> ServerConnection:
        return cast(ServerConnection, self)


@pytest.mark.asyncio
async def test_sends_a_lone_frame_after_the_batching_delay() -> None:
    queue = BatchedMessageQueue(flush_interval=0.02)
    client = Client()
    await queue.add({client.connection}, "first")
    await queue.flush()
    client.received.clear()
    await queue.add({client.connection}, "second")
    await asyncio.wait_for(client.received.wait(), timeout=1)
    assert client.messages == ["first", "second"]
    await queue.close()
    assert queue._flush_handle is None


@pytest.mark.asyncio
async def test_drains_messages_added_during_a_slow_send_in_order() -> None:
    queue = BatchedMessageQueue(flush_interval=10)
    client = Client(block_first=True)
    await queue.add({client.connection}, "first")
    await asyncio.wait_for(client.started.wait(), timeout=1)
    await queue.add({client.connection}, "second")
    client.release.set()
    await asyncio.wait_for(queue.flush(), timeout=1)
    assert client.messages == ["first", "second"]
    await queue.close()


@pytest.mark.asyncio
async def test_close_waits_for_in_flight_frames_and_rejects_new_additions() -> None:
    queue = BatchedMessageQueue()
    client = Client(block_first=True)
    await queue.add({client.connection}, "first")
    await asyncio.wait_for(client.started.wait(), timeout=1)
    closing = asyncio.create_task(queue.close())
    await asyncio.sleep(0)
    assert not closing.done()
    await queue.add({client.connection}, "ignored")
    client.release.set()
    await asyncio.wait_for(closing, timeout=1)
    assert client.messages == ["first"]
    assert not queue._queue


@pytest.mark.asyncio
async def test_cancelling_one_flusher_does_not_cancel_shared_delivery() -> None:
    queue = BatchedMessageQueue()
    client = Client(block_first=True)
    await queue.add({client.connection}, "first")
    await asyncio.wait_for(client.started.wait(), timeout=1)
    flushing = asyncio.create_task(queue.flush())
    await asyncio.sleep(0)
    flushing.cancel()
    with pytest.raises(asyncio.CancelledError):
        await flushing
    assert queue._flush_task is not None and not queue._flush_task.cancelled()
    client.release.set()
    await asyncio.wait_for(queue.close(), timeout=1)
    assert client.messages == ["first"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"batch_size": 0},
        {"batch_size": True},
        {"flush_interval": -1},
        {"flush_interval": float("nan")},
        {"flush_interval": float("inf")},
    ],
)
def test_rejects_invalid_queue_configuration(kwargs) -> None:
    with pytest.raises(ValueError):
        BatchedMessageQueue(**kwargs)
