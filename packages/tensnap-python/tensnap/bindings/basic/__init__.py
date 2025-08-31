# tensnap/bindings/basic/__init__.py
"""Basic bindings for TenSnap - parameter, chart, and button decorators"""

from .parameters import (
    parameter,
    bind_parameter,
    bind_parameters_batch,
    auto_detect_parameters,
    quick_bind,
    generate_binding_code,
    Parameter,
    ParameterBinding,
    ParameterProperty,
    AutoDetectConfig,
    ParameterBindingGenerator
)

from .charts import (
    chart,
    Chart,
    ChartProperty
)

from .buttons import (
    button
)

from .registry import (
    register_global_parameter,
    register_global_chart,
    register_global_button,
    get_global_parameters,
    get_global_charts,
    get_global_buttons,
    clear_global_registry
)

__all__ = [
    # Parameters
    'parameter',
    'bind_parameter',
    'bind_parameters_batch',
    'auto_detect_parameters',
    'quick_bind',
    'generate_binding_code',
    'Parameter',
    'Chart',
    'ParameterBinding',
    'ParameterProperty',
    'AutoDetectConfig',
    'ParameterBindingGenerator',
    
    # Charts
    'chart',
    'ChartProperty',
    
    # Buttons
    'button',
    
    # Registry
    'register_global_parameter',
    'register_global_chart',
    'register_global_button',
    'get_global_parameters',
    'get_global_charts',
    'get_global_buttons',
    'clear_global_registry'
]
