# tensnap/bindings/basic/charts.py
"""Chart decorators and bindings"""

from typing import Any, Callable, Optional, Union, List, Dict, Tuple

from dataclasses import dataclass, field


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


def chart(
    id: str, label: str, color: Optional[str] = None, unit: Optional[str] = None
) -> Callable[[Callable[..., Union[float, int]]], ChartProperty]:
    """Decorator to define a chart data getter"""

    def decorator(func: Callable[..., Union[float, int]]) -> ChartProperty:
        chart_obj = ChartGroupMetadata(id=id, label=label, color=color)
        chart_property = ChartProperty(chart_obj, func)

        # Store chart info on the function for server registration
        func._tensnap_chart = chart_obj  # type: ignore

        return chart_property

    return decorator


def get_chart_metadata_from_namespace(namespace: Dict[str, Any]):
    """Find all chart-decorated functions in a given namespace"""
    charts: List[Tuple[str, Callable, ChartGroupMetadata]] = []
    for name, attr in namespace.items():
        if callable(attr) and hasattr(attr, "_tensnap_chart"):
            param = getattr(attr, "_tensnap_chart")
            if isinstance(param, ChartGroupMetadata):
                charts.append((name, attr, param))
    return charts
