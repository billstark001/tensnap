# tensnap/bindings/basic/charts.py
"""Chart decorators and bindings"""

from typing import Any, Callable, Optional, Union, List, Dict

from dataclasses import dataclass, field


@dataclass
class Chart:
    """Chart configuration"""

    id: str
    label: str
    getter: Callable
    color: Optional[str] = None
    data: List[Dict[str, float]] = field(default_factory=list)


class ChartProperty:
    """Chart decorator that automatically calls getter and sends updates"""

    def __init__(self, chart: Chart, getter: Callable):
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
        chart_obj = Chart(id=id, label=label, getter=func, color=color)

        chart_property = ChartProperty(chart_obj, func)

        # Store chart info on the function for server registration
        func._tensnap_chart = chart_obj  # type: ignore

        return chart_property

    return decorator
