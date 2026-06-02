"""Communication models for WebSocket interactions"""

from __future__ import annotations

from collections.abc import Callable
from numbers import Number
from typing import TYPE_CHECKING, Any, Literal, TypeAlias

from typing_extensions import NotRequired, TypedDict

if TYPE_CHECKING:
    from tensnap.bindings.basic.chart import ChartMetadataDict

    from .environment import EnvironmentType
    from .parameter import ParameterState


# region Technical Type Definitions


class ProjectorFieldDirective:
    """Base marker for explicit projector-field directives."""


ProjectorScalarValue: TypeAlias = Number | str | bool | None
ProjectorFieldForInit: TypeAlias = (
    ProjectorScalarValue | Callable[[Any], Any] | ProjectorFieldDirective
)
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
