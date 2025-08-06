import pytest
import asyncio
import json
import websockets
from unittest.mock import Mock, patch, AsyncMock
from tensnap.server import TenSnapServer, MessageType
from tensnap.models import Agent, GridEnvironment, Parameter


@pytest.fixture
def server():
    """Create a test server instance"""
    return TenSnapServer(host="localhost", port=8765)


@pytest.fixture
def grid_environment():
    """Create a test grid environment"""
    env = GridEnvironment(id="test_grid", width=10, height=10)
    env.add_agent(Agent(id="agent_1", x=5, y=5))
    return env


@pytest.mark.asyncio
async def test_server_initialization(server):
    """Test server initialization"""
    assert server.host == "localhost"
    assert server.port == 8765
    assert server.current_time == 0
    assert len(server.environments) == 0
    assert len(server.clients) == 0


@pytest.mark.asyncio
async def test_add_environment(server, grid_environment):
    """Test adding an environment to the server"""
    server.add_environment(grid_environment)
    assert "test_grid" in server.environments
    assert server.environments["test_grid"] == grid_environment


@pytest.mark.asyncio
async def test_add_parameter(server):
    """Test adding a parameter to the server"""
    param = Parameter(
        id="test_param",
        type="slider",
        label="Test Parameter",
        value=50,
        min=0,
        max=100,
        step=1
    )
    
    server.add_parameter(param)
    assert "test_param" in server.parameters
    assert server.parameters["test_param"] == param


@pytest.mark.asyncio
async def test_broadcast(server):
    """Test broadcasting messages to clients"""
    # Create mock websocket clients
    mock_client1 = AsyncMock()
    mock_client2 = AsyncMock()
    
    server.clients = {mock_client1, mock_client2}
    
    await server.broadcast(MessageType.TIME_STEP_START, {"time": 10})
    
    expected_message = json.dumps({
        "type": "time_step_start",
        "payload": {"time": 10},
        "timestamp": 0
    })
    
    mock_client1.send.assert_called_once_with(expected_message)
    mock_client2.send.assert_called_once_with(expected_message)


@pytest.mark.asyncio
async def test_update_environment(server):
    """Test updating environment data"""
    mock_client = AsyncMock()
    server.clients = {mock_client}
    
    await server.update_environment("test_env", {"width": 20, "height": 20})
    
    # Verify broadcast was called correctly
    call_args = mock_client.send.call_args[0][0]
    message = json.loads(call_args)
    
    assert message["type"] == "environment_update"
    assert message["payload"]["id"] == "test_env"
    assert message["payload"]["data"] == {"width": 20, "height": 20}


@pytest.mark.asyncio
async def test_update_agent(server):
    """Test updating single agent"""
    mock_client = AsyncMock()
    server.clients = {mock_client}
    
    await server.update_agent("env1", "agent1", {"x": 10, "y": 15})
    
    call_args = mock_client.send.call_args[0][0]
    message = json.loads(call_args)
    
    assert message["type"] == "agent_update"
    assert message["payload"]["environment_id"] == "env1"
    assert message["payload"]["agent_id"] == "agent1"
    assert message["payload"]["data"] == {"x": 10, "y": 15}


@pytest.mark.asyncio
async def test_parameter_change_handling(server):
    """Test handling parameter changes from client"""
    setter_mock = Mock()
    param = Parameter(
        id="test_param",
        type="slider",
        label="Test",
        value=50,
        setter=setter_mock
    )
    
    server.add_parameter(param)
    
    payload = {"id": "test_param", "value": 75}
    await server.handle_parameter_change(payload)
    
    setter_mock.assert_called_once_with(75)
    assert server.parameters["test_param"].value == 75


@pytest.mark.asyncio
async def test_button_click_handling(server):
    """Test handling button clicks from client"""
    handler_mock = Mock()
    server.register_button("test_action", handler_mock)
    
    payload = {"action": "test_action"}
    await server.handle_button_click(payload)
    
    handler_mock.assert_called_once()


def test_grid_environment_to_dict(grid_environment):
    """Test GridEnvironment serialization"""
    result = grid_environment.to_dict()
    
    assert result["id"] == "test_grid"
    assert result["type"] == "grid"
    assert result["width"] == 10
    assert result["height"] == 10
    assert len(result["agents"]) == 1
    assert result["agents"][0]["id"] == "agent_1"


def test_agent_operations(grid_environment):
    """Test agent operations in grid environment"""
    # Test getting agent
    agent = grid_environment.get_agent("agent_1")
    assert agent is not None
    assert agent.id == "agent_1"
    
    # Test adding agent
    new_agent = Agent(id="agent_2", x=3, y=3)
    grid_environment.add_agent(new_agent)
    assert len(grid_environment.agents) == 2
    
    # Test removing agent
    grid_environment.remove_agent("agent_1")
    assert len(grid_environment.agents) == 1
    assert grid_environment.get_agent("agent_1") is None