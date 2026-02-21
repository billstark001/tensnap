"""Communication models for WebSocket interactions"""

from typing import Any, Literal

from typing_extensions import NotRequired, TypedDict

from tensnap.bindings.basic import (
    ChartGroupMetadataDict,
    ChartMetadataDict,
    ParameterType,
)

from .environment import GraphEdgeDict


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
    options: NotRequired[list[str]]


class EnvironmentStateWithAgentsOmitted(TypedDict):
    """Environment state for communication"""

    id: str
    type: Literal["grid", "graph", "uniform"]
    label: str

    width: NotRequired[int]  # For grid environments
    height: NotRequired[int]  # For grid environments
    background: NotRequired[str]  # Hex-encoded numpy array for grid backgrounds
    
    edges: NotRequired[list[GraphEdgeDict]]  # For graph environments


class StateSyncRequest(TypedDict):
    parameters: list[ParameterState]
    actions: list[dict]
    envs: list[dict]
    charts: list[ChartMetadataDict]


class LogPayload(TypedDict):
    """Log message payload"""

    level: Literal["debug", "info", "warning", "error"]
    message: str
    target: NotRequired[str]
    timestamp: NotRequired[int]  # unix timestamp in milliseconds
