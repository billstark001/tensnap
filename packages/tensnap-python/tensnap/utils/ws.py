from typing import List, Set, Dict
import asyncio
import logging
from websockets.server import WebSocketServerProtocol
from collections import defaultdict

logger = logging.getLogger(__name__)


class BatchedMessageQueue:
    def __init__(self, batch_size: int = 50, flush_interval: float = 0.01):
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self._queue: List[tuple[Set[WebSocketServerProtocol], str | bytes]] = []
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
        self._last_flush = 0
        self._closed = False

    async def add(
        self, clients: Set[WebSocketServerProtocol], message: str | bytes
    ) -> None:
        """Add a message to the queue and trigger flush if necessary."""
        if self._closed:
            logger.warning("Cannot add message to closed queue")
            return

        async with self._lock:
            # Store a snapshot of clients to avoid external modifications
            self._queue.append((frozenset(clients), message))  # type: ignore

            should_flush = (
                len(self._queue) >= self.batch_size
                or asyncio.get_event_loop().time() - self._last_flush
                >= self.flush_interval
            )

        if should_flush:
            await self._trigger_flush()

    async def _trigger_flush(self) -> None:
        """Ensure only one flush operation runs at a time."""
        async with self._lock:
            # Only create a new flush task if one isn't already running
            if self._flush_task is None or self._flush_task.done():
                self._flush_task = asyncio.create_task(self._flush_impl())

    async def flush(self) -> None:
        """Public flush method that respects the lock."""
        if self._closed:
            return
        await self._trigger_flush()
        if self._flush_task:
            await self._flush_task

    async def _flush_impl(self) -> None:
        """Internal flush implementation."""
        async with self._lock:
            if not self._queue:
                return

            # Group messages by client to minimize send operations
            client_msgs: Dict[WebSocketServerProtocol, List[str | bytes]] = defaultdict(
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
            for i, result in enumerate(results):
                if isinstance(result, Exception) and not isinstance(
                    result, (ConnectionError, asyncio.CancelledError)
                ):
                    logger.exception(f"Error sending messages: {result}")

    @staticmethod
    async def _send_batch(
        client: WebSocketServerProtocol, messages: List[str | bytes]
    ) -> None:
        """Send multiple messages to a single client efficiently."""
        try:
            if client.closed:
                return

            # Send messages sequentially to the same client
            # (WebSocket doesn't support true concurrent sends to same client)
            for message in messages:
                await client.send(message)

        except (ConnectionError, asyncio.CancelledError):
            # Expected exceptions during client disconnect
            pass
        except Exception as e:
            logger.exception(f"Unexpected error sending to client: {e}")

    async def close(self) -> None:
        """Gracefully close the queue and flush remaining messages."""
        async with self._lock:
            self._closed = True

        # Flush any remaining messages
        await self.flush()
        if self._flush_task and not self._flush_task.done():
            try:
                await asyncio.wait_for(self._flush_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("Flush task did not complete within timeout")

    async def __aenter__(self):
        """Support async context manager."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Ensure cleanup on context exit."""
        await self.close()
