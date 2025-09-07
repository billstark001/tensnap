# tensnap/models/communication.py
"""Communication models for WebSocket interactions"""

from typing import Any, Dict, List, Optional, Union, Literal
from typing_extensions import TypedDict

from .agent import AgentModelDict
from .environment import GridEnvironmentModelDict, GraphNodeDict, GraphEdgeDict


class ParameterState(TypedDict):
    """Parameter state for communication"""

    id: str
    type: Literal["slider", "enum", "button"]
    label: str
    value: Any
    min: Optional[float]
    max: Optional[float]
    step: Optional[float]
    options: Optional[List[str]]
    allow_runtime_change: bool
    last_cached_value: Optional[Any]  # 客户端缓存的上次值


class EnvironmentState(TypedDict):
    """Environment state for communication"""

    id: Union[str, int]
    type: Literal["grid", "graph"]
    width: Optional[int]  # For grid environments
    height: Optional[int]  # For grid environments
    agents: List[AgentModelDict]
    nodes: Optional[List[GraphNodeDict]]  # For graph environments
    edges: Optional[List[GraphEdgeDict]]  # For graph environments
    background: Optional[str]  # Hex-encoded numpy array for grid backgrounds


class ChartState(TypedDict):
    """Chart state for communication - data field removed, managed entirely by client"""

    id: str
    label: str
    color: Optional[str]


class ClientStateRequest(TypedDict):
    """Client state request payload"""

    parameters: List[str]  # 参数ID列表
    environments: List[Union[str, int]]  # 环境ID列表
    charts: List[str]  # 图表ID列表
    parameter_cache: Dict[str, Any]  # 参数的缓存值


class StateSyncResponse(TypedDict):
    """State sync response payload - 统一的状态同步响应"""

    added_parameters: List[ParameterState]
    removed_parameters: List[str]
    updated_parameters: List[ParameterState]
    added_environments: List[EnvironmentState]
    removed_environments: List[Union[str, int]]
    updated_environments: List[EnvironmentState]
    added_charts: List[ChartState]
    removed_charts: List[str]
    updated_charts: List[ChartState]
