import asyncio
import logging
import math
from collections import defaultdict

from websockets.asyncio.server import ServerConnection
from websockets.exceptions import ConnectionClosed
from websockets.protocol import State

logger = logging.getLogger(__name__)


class BatchedMessageQueue:
    def __init__(self, batch_size: int = 50, flush_interval: float = 0.01):
        if (
            not isinstance(batch_size, int)
            or isinstance(batch_size, bool)
            or batch_size < 1
        ):
            raise ValueError("batch_size must be a positive integer")
        if not math.isfinite(flush_interval) or flush_interval < 0:
            raise ValueError("flush_interval must be non-negative and finite")
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self._queue: list[tuple[frozenset[ServerConnection], str | bytes]] = []
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
        self._flush_handle: asyncio.TimerHandle | None = None
        self._last_flush = 0.0
        self._closed = False

    async def add(self, clients: set[ServerConnection], message: str | bytes) -> None:
        """Queue a frame for the current clients, with bounded batching delay."""
        async with self._lock:
            if self._closed:
                logger.warning("Cannot add message to closed queue")
                return
            self._queue.append((frozenset(clients), message))
            loop = asyncio.get_running_loop()
            remaining = self.flush_interval - (loop.time() - self._last_flush)
            should_flush = len(self._queue) >= self.batch_size or remaining <= 0
            if (
                not should_flush
                and self._flush_handle is None
                and (self._flush_task is None or self._flush_task.done())
            ):
                self._flush_handle = loop.call_later(remaining, self._flush_due)

        if should_flush:
            await self._trigger_flush()

    def _flush_due(self) -> None:
        self._flush_handle = None
        if not self._closed and (self._flush_task is None or self._flush_task.done()):
            self._flush_task = asyncio.create_task(self._flush_impl())

    async def _trigger_flush(self) -> None:
        """Ensure only one flush operation runs at a time."""
        async with self._lock:
            if self._flush_handle is not None:
                self._flush_handle.cancel()
                self._flush_handle = None
            # Only create a new flush task if one isn't already running
            if self._flush_task is None or self._flush_task.done():
                self._flush_task = asyncio.create_task(self._flush_impl())

    async def flush(self) -> None:
        """Await queued and in-flight frames without cancelling shared sends."""
        while True:
            await self._trigger_flush()
            if self._flush_task:
                await asyncio.shield(self._flush_task)
            async with self._lock:
                if not self._queue:
                    return

    async def _flush_impl(self) -> None:
        """Drain in order, including frames added while a send is awaiting I/O."""
        while True:
            async with self._lock:
                if not self._queue:
                    return

                # Group messages by client to minimize send operations
                client_msgs: dict[ServerConnection, list[str | bytes]] = defaultdict(
                    list
                )
                for clients, msg in self._queue:
                    for client in clients:
                        client_msgs[client].append(msg)

                # Clear queue immediately after copying to avoid holding lock during I/O
                self._queue.clear()
                self._last_flush = asyncio.get_event_loop().time()

            # Perform I/O outside the lock to improve concurrency
            # Use batched sends per client for better performance
            send_tasks = [
                self._send_batch(client, messages)
                for client, messages in client_msgs.items()
            ]

            if send_tasks:
                results = await asyncio.gather(*send_tasks, return_exceptions=True)

                # Log any critical errors
                for result in results:
                    if isinstance(result, Exception) and not isinstance(
                        result, (ConnectionError, asyncio.CancelledError)
                    ):
                        logger.exception(f"Error sending messages: {result}")

    @staticmethod
    async def _send_batch(
        client: ServerConnection, messages: list[str | bytes]
    ) -> None:
        """Send multiple messages to a single client efficiently."""
        try:
            if client.state is not State.OPEN:
                return

            # Send messages sequentially to the same client
            # (WebSocket doesn't support true concurrent sends to same client)
            for message in messages:
                await client.send(message)

        except (ConnectionClosed, ConnectionError, asyncio.CancelledError):
            # Expected exceptions during client disconnect
            pass
        except Exception as e:
            logger.exception(f"Unexpected error sending to client: {e}")

    async def close(self) -> None:
        """Gracefully close the queue and flush remaining messages."""
        async with self._lock:
            self._closed = True
            if self._flush_handle is not None:
                self._flush_handle.cancel()
                self._flush_handle = None
        await self.flush()

    async def __aenter__(self):
        """Support async context manager."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Ensure cleanup on context exit."""
        await self.close()
