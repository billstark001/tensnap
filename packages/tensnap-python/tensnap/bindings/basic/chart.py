# tensnap/bindings/basic/charts.py
"""Chart decorators and bindings"""

from typing import (
    Set,
    Any,
    Callable,
    Optional,
    Union,
    List,
    Dict,
    Tuple,
)
from typing_extensions import NotRequired, TypedDict

from dataclasses import dataclass

from tensnap.utils.object import infer_id_from_func_name, infer_label_from_id

_TENSNAP_CHART_FIELD = "_tensnap_chart"


@dataclass
class ChartMetadata:
    """Chart configuration"""

    id: str
    label: str = ""
    color: Optional[str] = None

    def refresh_label(self):
        if not self.label:
            self.label = infer_label_from_id(self.id)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "label": self.label,
        }
        if self.color is not None:
            d["color"] = self.color
        return d


@dataclass
class ChartGroupMetadata(ChartMetadata):
    """Chart group configuration"""

    data_list: List[ChartMetadata] | None = None

    def to_dict(self) -> Dict[str, Any]:
        d = super().to_dict()
        d["dataList"] = (
            [chart.to_dict() for chart in self.data_list] if self.data_list else None
        )
        return d


class ChartProperty:
    """Chart decorator that can also behave like a read-only property"""

    def __init__(self, chart: ChartGroupMetadata, getter: Callable | property):
        self.chart = chart
        setattr(
            self, _TENSNAP_CHART_FIELD, chart
        )  # Expose chart for server registration

        self._property = getter if isinstance(getter, property) else None
        self.getter = getter.fget if isinstance(getter, property) else getter

        if self.getter is None:
            raise ValueError("@chart cannot wrap a property without fget")

        # Helpful for introspection/debugging
        self.__name__ = getattr(self.getter, "__name__", chart.id)
        self.__doc__ = getattr(self.getter, "__doc__", None)

    def __call__(self, *args, **kwargs) -> Any:
        """Call the getter function"""
        return self.getter(*args, **kwargs)  # type: ignore

    def __get__(self, obj: Any, objtype: Optional[type] = None) -> Any:
        if obj is None:
            return self
        return self.getter(obj)  # type: ignore


class ChartMetadataDict(TypedDict):
    id: str
    label: NotRequired[str]
    color: NotRequired[str]


class ChartGroupMetadataDict(ChartMetadataDict):
    dataList: NotRequired[List[ChartMetadataDict]]


def categorize_charts(
    client_charts: List[ChartMetadataDict], server_charts: List[ChartGroupMetadataDict]
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
    # Build set of client chart IDs for fast lookup
    client_ids: Set[str] = {chart["id"] for chart in client_charts}

    added: List[ChartGroupMetadataDict] = []
    updated: List[ChartGroupMetadataDict] = []
    server_ids: Set[str] = set()

    for group in server_charts:
        data_list = group.get("dataList", [])

        if not data_list:
            # Treat as single chart
            server_ids.add(group["id"])
            if group["id"] not in client_ids:
                added.append(group)
        else:
            # Group with children
            group_chart_ids = {chart["id"] for chart in data_list}
            server_ids.update(group_chart_ids)

            missing_count = sum(1 for cid in group_chart_ids if cid not in client_ids)

            if missing_count == len(group_chart_ids):
                # All children are new
                added.append(group)
            elif missing_count > 0:
                # Some children are new
                updated.append(group)

    # Find removed: in client but not in server
    removed_ids = list(client_ids - server_ids)

    return {"added": added, "removed": removed_ids, "updated": updated}


SimplifiedChartMetadata = Union[
    str,  # id only
    Tuple[str, str],  # id and color
    Tuple[str, str, str],  # id, color, and label
    ChartMetadataDict,
]


def _convert_to_chart_metadata(obj: SimplifiedChartMetadata) -> ChartMetadata:
    """Convert simplified chart metadata to ChartMetadata object"""
    if isinstance(obj, str):
        return ChartMetadata(id=obj)
    elif isinstance(obj, tuple):
        if len(obj) == 2:
            return ChartMetadata(id=obj[0], color=obj[1])
        elif len(obj) == 3:
            return ChartMetadata(id=obj[0], color=obj[1], label=obj[2])
        else:
            raise ValueError(f"Invalid chart metadata tuple: {obj}")
    elif isinstance(obj, dict):
        return ChartMetadata(
            id=obj["id"],
            label=obj.get("label", ""),
            color=obj.get("color"),
        )
    else:
        raise ValueError(f"Invalid chart metadata type: {type(obj)}")


def chart(
    id: Optional[str] = None,
    label: Optional[str] = None,
    color: Optional[str] = None,
    data_list: Optional[List[SimplifiedChartMetadata]] = None,
) -> Callable[[Callable | property], ChartProperty]:
    """Decorator to define a chart data getter"""

    def decorator(func: Callable | property) -> ChartProperty:
        raw_getter = func.fget if isinstance(func, property) else func

        if raw_getter is None:
            raise ValueError("@chart cannot wrap a property without fget")

        chart_id = id or infer_id_from_func_name(raw_getter.__name__)

        chart_obj = ChartGroupMetadata(
            id=chart_id,
            label=label or "",
            color=color,
            data_list=(
                [_convert_to_chart_metadata(data) for data in data_list]
                if data_list
                else None
            ),
        )

        chart_property = ChartProperty(chart_obj, func)

        # Store chart info for server registration.
        # This works for normal functions and ChartProperty.
        try:
            setattr(func, _TENSNAP_CHART_FIELD, chart_obj)
        except Exception:
            # Built-in property objects usually cannot accept custom attrs.
            pass

        setattr(chart_property, _TENSNAP_CHART_FIELD, chart_obj)

        return chart_property

    return decorator


def get_chart_metadata_from_namespace(namespace: Dict[str, Any]):
    """Find all chart-decorated functions/properties in a given namespace"""
    charts: List[Tuple[str, Callable, ChartGroupMetadata]] = []

    for name, attr in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue

        param = None
        callable_attr = attr

        # Case 1:
        # @chart()
        # def prop(...)
        #
        # or:
        # @chart()
        # @property
        # def prop(...)
        if hasattr(attr, _TENSNAP_CHART_FIELD):
            param = getattr(attr, _TENSNAP_CHART_FIELD)

        # Case 2:
        # @property
        # @chart()
        # def prop(...)
        elif isinstance(attr, property) and attr.fget is not None:
            callable_attr = attr.fget
            if hasattr(attr.fget, _TENSNAP_CHART_FIELD):
                param = getattr(attr.fget, _TENSNAP_CHART_FIELD)

        if isinstance(param, ChartGroupMetadata):
            charts.append((name, callable_attr, param))

    return charts
