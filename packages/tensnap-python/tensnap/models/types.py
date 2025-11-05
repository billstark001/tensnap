# tensnap/models/communication.py
"""Communication models for WebSocket interactions"""

from typing import Any, List, Optional, Union, Literal, NotRequired
from typing_extensions import TypedDict, NotRequired

from .environment import GraphEdgeDict
from tensnap.bindings.basic import ChartMetadataDict, ChartGroupMetadataDict, ParameterType


class ParameterState(TypedDict):
    """Parameter state for communication"""

    id: str
    type: ParameterType
    label: str
    allow_runtime_change: bool
    
    value: NotRequired[Any] # 客户端缓存的上次值
    min: NotRequired[float]
    max: NotRequired[float]
    step: NotRequired[float]
    options: NotRequired[List[str]]


class EnvironmentStateWithAgentsOmitted(TypedDict):
    """Environment state for communication"""

    id: str
    type: Literal["grid", "graph", "uniform"]
    label: str

    width: NotRequired[int]  # For grid environments
    height: NotRequired[int]  # For grid environments
    background: NotRequired[str]  # Hex-encoded numpy array for grid backgrounds
    
    edges: NotRequired[List[GraphEdgeDict]]  # For graph environments


class StateSyncRequest(TypedDict):
    parameters: List[ParameterState]
    environments: List[EnvironmentStateWithAgentsOmitted]
    charts: List[ChartMetadataDict]


class StateSyncResponse(TypedDict):

    mode: NotRequired[Literal["full", "incremental"]]

    added_parameters: List[ParameterState]
    removed_parameters: List[str]
    updated_parameters: List[ParameterState]

    added_environments: List[EnvironmentStateWithAgentsOmitted]
    removed_environments: List[Union[str, int]]
    updated_environments: List[EnvironmentStateWithAgentsOmitted]

    added_charts: List[ChartGroupMetadataDict]
    removed_charts: List[str]
    updated_charts: List[ChartGroupMetadataDict]

    clear_charts: NotRequired[
        bool | List[str]
    ]  # true means clear all charts, string[] means clear specific charts by IDs


class LogPayload(TypedDict):
    """Log message payload"""

    level: Literal["debug", "info", "warning", "error"]
    message: str
    target: NotRequired[str]
    timestamp: NotRequired[int]  # unix timestamp in milliseconds
