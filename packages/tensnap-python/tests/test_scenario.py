"""Tests for SimulationScenario functionality"""

import pytest
from unittest.mock import Mock, AsyncMock
from tensnap.scenario import (
    SimulationScenario,
    SimulationHandlerProtocol,
    DefaultSimulationHandler,
)
from tensnap.bindings.basic import NumberParameter, ActionParameter, chart, action, bind


class TestSimulationScenario:
    """Test SimulationScenario class"""

    @pytest.fixture
    def scenario(self):
        """Create a test scenario"""
        return SimulationScenario(
            host="localhost", port=8765, use_msgpack=False, step_interval=0.05
        )

    def test_initialization(self, scenario: SimulationScenario):
        """Test scenario is initialized correctly"""
        assert scenario.host == "localhost"
        assert scenario.port == 8765
        assert scenario.use_msgpack is False
        assert scenario.step_interval == 0.05
        assert scenario.server is not None
        assert scenario.sim_manager is not None
        assert len(scenario.env_binders) == 0

    def test_add_environment(self, scenario: SimulationScenario):
        """Test adding an environment to the scenario"""
        env = Mock()
        env.id = "test_env"
        env.get_model_dict = Mock(return_value={"id": "test_env", "type": "grid"})
        env.get_agent_list = Mock(return_value=[])

        scenario.add_environment(env)

        assert "test_env" in scenario.env_binders
        assert scenario.env_binders["test_env"] == env
        assert "test_env" in scenario.server.environments

    def test_remove_environment(self, scenario: SimulationScenario):
        """Test removing an environment from the scenario"""
        env = Mock()
        env.id = "test_env"
        env.get_model_dict = Mock(return_value={})
        env.get_agent_list = Mock(return_value=[])

        scenario.add_environment(env)
        assert "test_env" in scenario.env_binders

        scenario.remove_environment("test_env")
        assert "test_env" not in scenario.env_binders
        assert "test_env" not in scenario.server.environments

    def test_remove_all_environments(self, scenario: SimulationScenario):
        """Test removing all environments"""
        env1 = Mock()
        env1.id = "env1"
        env1.get_model_dict = Mock(return_value={})
        env1.get_agent_list = Mock(return_value=[])

        env2 = Mock()
        env2.id = "env2"
        env2.get_model_dict = Mock(return_value={})
        env2.get_agent_list = Mock(return_value=[])

        scenario.add_environment(env1)
        scenario.add_environment(env2)

        scenario.remove_all_environments()

        assert len(scenario.env_binders) == 0
        assert len(scenario.server.environments) == 0

    def test_add_parameters_from_dict(self, scenario: SimulationScenario):
        """Test adding parameters from a dictionary"""
        params = {
            "speed": 10.0,
            "name": "test",
            "enabled": True,
        }

        param_ids, action_ids = scenario.add_parameters(params)

        assert "speed" in param_ids
        assert "name" in param_ids
        assert "enabled" in param_ids
        assert "speed" in scenario.server.parameters
        assert "name" in scenario.server.parameters
        assert "enabled" in scenario.server.parameters

    def test_add_parameters_from_object(self, scenario: SimulationScenario):
        """Test adding parameters from an object"""

        class TestModel:
            def __init__(self):
                self.speed = 5.0
                self.count = 10

        model = TestModel()
        param_ids, action_ids = scenario.add_parameters(model)

        assert "speed" in param_ids
        assert "count" in param_ids

    def test_add_parameters_with_bind_decorator(self, scenario: SimulationScenario):
        """Test adding parameters with bind decorator"""

        class TestModel:
            def __init__(self):
                self._speed = 10.0

            @bind("number", id="model_speed", min=0.0, max=100.0)
            def speed(self):
                return self._speed

        model = TestModel()
        param_ids, action_ids = scenario.add_parameters(model)

        assert "model_speed" in param_ids
        assert "model_speed" in scenario.server.parameters

    def test_remove_parameters(self, scenario: SimulationScenario):
        """Test removing specific parameters"""
        params = {"speed": 10.0, "count": 5}
        param_ids, _ = scenario.add_parameters(params)

        scenario.remove_parameters(["speed"])

        assert "speed" not in scenario.server.parameters
        assert "count" in scenario.server.parameters

    def test_remove_all_parameters(self, scenario: SimulationScenario):
        """Test removing all parameters"""
        params = {"speed": 10.0, "count": 5}
        scenario.add_parameters(params)

        scenario.remove_all_parameters()

        assert (
            len([p for p in scenario.server.parameters.values() if p.type != "action"])
            == 0
        )

    def test_add_charts_from_class(self, scenario: SimulationScenario):
        """Test adding charts from a class"""

        class TestModel:
            @chart("population", "Population", color="#ff0000")
            def get_population(self):
                return 100

        model = TestModel()
        chart_ids = scenario.add_charts(model)

        assert "population" in chart_ids
        assert "population" in scenario.server.charts

    def test_add_charts_from_dict(self, scenario: SimulationScenario):
        """Test adding charts from dictionary"""

        @chart("value_chart", "Value", color="#00ff00")
        def get_value():
            return 42

        charts_dict = {"value": get_value}
        chart_ids = scenario.add_charts(charts_dict)

        assert "value_chart" in chart_ids

    def test_remove_charts(self, scenario: SimulationScenario):
        """Test removing specific charts"""

        @chart("chart1", "Chart 1")
        def get_chart1():
            return 1

        scenario.add_charts({"c1": get_chart1})
        scenario.remove_charts(["chart1"])

        assert "chart1" not in scenario.server.charts

    def test_remove_all_charts(self, scenario: SimulationScenario):
        """Test removing all charts"""

        @chart("chart1", "Chart 1")
        def get_chart1():
            return 1

        scenario.add_charts({"c1": get_chart1})
        scenario.remove_all_charts()

        assert len(scenario.server.charts) == 0

    def test_add_actions_with_register_self(self, scenario: SimulationScenario):
        """Test adding actions with self registration"""
        scenario.add_actions({}, register_self=True)

        # Should have default actions from sim_manager
        assert "start" in scenario.server.button_handlers
        assert "stop" in scenario.server.button_handlers
        assert "start_stop" in scenario.server.button_handlers
        assert "step" in scenario.server.button_handlers
        assert "reset" in scenario.server.button_handlers

    def test_add_actions_from_object(self, scenario: SimulationScenario):
        """Test adding actions from an object"""

        class TestModel:
            @action("test_action", "Test Action")
            async def do_something(self):
                pass

        model = TestModel()
        scenario.add_actions(model, register_self=False)

        assert "test_action" in scenario.server.button_handlers

    def test_remove_all_actions(self, scenario: SimulationScenario):
        """Test removing all actions"""
        scenario.add_actions({}, register_self=True)
        scenario.remove_all_actions(remove_parameters=True)

        assert len(scenario.server.button_handlers) == 0

    @pytest.mark.asyncio
    async def test_register_handler(self, scenario: SimulationScenario):
        """Test registering a simulation handler"""
        handler = Mock()
        handler.on_registered = AsyncMock()
        handler.on_start = AsyncMock()
        handler.on_step = AsyncMock()

        await scenario.register_handler(handler)

        assert scenario.handler == handler
        assert scenario.sim_manager.on_start == handler.on_start
        assert scenario.sim_manager.on_step == handler.on_step
        handler.on_registered.assert_called_once()

    @pytest.mark.asyncio
    async def test_register_model_handler(self, scenario: SimulationScenario):
        """Test registering a model handler"""
        model_init_called = {"value": False}
        model_step_called = {"value": False}

        def model_init():
            model_init_called["value"] = True

        def model_step():
            model_step_called["value"] = True

        await scenario.register_model_handler(
            model_init=model_init, model_step=model_step
        )

        assert isinstance(scenario.handler, DefaultSimulationHandler)
        assert scenario.handler.model_init == model_init
        assert scenario.handler.model_step == model_step


class TestDefaultSimulationHandler:
    """Test DefaultSimulationHandler class"""

    @pytest.fixture
    def scenario(self):
        """Create a test scenario"""
        return SimulationScenario()

    @pytest.fixture
    def handler(self, scenario: SimulationScenario):
        """Create a test handler"""
        return DefaultSimulationHandler()

    @pytest.mark.asyncio
    async def test_initialization(self):
        """Test handler initialization"""
        handler = DefaultSimulationHandler()
        assert handler.scenario is None
        assert handler.last_agent_ids is None

    @pytest.mark.asyncio
    async def test_on_registered(self, scenario: SimulationScenario):
        """Test handler registration"""
        handler = DefaultSimulationHandler()
        await handler.on_registered(scenario)

        assert handler.scenario == scenario

    @pytest.mark.asyncio
    async def test_send_updates(
        self, scenario: SimulationScenario, handler: DefaultSimulationHandler
    ):
        """Test sending updates"""
        await handler.on_registered(scenario)

        # Add a mock environment
        env = Mock()
        env.id = "test_env"
        env.get_model_dict = Mock(return_value={"x": 10})
        env.get_agent_list = Mock(return_value=[{"id": "agent1", "x": 5, "y": 5}])

        scenario.add_environment(env)

        # Mock the server methods
        scenario.server.update_environment = AsyncMock()
        scenario.server.update_agents_batch = AsyncMock()

        await handler.send_updates(replace_agents=False)

        scenario.server.update_environment.assert_called()
        scenario.server.update_agents_batch.assert_called()

    @pytest.mark.asyncio
    async def test_on_start(
        self, scenario: SimulationScenario, handler: SimulationHandlerProtocol
    ):
        """Test on_start handler"""
        await handler.on_registered(scenario)

        env = Mock()
        env.id = "test_env"
        env.get_model_dict = Mock(return_value={})
        env.get_agent_list = Mock(return_value=[])

        scenario.add_environment(env)

        scenario.server.start_time_step = AsyncMock()
        scenario.server.end_time_step = AsyncMock()
        scenario.server.update_environment = AsyncMock()
        scenario.server.update_agents_batch = AsyncMock()
        scenario.server.update_charts = AsyncMock()

        await handler.on_start(0)

        scenario.server.start_time_step.assert_called_with(0)
        scenario.server.end_time_step.assert_called_with(0)

    @pytest.mark.asyncio
    async def test_on_step(
        self, scenario: SimulationScenario, handler: DefaultSimulationHandler
    ):
        """Test on_step handler"""
        await handler.on_registered(scenario)

        step_called = {"value": False}

        def model_step():
            step_called["value"] = True

        handler.model_step = model_step

        scenario.server.start_time_step = AsyncMock()
        scenario.server.end_time_step = AsyncMock()
        scenario.server.update_environment = AsyncMock()
        scenario.server.update_agents_batch = AsyncMock()
        scenario.server.update_charts = AsyncMock()

        await handler.on_step(1)

        assert step_called["value"] is True

    @pytest.mark.asyncio
    async def test_on_reset(
        self, scenario: SimulationScenario, handler: DefaultSimulationHandler
    ):
        """Test on_reset handler"""
        await handler.on_registered(scenario)

        init_called = {"value": False}

        def model_init():
            init_called["value"] = True

        handler.model_init = model_init

        scenario.sim_manager.stop = AsyncMock()
        scenario.server.clear_charts = AsyncMock()
        scenario.server.start_time_step = AsyncMock()
        scenario.server.end_time_step = AsyncMock()
        scenario.server.update_environment = AsyncMock()
        scenario.server.update_agents_batch = AsyncMock()
        scenario.server.update_charts = AsyncMock()

        await handler.on_reset()

        assert init_called["value"] is True
        assert scenario.sim_manager.time_step == 0
        scenario.server.clear_charts.assert_called_once()
