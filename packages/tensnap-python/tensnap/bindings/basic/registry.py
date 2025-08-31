# tensnap/bindings/basic/registry.py
"""Global registry for module-level decorators"""

from typing import List, Tuple, Callable
from .parameters import Parameter
from .charts import Chart

# Global registry for module-level decorators
_global_parameters: List[Parameter] = []
_global_charts: List[Chart] = []
_global_buttons: List[Tuple[str, Callable]] = []


def register_global_parameter(param: Parameter) -> None:
    """Register a parameter globally"""
    _global_parameters.append(param)


def register_global_chart(chart: Chart) -> None:
    """Register a chart globally"""
    _global_charts.append(chart)


def register_global_button(action: str, handler: Callable) -> None:
    """Register a button handler globally"""
    _global_buttons.append((action, handler))


def get_global_parameters() -> List[Parameter]:
    """Get all globally registered parameters"""
    return _global_parameters.copy()


def get_global_charts() -> List[Chart]:
    """Get all globally registered charts"""
    return _global_charts.copy()


def get_global_buttons() -> List[Tuple[str, Callable]]:
    """Get all globally registered button handlers"""
    return _global_buttons.copy()


def clear_global_registry() -> None:
    """Clear all global registrations"""
    _global_parameters.clear()
    _global_charts.clear()
    _global_buttons.clear()
