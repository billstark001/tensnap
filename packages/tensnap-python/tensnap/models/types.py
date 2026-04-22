"""Communication models for WebSocket interactions"""

from typing import Any, Literal

from typing_extensions import NotRequired, TypedDict

from tensnap.bindings.basic import (
    ChartGroupMetadataDict,
    ChartMetadataDict,
    ParameterType,
)

from .environment import GraphEdgeDict


class StateSyncLayerSummary(TypedDict):
    layer_id: str
    layer_type: str


class ParameterState(TypedDict):
    """Parameter state for communication"""

    id: str
    type: ParameterType
    label: str
    allow_runtime_change: bool

    value: NotRequired[Any]  # last value cached by the renderer
    min: NotRequired[float]
    max: NotRequired[float]
    step: NotRequired[float]
    options: NotRequired[list[str]]


class EnvironmentStateWithAgentsOmitted(TypedDict):
    """Environment state for communication"""

    id: str
    type: Literal["uniform", "2d"]
    layers: list[StateSyncLayerSummary]


class StateSyncRequest(TypedDict):
    parameters: list[ParameterState]
    actions: list[dict]
    envs: list[EnvironmentStateWithAgentsOmitted]
    charts: list[ChartMetadataDict]


class LogPayload(TypedDict):
    """Log message payload"""

    level: Literal["debug", "info", "warning", "error"]
    message: str
    target: NotRequired[str]
    timestamp: NotRequired[int]  # unix timestamp in milliseconds
