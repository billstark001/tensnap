"""
TenSnap Simulation Manager

Provides simulation lifecycle management with easy start/stop functionality
and automatic step execution for agent-based models.
"""

from typing import Callable, Awaitable, TypeVar, Union, Optional, Any, TYPE_CHECKING
from typing_extensions import ParamSpec

import asyncio
import logging
from collections import deque

from .bindings.basic import action
from .utils.func import call_function

if TYPE_CHECKING:
    from .server import TenSnapServer


logger = logging.getLogger(__name__)


class SimulationLoop:
    """
    Manages simulation lifecycle with thread/task management.
    Provides easy start/stop functionality and automatic step execution.
    """

    def __init__(
        self,
        on_start: Optional[Callable[[int], Any | None]] = None,
        on_step: Optional[Callable[[int], Any | None]] = None,
        on_stop: Optional[Callable[[int], Any | None]] = None,
        step_interval: float = 0.05,
    ):
        """
        Initialize the simulation manager.

        Args:
            on_start: Function to call once when simulation starts
            on_step: Function to call for each simulation step
            on_stop: Function to call when simulation stops
            step_interval: Time between steps in seconds (default 20 FPS)
        """
        self.on_start = on_start
        self.on_step = on_step
        self.on_stop = on_stop
        self.step_interval = step_interval

        self.running = False
        self.time_step = 0
        self.simulation_task: Optional[asyncio.Task] = None
        
        # Queue for operation requests
        self._operation_queue: deque = deque()
        self._operation_lock = asyncio.Lock()
        self._operation_processor_task: Optional[asyncio.Task] = None
        self._shutdown = False

    async def _process_operations(self) -> None:
        """Process operations from the queue one by one."""
        while not self._shutdown:
            try:
                # Wait for operations or check periodically
                await asyncio.sleep(0.001)  # Small delay to prevent busy waiting
                
                if not self._operation_queue:
                    continue
                    
                # Get next operation
                operation, args, future = self._operation_queue.popleft()
                
                try:
                    result = await operation(*args)
                    if not future.cancelled():
                        future.set_result(result)
                except Exception as e:
                    if not future.cancelled():
                        future.set_exception(e)
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Error in operation processor: %s", e)

    async def _queue_operation(self, operation: Callable, *args) -> Any:
        """Queue an operation for execution and return its future result."""
        if self._shutdown:
            raise RuntimeError("SimulationManager is shutting down")
            
        # Start operation processor if not running
        if self._operation_processor_task is None or self._operation_processor_task.done():
            self._operation_processor_task = asyncio.create_task(self._process_operations())
        
        # Create future for result
        future = asyncio.Future()
        
        # Add to queue
        self._operation_queue.append((operation, args, future))
        
        return await future

    async def _simulation_loop(self) -> None:
        """Internal simulation loop that runs until stopped."""
        try:
            while self.running:
                if self.on_step:
                    await call_function(self.on_step, self.time_step)
                self.time_step += 1
                await asyncio.sleep(self.step_interval)

        except asyncio.CancelledError:
            pass
        finally:
            self.simulation_task = None

    async def _start_impl(self, from_time_step: int | None = None) -> None:
        """Internal start implementation."""
        if self.running:
            return

        self.running = True
        if from_time_step is not None:
            self.time_step = from_time_step
        # Call initialization function
        if self.on_start:
            await call_function(self.on_start, self.time_step)
        # Start simulation loop
        if self.on_step:
            self.simulation_task = asyncio.create_task(self._simulation_loop())

    async def _stop_impl(self) -> None:
        """Internal stop implementation."""
        if not self.running:
            return

        self.running = False

        # Cancel simulation task
        if self.simulation_task:
            self.simulation_task.cancel()
            try:
                await self.simulation_task
            except asyncio.CancelledError:
                pass
            finally:
                self.simulation_task = None

        # Call cleanup function
        if self.on_stop:
            await call_function(self.on_stop, self.time_step)

    async def _step_once_impl(self) -> None:
        """Internal step once implementation."""
        if self.on_step:
            await call_function(self.on_step, self.time_step)
        self.time_step += 1

    @action("start", "Start")
    async def start(self, from_time_step: int | None = None) -> None:
        """Start the simulation from the specified time step."""
        return await self._queue_operation(self._start_impl, from_time_step)

    @action("stop", "Stop")
    async def stop(self) -> None:
        """Stop the simulation and cleanup resources."""
        return await self._queue_operation(self._stop_impl)

    @action("start_stop", "Start/Stop")
    async def toggle(self, from_time_step: int | None = None) -> None:
        """Toggle simulation running state."""
        async def _toggle_impl(from_time_step: int | None = None) -> None:
            if self.running:
                await self._stop_impl()
            else:
                if from_time_step is None:
                    from_time_step = self.time_step
                await self._start_impl(from_time_step=from_time_step)
        
        return await self._queue_operation(_toggle_impl, from_time_step)

    @action("step", "Step")
    async def step_once(self) -> None:
        """Execute a single simulation step."""
        return await self._queue_operation(self._step_once_impl)

    async def shutdown(self) -> None:
        """Shutdown the simulation manager and cleanup all resources."""
        # Stop simulation first
        await self.stop()
        
        # Mark as shutting down
        self._shutdown = True
        
        # Cancel operation processor
        if self._operation_processor_task and not self._operation_processor_task.done():
            self._operation_processor_task.cancel()
            try:
                await self._operation_processor_task
            except asyncio.CancelledError:
                pass
        
        # Cancel any remaining futures in queue
        while self._operation_queue:
            _, _, future = self._operation_queue.popleft()
            if not future.cancelled():
                future.cancel()


    def register_to(
        self, server: "TenSnapServer",
    ):
        """
        Add a simulation manager to a TenSnapServer with default button controls.

        Args:
            server: The TenSnapServer instance to add controls to
        """
        
        # Add default control buttons
        for func in [self.start, self.stop, self.toggle, self.step_once]:
            param = func._tensnap_action  # type: ignore
            server.add_action(
                action_parameter=param,
                handler=func,
                add_parameter=True,
            )
