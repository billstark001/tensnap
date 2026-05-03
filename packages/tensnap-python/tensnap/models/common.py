"""Communication models for WebSocket interactions"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, TypeAlias

from typing_extensions import NotRequired, TypedDict

if TYPE_CHECKING:
    from .parameter import ParameterState
    from .environment import EnvironmentType
    from tensnap.bindings.basic.chart import ChartMetadataDict
    from tensnap.bindings.basic.parameter import ParameterType


# region Technical Type Definitions


ProjectorFieldForInit: TypeAlias = str | bool | None
ProjectorField: TypeAlias = str

# endregion


class StateSyncLayerSummary(TypedDict):
    layer_id: str
    layer_type: str


class StateSyncEnvSummary(TypedDict):
    """Environment state for communication"""

    id: str
    type: EnvironmentType
    layers: list[StateSyncLayerSummary]


class StateSyncRequest(TypedDict):
    request_id: NotRequired[str]
    parameters: list[ParameterState]
    actions: list[dict[str, Any]]
    envs: list[StateSyncEnvSummary]
    charts: list[ChartMetadataDict]


LogLevel: TypeAlias = Literal["debug", "info", "warning", "error"]


class LogPayload(TypedDict):
    """Log message payload"""

    level: LogLevel
    message: str
    target: NotRequired[str]
    timestamp: NotRequired[int]  # unix timestamp in milliseconds
