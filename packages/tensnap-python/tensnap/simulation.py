"""
TenSnap Simulation Manager

Provides simulation lifecycle management with easy start/stop functionality
and automatic step execution for agent-based models.
"""

import asyncio
import logging
from typing import Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .server import TenSnapServer

logger = logging.getLogger(__name__)


class SimulationManager:
    """
    Manages simulation lifecycle with thread/task management.
    Provides easy start/stop functionality and automatic step execution.
    """

    def __init__(
        self,
        init_func: Optional[Callable] = None,
        step_func: Optional[Callable] = None,
        cleanup_func: Optional[Callable] = None,
        step_interval: float = 0.05,
        server: Optional["TenSnapServer"] = None,
    ):
        """
        Initialize the simulation manager.

        Args:
            init_func: Function to call once when simulation starts
            step_func: Function to call for each simulation step
            cleanup_func: Function to call when simulation stops
            step_interval: Time between steps in seconds (default 20 FPS)
            server: Optional TenSnapServer instance for broadcasting time step messages
        """
        self.init_func = init_func
        self.step_func = step_func
        self.cleanup_func = cleanup_func
        self.step_interval = step_interval
        self.server = server

        self.running = False
        self.time_step = 0
        self.simulation_task: Optional[asyncio.Task] = None

    async def start(self, from_time_step: int = 0) -> None:
        """Start the simulation from the specified time step."""
        if self.running:
            return

        self.running = True
        self.time_step = from_time_step

        # Call initialization function
        if self.init_func:
            await self._call_function(self.init_func)

        # Start simulation loop
        if self.step_func:
            self.simulation_task = asyncio.create_task(self._simulation_loop())

    async def stop(self) -> None:
        """Stop the simulation and cleanup resources."""
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
        if self.cleanup_func:
            await self._call_function(self.cleanup_func)

    async def toggle(self, from_time_step: int = 0) -> None:
        """Toggle simulation running state."""
        if self.running:
            await self.stop()
        else:
            await self.start(from_time_step=from_time_step)

    async def step_once(self) -> None:
        """Execute a single simulation step."""
        if self.step_func:
            # Send time_step_start message with required time parameter
            if self.server:
                await self.server.start_time_step(self.time_step)
            
            await self._call_function(self.step_func)
            
            # Send time_step_end message with optional time parameter for validation
            if self.server:
                await self.server.end_time_step(self.time_step)
                
            self.time_step += 1

    async def reset(self, reset_func: Optional[Callable] = None) -> None:
        """Reset simulation to initial state."""
        await self.stop()
        self.time_step = 0

        if reset_func:
            await self._call_function(reset_func)
        elif self.init_func:
            # Use init function as reset if no specific reset function provided
            await self._call_function(self.init_func)

    async def _call_function(self, func: Callable) -> None:
        """Call a function, handling both sync and async functions."""
        if asyncio.iscoroutinefunction(func):
            await func()
        else:
            func()

    async def _simulation_loop(self) -> None:
        """Internal simulation loop that runs until stopped."""
        try:
            while self.running and self.step_func:
                # Send time_step_start message with required time parameter
                if self.server:
                    await self.server.start_time_step(self.time_step)
                
                await self._call_function(self.step_func)
                
                # Send time_step_end message with optional time parameter for validation
                if self.server:
                    await self.server.end_time_step(self.time_step)
                    
                self.time_step += 1
                await asyncio.sleep(self.step_interval)
        except asyncio.CancelledError:
            pass
        finally:
            self.simulation_task = None


def add_simulation_manager_to_server(server, **kwargs) -> SimulationManager:
    """
    Add a simulation manager to a TenSnapServer with default button controls.

    Args:
        server: The TenSnapServer instance to add controls to
        **kwargs: Additional arguments to pass to SimulationManager constructor

    Returns:
        The created SimulationManager for further customization
    """
    # Automatically set the server reference
    kwargs['server'] = server
    manager = SimulationManager(**kwargs)

    # Add default control buttons
    server.register_button("start_simulation", manager.start)
    server.register_button("stop_simulation", manager.stop)
    server.register_button("toggle_simulation", manager.toggle)
    server.register_button("step_once", manager.step_once)
    server.register_button("reset_simulation", manager.reset)

    return manager
