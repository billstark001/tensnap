# tensnap/bindings/basic/__init__.py
"""Basic bindings for TenSnap - parameter, chart, and button decorators"""

from __future__ import annotations

from typing import Any
from warnings import warn

from tensnap.models.action import ActionMetadata as _ActionMetadata
from tensnap.models.chart import (
    ChartGroupMetadata as _ChartGroupMetadata,
    ChartGroupMetadataDict as _ChartGroupMetadataDict,
    ChartMetadata as _ChartMetadata,
    ChartMetadataDict as _ChartMetadataDict,
    ChartProperty as _ChartProperty,
    SimplifiedChartMetadata as _SimplifiedChartMetadata,
)

from .environment import (
    BindEnvironmentConfig,
    env,
)
from .layer import *

from .action import (
    action,
    get_action_metadata_from_namespace,
)
from .chart import (
    categorize_charts,
    chart,
    get_chart_metadata_from_namespace,
)
from .parameter import (
    BooleanParameter,
    EnumParameter,
    BindParametersConfig,
    BindParameterConfig,
    NumberParameter,
    Parameter,
    ParameterBinding,
    ParameterState,
    ParameterType,
    StringParameter,
    param,
    params,
    get_parameter_metadata_from_namespace,
    get_parameter_metadata_from_object,
)


def __getattr__(name: str) -> Any:
    deprecated_exports = {
        "ActionMetadata": _ActionMetadata,
        "ChartMetadata": _ChartMetadata,
        "ChartGroupMetadata": _ChartGroupMetadata,
        "ChartMetadataDict": _ChartMetadataDict,
        "ChartGroupMetadataDict": _ChartGroupMetadataDict,
        "ChartProperty": _ChartProperty,
        "SimplifiedChartMetadata": _SimplifiedChartMetadata,
    }
    if name in deprecated_exports:
        warn(
            f"tensnap.bindings.basic.{name} is deprecated; import {name} from "
            "tensnap.models instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return deprecated_exports[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
