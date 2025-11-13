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
    TypedDict,
)
from typing_extensions import NotRequired

from dataclasses import dataclass


@dataclass
class ChartMetadata:
    """Chart configuration"""

    id: str
    label: str = ""
    color: Optional[str] = None

    def __post_init__(self):
        self.label = (
            self.label or self.id.replace("_", " ").replace("-", " ").title().strip()
        )

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
    """Chart decorator that automatically calls getter and sends updates"""

    def __init__(self, chart: ChartGroupMetadata, getter: Callable):
        self.chart = chart
        self.getter = getter
        self._tensnap_chart = chart  # Expose chart for server registration

    def __call__(self, *args, **kwargs) -> Any:
        """Call the getter function"""
        return self.getter(*args, **kwargs)

    def __get__(self, obj: Any, objtype: Optional[type] = None) -> "ChartProperty":
        if obj is None:
            return self
        return self


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
    id: str,
    label: str,
    color: Optional[str] = None,
    data_list: Optional[List[SimplifiedChartMetadata]] = None,
) -> Callable[[Callable], ChartProperty]:
    """Decorator to define a chart data getter"""

    def decorator(func: Callable[..., Union[float, int]]) -> ChartProperty:
        chart_obj = ChartGroupMetadata(
            id=id,
            label=label,
            color=color,
            data_list=(
                [_convert_to_chart_metadata(data) for data in data_list]
                if data_list
                else None
            ),
        )
        chart_property = ChartProperty(chart_obj, func)

        # Store chart info on the function for server registration
        func._tensnap_chart = chart_obj  # type: ignore

        return chart_property

    return decorator


def get_chart_metadata_from_namespace(namespace: Dict[str, Any]):
    """Find all chart-decorated functions in a given namespace"""
    charts: List[Tuple[str, Callable, ChartGroupMetadata]] = []
    for name, attr in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue
        if callable(attr) and hasattr(attr, "_tensnap_chart"):
            param = getattr(attr, "_tensnap_chart")
            if isinstance(param, ChartGroupMetadata):
                charts.append((name, attr, param))
    return charts
