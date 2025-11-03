# tensnap/__init__.py
"""TenSnap - Agent-based model visualization toolkit"""

from .server import TenSnapServer
from .simulation import SimulationManager
from .models import *
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
    
    "AgentModelDict",
    "UniformAgentModelDict",
    "GridAgentModelDict",
    "GraphAgentModelDict",
    "make_uniform_agent_accessor",
    "make_grid_agent_accessor",
    "make_graph_agent_accessor",
    "make_graph_agent_accessor_nx",
    
    "GraphEdgeDict",
    "make_graph_edge_accessor_nx",
    "PureUniformEnvironmentModel",
    "PureGridEnvironmentModel",
    "PureGraphEnvironmentModel",
    "make_uniform_environment_accessor",
    "make_grid_environment_accessor",
    "make_graph_edge_accessor_nx",
    "UniformEnvironmentBinder",
    "GridEnvironmentBinder",
    "NXGraphEnvironmentBinder",
    
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
