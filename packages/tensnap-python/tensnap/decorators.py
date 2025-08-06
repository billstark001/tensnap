
# tensnap/decorators.py
"""Decorators for easy parameter and chart definition"""

from typing import Any, Callable, Optional, List
from functools import wraps
from .models import Parameter, Chart


def parameter(
    id: str,
    label: str,
    type: str = "slider",
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    default: Optional[Any] = None
) -> Callable:
    """Decorator to define a parameter"""
    def decorator(func: Callable) -> Callable:
        param = Parameter(
            id=id,
            type=type,
            label=label,
            value=default,
            min=min,
            max=max,
            step=step,
            options=options,
            setter=func
        )
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
            
        wrapper._tensnap_parameter = param
        return wrapper
        
    return decorator


def button(id: str, label: str) -> Callable:
    """Decorator to define a button"""
    def decorator(func: Callable) -> Callable:
        param = Parameter(
            id=id,
            type="button",
            label=label,
            action=id
        )
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
            
        wrapper._tensnap_parameter = param
        wrapper._tensnap_button_action = id
        return wrapper
        
    return decorator


def chart(id: str, label: str, color: Optional[str] = None) -> Callable:
    """Decorator to define a chart data getter"""
    def decorator(func: Callable) -> Callable:
        chart_obj = Chart(
            id=id,
            label=label,
            getter=func,
            color=color
        )
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
            
        wrapper._tensnap_chart = chart_obj
        return wrapper
        
    return decorator
