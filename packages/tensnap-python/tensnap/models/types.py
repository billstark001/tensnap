# tensnap/models/communication.py
"""Communication models for WebSocket interactions"""

from typing import Any, List, Optional, Union, Literal
from typing_extensions import TypedDict, NotRequired

from .environment import GraphEdgeDict


class ParameterState(TypedDict):
    """Parameter state for communication"""

    id: str
    type: Literal["number", "enum", "action"]
    label: str
    value: Any
    min: Optional[float]
    max: Optional[float]
    step: Optional[float]
    options: Optional[List[str]]
    allow_runtime_change: bool
    last_cached_value: Optional[Any]  # 客户端缓存的上次值


class EnvironmentWithAgentsOmitted(TypedDict):
    """Environment state for communication"""

    id: Union[str, int]
    type: Literal["grid", "graph", "uniform"]

    width: Optional[int]  # For grid environments
    height: Optional[int]  # For grid environments
    edges: Optional[List[GraphEdgeDict]]  # For graph environments
    background: Optional[str]  # Hex-encoded numpy array for grid backgrounds


class ChartMetadata(TypedDict):
    id: str
    label: str
    color: NotRequired[str]


class StateSyncRequest(TypedDict):
    parameters: List[ParameterState]
    environments: List[EnvironmentWithAgentsOmitted]
    charts: List[ChartMetadata]


class StateSyncResponse(TypedDict):

    mode: NotRequired[Literal["full", "incremental"]]

    added_parameters: List[ParameterState]
    removed_parameters: List[str]
    updated_parameters: List[ParameterState]

    added_environments: List[EnvironmentWithAgentsOmitted]
    removed_environments: List[Union[str, int]]
    updated_environments: List[EnvironmentWithAgentsOmitted]

    added_charts: List[ChartMetadata]
    removed_charts: List[str]
    updated_charts: List[ChartMetadata]

    clear_charts: NotRequired[
        bool | List[str]
    ]  # true means clear all charts, string[] means clear specific charts by IDs


class LogPayload(TypedDict):
    """Log message payload"""

    level: Literal["debug", "info", "warning", "error"]
    message: str
    target: NotRequired[str]
    timestamp: NotRequired[int]  # unix timestamp in milliseconds
