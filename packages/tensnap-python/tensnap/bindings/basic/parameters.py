# tensnap/bindings/basic/parameters.py
"""Enhanced parameter decorators and bindings with automatic detection"""

from typing import Any, Callable, Optional, List, TypeVar, overload, Union, Literal, Dict, Set
from dataclasses import dataclass, field
import types
import ast
import inspect
from pathlib import Path

T = TypeVar('T')


@dataclass
class Parameter:
    """Simulation parameter"""
    id: str
    type: Literal["slider", "enum", "button"]
    label: str
    value: Optional[Union[float, str]] = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[List[str]] = None
    setter: Optional[Callable] = None
    getter: Optional[Callable] = None
    allow_runtime_change: bool = True


@dataclass
class ParameterBinding:
    """Enhanced parameter binding configuration with dataclass"""
    key: str
    id: str
    label: str
    type: Literal["slider", "enum", "button"] = "slider"
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[List[str]] = None
    default: Optional[Any] = None
    allow_runtime_change: bool = True
    
    def __post_init__(self):
        """Auto-infer parameter properties from default value"""
        if self.default is not None and self.min is None and self.max is None:
            if isinstance(self.default, (int, float)):
                # Auto-infer reasonable ranges for numeric values
                if isinstance(self.default, bool):
                    self.type = "button"
                elif self.default == 0:
                    self.min = 0
                    self.max = 100
                    self.step = 1 if isinstance(self.default, int) else 0.1
                else:
                    # Use default as a reference point
                    abs_val = abs(self.default)
                    self.min = 0 if self.default >= 0 else -abs_val * 2
                    self.max = abs_val * 2 if abs_val > 0 else 10
                    self.step = 1 if isinstance(self.default, int) else abs_val * 0.1


@dataclass 
class AutoDetectConfig:
    """Configuration for automatic parameter detection"""
    include_fields: Optional[Set[str]] = None
    exclude_fields: Optional[Set[str]] = None
    numeric_only: bool = True
    include_private: bool = False
    custom_bindings: Optional[Dict[str, ParameterBinding]] = None
    
    def __post_init__(self):
        if self.include_fields is None:
            self.include_fields = set()
        if self.exclude_fields is None:
            self.exclude_fields = set()
        if self.custom_bindings is None:
            self.custom_bindings = {}


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
        # Extract attributes from dataclass
        param = bind_parameter(
            target=target,
            key=binding.key,
            id=binding.id,
            label=binding.label,
            type=binding.type,
            min=binding.min,
            max=binding.max,
            step=binding.step,
            options=binding.options,
            default=binding.default,
            allow_runtime_change=binding.allow_runtime_change
        )
        parameters.append(param)
        
    return parameters


def auto_detect_parameters(
    target: Union[Dict[str, Any], object, types.ModuleType],
    config: Optional[AutoDetectConfig] = None
) -> List[Parameter]:
    """
    Automatically detect and bind parameters from a target object
    
    Args:
        target: Dictionary, object, or module to analyze
        config: Configuration for detection behavior
        
    Returns:
        List of automatically detected Parameter objects
    """
    if config is None:
        config = AutoDetectConfig()
    
    parameters = []
    
    # Get all attributes/keys
    if isinstance(target, dict):
        items = target.items()
    elif isinstance(target, types.ModuleType):
        items = [(name, getattr(target, name)) for name in dir(target) 
                 if not name.startswith('_') or config.include_private]
    else:
        items = [(name, getattr(target, name)) for name in dir(target)
                 if not name.startswith('_') or config.include_private]
    
    for key, value in items:
        # Apply filters
        if config.include_fields and key not in config.include_fields:
            continue
        if config.exclude_fields and key in config.exclude_fields:
            continue
        
        # Skip functions, methods, and classes
        if callable(value) or inspect.isclass(value):
            continue
            
        # Use custom binding if available
        if config.custom_bindings and key in config.custom_bindings:
            custom_binding = config.custom_bindings[key]
            param = bind_parameter(
                target=target,
                key=custom_binding.key,
                id=custom_binding.id,
                label=custom_binding.label,
                type=custom_binding.type,
                min=custom_binding.min,
                max=custom_binding.max,
                step=custom_binding.step,
                options=custom_binding.options,
                default=custom_binding.default,
                allow_runtime_change=custom_binding.allow_runtime_change
            )
            parameters.append(param)
            continue
        
        # Auto-detect numeric parameters
        if config.numeric_only and not isinstance(value, (int, float, bool)):
            continue
            
        # Create automatic binding
        binding = ParameterBinding(
            key=key,
            id=key,
            label=key.replace('_', ' ').title(),
            default=value
        )
        
        param = bind_parameter(
            target=target,
            key=binding.key,
            id=binding.id,
            label=binding.label,
            type=binding.type,
            min=binding.min,
            max=binding.max,
            step=binding.step,
            options=binding.options,
            default=binding.default,
            allow_runtime_change=binding.allow_runtime_change
        )
        parameters.append(param)
    
    return parameters


class ParameterBindingGenerator:
    """AST-based generator for creating explicit parameter bindings"""
    
    def __init__(self):
        self.detected_bindings: List[ParameterBinding] = []
    
    def analyze_object(
        self, 
        target: Union[Dict[str, Any], object, types.ModuleType],
        config: Optional[AutoDetectConfig] = None
    ) -> List[ParameterBinding]:
        """Analyze an object and generate ParameterBinding configurations"""
        if config is None:
            config = AutoDetectConfig()
            
        bindings = []
        
        # Get all attributes/keys
        if isinstance(target, dict):
            items = target.items()
        elif isinstance(target, types.ModuleType):
            items = [(name, getattr(target, name)) for name in dir(target) 
                     if not name.startswith('_') or config.include_private]
        else:
            items = [(name, getattr(target, name)) for name in dir(target)
                     if not name.startswith('_') or config.include_private]
        
        for key, value in items:
            # Apply filters
            if config.include_fields and key not in config.include_fields:
                continue
            if config.exclude_fields and key in config.exclude_fields:
                continue
                
            # Skip functions, methods, and classes
            if callable(value) or inspect.isclass(value):
                continue
                
            # Use custom binding if available
            if config.custom_bindings and key in config.custom_bindings:
                bindings.append(config.custom_bindings[key])
                continue
            
            # Auto-detect numeric parameters
            if config.numeric_only and not isinstance(value, (int, float, bool)):
                continue
                
            # Create binding configuration
            binding = ParameterBinding(
                key=key,
                id=key,
                label=key.replace('_', ' ').title(),
                default=value
            )
            bindings.append(binding)
        
        self.detected_bindings = bindings
        return bindings
    
    def generate_code(self, var_name: str = "parameters") -> str:
        """Generate Python code for the detected parameter bindings"""
        if not self.detected_bindings:
            return f"{var_name} = []"
        
        lines = [f"{var_name} = ["]
        
        for binding in self.detected_bindings:
            lines.append("    ParameterBinding(")
            lines.append(f'        key="{binding.key}",')
            lines.append(f'        id="{binding.id}",')
            lines.append(f'        label="{binding.label}",')
            
            if binding.type != "slider":
                lines.append(f'        type="{binding.type}",')
            if binding.min is not None:
                lines.append(f"        min={binding.min},")
            if binding.max is not None:
                lines.append(f"        max={binding.max},")
            if binding.step is not None:
                lines.append(f"        step={binding.step},")
            if binding.options is not None:
                lines.append(f"        options={binding.options!r},")
            if binding.default is not None:
                lines.append(f"        default={binding.default!r},")
            if not binding.allow_runtime_change:
                lines.append(f"        allow_runtime_change={binding.allow_runtime_change},")
                
            lines.append("    ),")
        
        lines.append("]")
        return "\n".join(lines)
    
    def save_to_file(self, filepath: Union[str, Path], var_name: str = "parameters") -> None:
        """Save the generated code to a Python file"""
        code = self.generate_code(var_name)
        imports = [
            "from tensnap.bindings.basic import ParameterBinding",
            "",
            ""
        ]
        
        full_code = "\n".join(imports) + code
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(full_code)


# Convenience functions
def quick_bind(
    target: Union[Dict[str, Any], object, types.ModuleType],
    include: Optional[List[str]] = None,
    exclude: Optional[List[str]] = None,
    custom: Optional[Dict[str, ParameterBinding]] = None
) -> List[Parameter]:
    """Quick parameter binding with simple include/exclude lists"""
    config = AutoDetectConfig(
        include_fields=set(include) if include else None,
        exclude_fields=set(exclude) if exclude else None,
        custom_bindings=custom
    )
    return auto_detect_parameters(target, config)


def generate_binding_code(
    target: Union[Dict[str, Any], object, types.ModuleType],
    include: Optional[List[str]] = None,
    exclude: Optional[List[str]] = None,
    custom: Optional[Dict[str, ParameterBinding]] = None
) -> str:
    """Generate binding code for the target object"""
    config = AutoDetectConfig(
        include_fields=set(include) if include else None,
        exclude_fields=set(exclude) if exclude else None,
        custom_bindings=custom
    )
    
    generator = ParameterBindingGenerator()
    generator.analyze_object(target, config)
    return generator.generate_code()
