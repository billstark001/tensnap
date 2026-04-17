"""Tests for renderer-driven SimulationLoop behavior."""

import pytest

from tensnap.sim_loop import SimulationLoop


class TestSimulationLoop:
    @pytest.fixture
    def sim_loop(self):
        return SimulationLoop(step_interval=0.01)

    def test_initialization(self, sim_loop: SimulationLoop):
        assert sim_loop.time_step == 0
        assert sim_loop.step_interval == 0.01

    @pytest.mark.asyncio
    async def test_start_initializes_once(self, sim_loop: SimulationLoop):
        start_calls: list[int] = []

        async def on_start(step: int):
            start_calls.append(step)

        sim_loop.on_start = on_start

        should_continue = await sim_loop.start()
        assert should_continue is True
        assert start_calls == [0]
        assert sim_loop.time_step == 0

        should_continue = await sim_loop.start()
        assert should_continue is True
        assert start_calls == [0]

    @pytest.mark.asyncio
    async def test_start_advances_after_initialization(self, sim_loop: SimulationLoop):
        step_calls: list[int] = []

        async def on_step(step: int):
            step_calls.append(step)

        sim_loop.on_step = on_step

        await sim_loop.start()  # initialize
        await sim_loop.start()  # advance one step

        assert step_calls == [0]
        assert sim_loop.time_step == 1

    @pytest.mark.asyncio
    async def test_step_once_advances(self, sim_loop: SimulationLoop):
        step_calls: list[int] = []

        async def on_step(step: int):
            step_calls.append(step)

        sim_loop.on_step = on_step

        await sim_loop.step_once()
        await sim_loop.step_once()

        assert step_calls == [0, 1]
        assert sim_loop.time_step == 2

    @pytest.mark.asyncio
    async def test_reset_clock(self, sim_loop: SimulationLoop):
        await sim_loop.step_once()
        await sim_loop.step_once()
        assert sim_loop.time_step == 2

        sim_loop.reset_clock()
        assert sim_loop.time_step == 0

    @pytest.mark.asyncio
    async def test_shutdown_is_noop(self, sim_loop: SimulationLoop):
        await sim_loop.shutdown()
        assert sim_loop.time_step == 0

    @pytest.mark.asyncio
    async def test_action_decorator_metadata(self, sim_loop: SimulationLoop):
        assert hasattr(sim_loop.start, "_tensnap_action")
        assert hasattr(sim_loop.step_once, "_tensnap_action")

        start_meta = getattr(sim_loop.start, "_tensnap_action")
        step_meta = getattr(sim_loop.step_once, "_tensnap_action")

        assert start_meta.id == "start"
        assert start_meta.continuous is True
        assert step_meta.id == "step"

    @pytest.mark.asyncio
    async def test_synchronous_callbacks(self, sim_loop: SimulationLoop):
        step_calls: list[int] = []

        def on_step_sync(step: int):
            step_calls.append(step)

        sim_loop.on_step = on_step_sync
        await sim_loop.step_once()

        assert step_calls == [0]
