# tensnap/bindings/basic/buttons.py
"""Button decorators and bindings"""

from typing import Any, Callable, TypeVar
from .parameters import Parameter

F = TypeVar('F', bound=Callable[..., Any])


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
