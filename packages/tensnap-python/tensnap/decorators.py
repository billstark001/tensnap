
# tensnap/decorators.py
"""Decorators for easy parameter and chart definition"""

from typing import Any, Callable, Optional, List, TypeVar, overload, Union, Literal, Tuple, Dict, TypedDict
from typing_extensions import NotRequired
from functools import wraps
import types
from .models import Parameter, Chart

F = TypeVar('F', bound=Callable[..., Any])
T = TypeVar('T')


class ParameterBinding(TypedDict):
    """Type definition for parameter binding configuration"""
    key: str
    id: str
    label: str
    type: NotRequired[Literal["slider", "enum", "button"]]
    min: NotRequired[float]
    max: NotRequired[float]
    step: NotRequired[float]
    options: NotRequired[List[str]]
    default: NotRequired[Any]
    allow_runtime_change: NotRequired[bool]


class ParameterProperty:
    """Property-like parameter decorator that supports getter and setter"""
    
    def __init__(self, param: Parameter, getter: Optional[Callable] = None):
        self.param = param
        self._getter = getter
        self._setter = param.setter
        
    def __get__(self, obj: Any, objtype: Optional[type] = None) -> Any:
        if self._getter is None:
            return self.param.value
        if obj is None:
            return self
        return self._getter(obj)
    
    def __set__(self, obj: Any, value: Any) -> None:
        if self._setter is not None:
            self._setter(value)
        self.param.value = value
    
    def setter(self, func: Callable[[T], None]) -> 'ParameterProperty':
        """Add a setter function to the parameter property"""
        self._setter = func
        self.param.setter = func
        return self
    
    def getter(self, func: Callable[[Any], T]) -> 'ParameterProperty':
        """Add a getter function to the parameter property"""
        self._getter = func
        self.param.getter = func
        return self


@overload
def parameter(
    id: str,
    label: str,
    *,
    type: Literal["slider", "enum", "button"] = "slider",
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    default: Optional[T] = None,
    allow_runtime_change: bool = True
) -> Callable[[Callable[[], T]], ParameterProperty]: ...

@overload
def parameter(
    id: str,
    label: str,
    *,
    type: Literal["slider", "enum", "button"] = "slider",
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    default: Optional[T] = None,
    allow_runtime_change: bool = True
) -> Callable[[Callable[[Any], T]], ParameterProperty]: ...


def parameter(
    id: str,
    label: str,
    *,
    type: Literal["slider", "enum", "button"] = "slider",
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    default: Optional[Any] = None,
    allow_runtime_change: bool = True
) -> Callable:
    """Decorator to define a parameter property"""
    def decorator(func: Callable) -> ParameterProperty:
        param = Parameter(
            id=id,
            type=type,
            label=label,
            value=default,
            min=min,
            max=max,
            step=step,
            options=options,
            allow_runtime_change=allow_runtime_change,
            getter=func if func.__code__.co_argcount <= 1 else None
        )
        
        return ParameterProperty(param, func if func.__code__.co_argcount <= 1 else None)
        
    return decorator


def button(id: str, label: str, allow_runtime_change: bool = True) -> Callable[[F], F]:
    """Decorator to define a button"""
    def decorator(func: F) -> F:
        param = Parameter(
            id=id,
            type="button",
            label=label,
            allow_runtime_change=allow_runtime_change
        )
        
        # Store parameter and action info on the function
        func._tensnap_parameter = param  # type: ignore
        func._tensnap_button_action = id  # type: ignore
        return func
        
    return decorator


class ChartProperty:
    """Chart decorator that automatically calls getter and sends updates"""
    
    def __init__(self, chart: Chart, getter: Callable):
        self.chart = chart
        self.getter = getter
        self._tensnap_chart = chart  # Expose chart for server registration
        
    def __call__(self, *args, **kwargs) -> Any:
        """Call the getter function"""
        return self.getter(*args, **kwargs)
    
    def __get__(self, obj: Any, objtype: Optional[type] = None) -> 'ChartProperty':
        if obj is None:
            return self
        return self


def chart(
    id: str, 
    label: str, 
    color: Optional[str] = None,
    unit: Optional[str] = None
) -> Callable[[Callable[..., Union[float, int]]], ChartProperty]:
    """Decorator to define a chart data getter"""
    def decorator(func: Callable[..., Union[float, int]]) -> ChartProperty:
        chart_obj = Chart(
            id=id,
            label=label,
            getter=func,
            color=color
        )
        
        chart_property = ChartProperty(chart_obj, func)
        
        # Store chart info on the function for server registration
        func._tensnap_chart = chart_obj  # type: ignore
        
        return chart_property
        
    return decorator


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


def bind_parameter(
    target: Union[Dict[str, Any], object, types.ModuleType],
    key: str,
    id: str,
    label: str,
    *,
    type: Literal["slider", "enum", "button"] = "slider",
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    default: Optional[Any] = None,
    allow_runtime_change: bool = True
) -> Parameter:
    """
    Bind a parameter to a dictionary key, object attribute, or module attribute
    
    Args:
        target: Dictionary, object, or module to bind to
        key: Key/attribute name to bind
        id: Parameter ID for the UI
        label: Display label for the parameter
        type: Parameter type (slider, enum, button)
        min, max, step: For slider parameters
        options: For enum parameters
        default: Default value (if key doesn't exist)
        allow_runtime_change: Whether parameter can be changed during runtime
        
    Returns:
        Parameter object that can be registered with TenSnapServer
    """
    
    def getter() -> Any:
        if isinstance(target, dict):
            return target.get(key, default)
        else:
            return getattr(target, key, default)
    
    def setter(value: Any) -> None:
        if isinstance(target, dict):
            target[key] = value
        else:
            setattr(target, key, value)
    
    # Get initial value
    initial_value = getter()
    if initial_value is None:
        initial_value = default
        setter(initial_value)  # Set default if not exists
    
    param = Parameter(
        id=id,
        type=type,
        label=label,
        value=initial_value,
        min=min,
        max=max,
        step=step,
        options=options,
        allow_runtime_change=allow_runtime_change,
        getter=getter,
        setter=setter
    )
    
    return param


def bind_parameters_batch(
    target: Union[Dict[str, Any], object, types.ModuleType],
    bindings: List[ParameterBinding]
) -> List[Parameter]:
    """
    Batch bind multiple parameters to a target
    
    Args:
        target: Dictionary, object, or module to bind to
        bindings: List of parameter binding configurations
            
    Returns:
        List of Parameter objects
    """
    parameters = []
    
    for binding in bindings:
        # Extract key and create a copy without it for unpacking
        key = binding['key']
        # Type-safe parameter extraction
        param = bind_parameter(
            target=target,
            key=key,
            id=binding['id'],
            label=binding['label'],
            type=binding.get('type', 'slider'),
            min=binding.get('min'),
            max=binding.get('max'),
            step=binding.get('step'),
            options=binding.get('options'),
            default=binding.get('default'),
            allow_runtime_change=binding.get('allow_runtime_change', True)
        )
        parameters.append(param)
        
    return parameters
