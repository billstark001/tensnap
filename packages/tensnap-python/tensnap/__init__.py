# tensnap/__init__.py
"""TenSnap - Agent-based model visualization toolkit"""

from .server import TenSnapServer, SimulationManager, add_simulation_manager_to_server
from .models import Agent, GridEnvironment, GraphEnvironment, Parameter
from .decorators import parameter, button, chart, bind_parameter, bind_parameters_batch, ParameterBinding

__version__ = "0.1.0"
__all__ = [
    "TenSnapServer",
    "SimulationManager", 
    "add_simulation_manager_to_server",
    "Agent",
    "GridEnvironment",
    "GraphEnvironment",
    "Parameter",
    "parameter",
    "button",
    "chart",
    "bind_parameter",
    "bind_parameters_batch",
    "ParameterBinding",
]


