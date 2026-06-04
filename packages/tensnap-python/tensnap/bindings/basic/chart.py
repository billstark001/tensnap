# tensnap/bindings/basic/charts.py
"""Chart decorators, grouped-chart discovery, and compatibility exports."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Set, Tuple
from warnings import warn

from tensnap.models.chart import (
    ChartGroupMetadata as _ChartGroupMetadata,
    ChartGroupMetadataDict as _ChartGroupMetadataDict,
    ChartMetadata as _ChartMetadata,
    ChartMetadataDict as _ChartMetadataDict,
    ChartProperty as _ChartProperty,
    SimplifiedChartMetadata as _SimplifiedChartMetadata,
)
from tensnap.utils.object import infer_id_from_func_name

_TENSNAP_CHART_FIELD = "_tensnap_chart"

if TYPE_CHECKING:
    ChartMetadata = _ChartMetadata
    ChartGroupMetadata = _ChartGroupMetadata
    ChartMetadataDict = _ChartMetadataDict
    ChartGroupMetadataDict = _ChartGroupMetadataDict
    ChartProperty = _ChartProperty
    SimplifiedChartMetadata = _SimplifiedChartMetadata


def categorize_charts(
    client_charts: List[_ChartMetadataDict],
    server_charts: List[_ChartGroupMetadataDict],
):
    """
    Categorize server charts into added, removed, and updated groups.

    Added: Groups satisfying:
        - If the dataList length is 0, then the metadata IDs do not exist in client_charts.
        - If the length is non-zero, then all metadata IDs in this group do not exist in client_charts.
    Removed: Metadata IDs that exist in client_charts but do not exist in server_charts.
        - The definition of “does not exist” is similar to Added, determined by the dataList length.
    Updated: Groups that some of the metadata IDs in this group do not exist in client_charts.

    Returns:
        dict with keys 'added', 'removed', 'updated'
    """
    client_ids: Set[str] = {chart["id"] for chart in client_charts}

    added: List[_ChartGroupMetadataDict] = []
    updated: List[_ChartGroupMetadataDict] = []
    server_ids: Set[str] = set()

    for group in server_charts:
        data_list = group.get("dataList", [])

        if not data_list:
            server_ids.add(group["id"])
            if group["id"] not in client_ids:
                added.append(group)
        else:
            group_chart_ids = {chart["id"] for chart in data_list}
            server_ids.update(group_chart_ids)

            missing_count = sum(1 for cid in group_chart_ids if cid not in client_ids)

            if missing_count == len(group_chart_ids):
                added.append(group)
            elif missing_count > 0:
                updated.append(group)

    removed_ids = list(client_ids - server_ids)

    return {"added": added, "removed": removed_ids, "updated": updated}


def _convert_to_chart_metadata(obj: _SimplifiedChartMetadata) -> _ChartMetadata:
    """Convert simplified chart metadata to ChartMetadata object."""
    if isinstance(obj, str):
        metadata = _ChartMetadata(id=obj)
        metadata.refresh_label()
        return metadata
    if isinstance(obj, tuple):
        if len(obj) == 2:
            metadata = _ChartMetadata(id=obj[0], color=obj[1])
            metadata.refresh_label()
            return metadata
        if len(obj) == 3:
            metadata = _ChartMetadata(id=obj[0], color=obj[1], label=obj[2])
            metadata.refresh_label()
            return metadata
        raise ValueError(f"Invalid chart metadata tuple: {obj}")
    if isinstance(obj, dict):
        metadata = _ChartMetadata(
            id=obj["id"],
            label=obj.get("label", ""),
            color=obj.get("color"),
        )
        metadata.refresh_label()
        return metadata
    raise ValueError(f"Invalid chart metadata type: {type(obj)}")


def chart(
    id: Optional[str] = None,
    label: Optional[str] = None,
    color: Optional[str] = None,
    data_list: Optional[List[_SimplifiedChartMetadata]] = None,
) -> Callable[[Callable | property], _ChartProperty]:
    """Decorator to define a chart data getter."""

    def decorator(func: Callable | property) -> _ChartProperty:
        raw_getter = func.fget if isinstance(func, property) else func

        if raw_getter is None:
            raise ValueError("@chart cannot wrap a property without fget")

        chart_id = id or infer_id_from_func_name(raw_getter.__name__)

        chart_obj = _ChartGroupMetadata(
            id=chart_id,
            label=label or "",
            color=color,
            data_list=(
                [_convert_to_chart_metadata(data) for data in data_list]
                if data_list
                else None
            ),
        )

        chart_property = _ChartProperty(chart_obj, func)

        try:
            setattr(func, _TENSNAP_CHART_FIELD, chart_obj)
        except Exception:
            pass

        setattr(chart_property, _TENSNAP_CHART_FIELD, chart_obj)

        return chart_property

    return decorator


def _resolve_chart_property(attr: Any) -> _ChartProperty | None:
    if isinstance(attr, _ChartProperty):
        return attr
    if isinstance(attr, property) and isinstance(attr.fget, _ChartProperty):
        return attr.fget
    return None


def get_chart_metadata_from_namespace(namespace: Dict[str, Any]):
    """Find all chart-decorated functions/properties in a given namespace."""
    charts: List[Tuple[str, Callable, _ChartGroupMetadata]] = []

    for name, attr in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue

        param = None
        callable_attr = attr

        if hasattr(attr, _TENSNAP_CHART_FIELD):
            param = getattr(attr, _TENSNAP_CHART_FIELD)
        elif isinstance(attr, property) and attr.fget is not None:
            callable_attr = attr.fget
            if hasattr(attr.fget, _TENSNAP_CHART_FIELD):
                param = getattr(attr.fget, _TENSNAP_CHART_FIELD)

        if not isinstance(param, _ChartGroupMetadata):
            continue

        chart_property = _resolve_chart_property(attr)
        if chart_property is not None:
            if chart_property.group_owner is not None:
                continue
            if chart_property.has_group_members():
                callable_attr = (
                    lambda obj, chart_prop=chart_property: chart_prop.grouped_value(obj)
                )
                param = chart_property.chart

        charts.append((name, callable_attr, param))

    return charts


def __getattr__(name: str) -> Any:
    deprecated_exports = {
        "ChartMetadata": _ChartMetadata,
        "ChartGroupMetadata": _ChartGroupMetadata,
        "ChartMetadataDict": _ChartMetadataDict,
        "ChartGroupMetadataDict": _ChartGroupMetadataDict,
        "ChartProperty": _ChartProperty,
        "SimplifiedChartMetadata": _SimplifiedChartMetadata,
    }
    if name in deprecated_exports:
        warn(
            f"tensnap.bindings.basic.chart.{name} is deprecated; import {name} "
            "from tensnap.models instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return deprecated_exports[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ChartMetadata",
    "ChartGroupMetadata",
    "ChartMetadataDict",
    "ChartGroupMetadataDict",
    "ChartProperty",
    "SimplifiedChartMetadata",
    "categorize_charts",
    "chart",
    "get_chart_metadata_from_namespace",
    "_TENSNAP_CHART_FIELD",
]
