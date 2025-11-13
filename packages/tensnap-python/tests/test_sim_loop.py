"""Tests for SimulationLoop functionality"""

import pytest
import asyncio
from tensnap.sim_loop import SimulationLoop


class TestSimulationLoop:
    """Test SimulationLoop class"""

    @pytest.fixture
    def sim_loop(self):
        """Create a test simulation loop"""
        return SimulationLoop(step_interval=0.01)

    def test_initialization(self, sim_loop: SimulationLoop):
        """Test simulation loop is initialized correctly"""
        assert sim_loop.running is False
        assert sim_loop.time_step == 0
        assert sim_loop.step_interval == 0.01
        assert sim_loop.simulation_task is None

    @pytest.mark.asyncio
    async def test_start_stop(self, sim_loop: SimulationLoop):
        """Test starting and stopping the simulation"""
        start_called = {"value": False, "step": None}

        async def on_start(step):
            start_called["value"] = True
            start_called["step"] = step

        sim_loop.on_start = on_start

        # Start the simulation
        await sim_loop.start()

        assert sim_loop.running is True
        assert start_called["value"] is True
        assert start_called["step"] == 0

        # Stop the simulation
        await sim_loop.stop()

        assert sim_loop.running is False

    @pytest.mark.asyncio
    async def test_start_from_specific_time_step(self, sim_loop: SimulationLoop):
        """Test starting from a specific time step"""
        start_step = {"value": None}

        async def on_start(step):
            start_step["value"] = step

        sim_loop.on_start = on_start

        await sim_loop.start(from_time_step=10)

        assert sim_loop.time_step == 10
        assert start_step["value"] == 10

        await sim_loop.stop()

    @pytest.mark.asyncio
    async def test_step_execution(self, sim_loop: SimulationLoop):
        """Test that steps are executed"""
        step_calls = []

        async def on_step(step):
            step_calls.append(step)
            if step >= 3:
                await sim_loop.stop()

        sim_loop.on_step = on_step

        await sim_loop.start()

        # Wait for a few steps
        await asyncio.sleep(0.1)

        # Ensure simulation stopped
        if sim_loop.running:
            await sim_loop.stop()

        # Check that multiple steps were called
        assert len(step_calls) >= 3
        assert step_calls[0] == 0
        assert step_calls[1] == 1

    @pytest.mark.asyncio
    async def test_step_once(self, sim_loop: SimulationLoop):
        """Test single step execution"""
        step_calls = []

        async def on_step(step):
            step_calls.append(step)

        sim_loop.on_step = on_step

        # Execute single steps
        await sim_loop.step_once()
        assert len(step_calls) == 1
        assert step_calls[0] == 0
        assert sim_loop.time_step == 1

        await sim_loop.step_once()
        assert len(step_calls) == 2
        assert step_calls[1] == 1
        assert sim_loop.time_step == 2

    @pytest.mark.asyncio
    async def test_toggle(self, sim_loop: SimulationLoop):
        """Test toggling simulation state"""
        step_calls = []

        async def on_start(step):
            pass

        async def on_step(step):
            step_calls.append(step)

        sim_loop.on_start = on_start
        sim_loop.on_step = on_step

        # Toggle on
        await sim_loop.toggle()
        assert sim_loop.running is True

        # Let it run for a bit
        await asyncio.sleep(0.05)

        # Toggle off
        await sim_loop.toggle()
        assert sim_loop.running is False

        step_count = len(step_calls)

        # Wait a bit more and verify no new steps
        await asyncio.sleep(0.05)
        assert len(step_calls) == step_count

    @pytest.mark.asyncio
    async def test_multiple_start_calls(self, sim_loop: SimulationLoop):
        """Test that multiple start calls don't cause issues"""
        start_count = {"value": 0}

        async def on_start(step):
            start_count["value"] += 1

        sim_loop.on_start = on_start

        await sim_loop.start()
        await sim_loop.start()  # Should not start again

        assert sim_loop.running is True
        assert start_count["value"] == 1

        await sim_loop.stop()

    @pytest.mark.asyncio
    async def test_stop_when_not_running(self, sim_loop: SimulationLoop):
        """Test that stopping when not running doesn't cause issues"""
        await sim_loop.stop()
        assert sim_loop.running is False

    @pytest.mark.asyncio
    async def test_on_stop_callback(self, sim_loop: SimulationLoop):
        """Test that on_stop callback is called"""
        stop_called = {"value": False, "step": None}

        async def on_stop(step):
            stop_called["value"] = True
            stop_called["step"] = step

        sim_loop.on_start = lambda step: None
        sim_loop.on_stop = on_stop

        await sim_loop.start()
        sim_loop.time_step = 5
        await sim_loop.stop()

        assert stop_called["value"] is True
        assert stop_called["step"] == 5

    @pytest.mark.asyncio
    async def test_operation_queue(self, sim_loop: SimulationLoop):
        """Test that operations are queued and executed in order"""
        execution_order = []

        async def on_start(step):
            execution_order.append(("start", step))

        async def on_step(step):
            execution_order.append(("step", step))

        sim_loop.on_start = on_start
        sim_loop.on_step = on_step

        # Queue multiple operations
        await sim_loop.start()
        await sim_loop.step_once()
        await sim_loop.stop()

        # Check execution order - step_once increments time_step before calling on_step
        assert execution_order[0] == ("start", 0)
        assert execution_order[1] == ("step", 0)

    @pytest.mark.asyncio
    async def test_shutdown(self, sim_loop: SimulationLoop):
        """Test shutdown cleans up resources"""
        sim_loop.on_start = lambda step: None
        sim_loop.on_step = lambda step: None

        await sim_loop.start()
        assert sim_loop.running is True

        await sim_loop.shutdown()

        assert sim_loop.running is False
        assert sim_loop._shutdown is True

        # Operations should fail after shutdown
        with pytest.raises(RuntimeError):
            await sim_loop.start()

    @pytest.mark.asyncio
    async def test_action_decorator_metadata(self, sim_loop: SimulationLoop):
        """Test that action methods have proper metadata"""
        assert hasattr(sim_loop.start, "_tensnap_action")
        assert hasattr(sim_loop.stop, "_tensnap_action")
        assert hasattr(sim_loop.toggle, "_tensnap_action")
        assert hasattr(sim_loop.step_once, "_tensnap_action")

        # Check action IDs
        assert getattr(sim_loop.start, "_tensnap_action").id == "start"
        assert getattr(sim_loop.stop, "_tensnap_action").id == "stop"
        assert getattr(sim_loop.toggle, "_tensnap_action").id == "start_stop"
        assert getattr(sim_loop.step_once, "_tensnap_action").id == "step"

    @pytest.mark.asyncio
    async def test_synchronous_callbacks(self, sim_loop: SimulationLoop):
        """Test that synchronous callbacks work correctly"""
        step_calls = []

        def on_step_sync(step):
            step_calls.append(step)

        sim_loop.on_step = on_step_sync

        await sim_loop.step_once()

        assert len(step_calls) == 1
        assert step_calls[0] == 0
