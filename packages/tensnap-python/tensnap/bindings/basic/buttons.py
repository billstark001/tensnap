# tensnap/bindings/basic/buttons.py
"""Button decorators and bindings"""

from typing import Any, Callable, TypeVar

from asyncio import iscoroutinefunction
from inspect import ismethod

from .parameters import Parameter

F = TypeVar('F', bound=Callable[..., Any])

def button(id: str, label: str | None = None, allow_runtime_change: bool = True) -> Callable[[F], F]:
    """Decorator to define a button"""
    def decorator(func_orig: F) -> F:
        if ismethod(func_orig):
            if iscoroutinefunction(func_orig):
                async def func(*args, **kwargs) -> Any: # type: ignore
                    return await func_orig(*args, **kwargs)
            else:
                func = lambda *args, **kwargs: func_orig(*args, **kwargs)  # type: ignore
        else:
            func = func_orig
        param = Parameter(
            id=id,
            type="action",
            label=label or id,
            allow_runtime_change=allow_runtime_change
        )
        
        # Store parameter and action info on the function
        func._tensnap_parameter = param  # type: ignore
        return func # type: ignore

    return decorator
