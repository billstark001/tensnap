"""
TenSnap Simulation Loop (Renderer-Driven)

In protocol v0.2, continuous execution is controlled by the renderer. The
simulator handles one action_start at a time and returns action_end with
continue=true/false.
"""

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from .bindings.basic import action
from .utils.func import call_function

if TYPE_CHECKING:
    from .server import TenSnapServer


logger = logging.getLogger(__name__)


class SimulationLoop:
    """Renderer-driven simulation action handler.

    - start: initializes once (on_start) and then advances one step per call.
    - step: advances exactly one step.
    - no default stop/start_stop action is registered.
    """

    def __init__(
        self,
        on_start: Callable[[int], Any | None] | None = None,
        on_step: Callable[[int], Any | None] | None = None,
        on_stop: Callable[[int], Any | None] | None = None,
        step_interval: float = 0.05,
    ) -> None:
        self.on_start = on_start
        self.on_step = on_step
        self.on_stop = on_stop
        self.step_interval = step_interval
        self.time_step = 0
        self._initialized = False

    async def _advance_once(self) -> None:
        if self.on_step:
            await call_function(self.on_step, self.time_step)
        self.time_step += 1

    @action("start", "Start", continuous=True)
    async def start(self) -> bool:
        """Handle one renderer tick for a continuous run.

        Returns True so the renderer can keep dispatching the next tick.
        """
        if not self._initialized:
            if self.on_start:
                await call_function(self.on_start, self.time_step)
            self._initialized = True
            return True

        await self._advance_once()
        return True

    @action("step", "Step")
    async def step_once(self) -> None:
        """Execute a single simulation step."""
        if not self._initialized:
            self._initialized = True
        await self._advance_once()

    def reset_clock(self) -> None:
        self.time_step = 0
        self._initialized = False

    async def shutdown(self) -> None:
        """No background tasks to shut down in renderer-driven mode."""
        return None

    def register_to(self, server: "TenSnapServer"):
        """Register default controls (start, step) to the server.

        stop/start_stop are intentionally not registered by default.
        Users can add custom stop actions explicitly when needed.
        """
        for func in [self.start, self.step_once]:
            metadata = func._tensnap_action  # type: ignore
            server.add_action(
                action=metadata,
                handler=func,
            )
