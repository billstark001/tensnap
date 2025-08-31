# tensnap/__init__.py
"""TenSnap - Agent-based model visualization toolkit"""

from .server import TenSnapServer, SimulationManager, add_simulation_manager_to_server
from .models import AgentModel, GridEnvironmentModel, GraphEnvironmentModel
from .bindings.basic import (
    parameter,
    button,
    chart,
    bind_parameter,
    bind_parameters_batch,
    ParameterBinding,
    Parameter,
)

# Also expose the property classes for advanced users
from .bindings.basic import ParameterProperty, ChartProperty

__version__ = "0.1.0"
__all__ = [
    "TenSnapServer",
    "SimulationManager",
    "add_simulation_manager_to_server",
    "AgentModel",
    "GridEnvironmentModel",
    "GraphEnvironmentModel",
    "Parameter",
    "parameter",
    "button",
    "chart",
    "bind_parameter",
    "bind_parameters_batch",
    "ParameterBinding",
    "ParameterProperty",
    "ChartProperty",
]
