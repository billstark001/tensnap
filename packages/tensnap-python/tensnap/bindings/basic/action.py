# tensnap/bindings/basic/buttons.py
"""Button decorators and bindings"""

from typing import Any, Callable, TypeVar, Dict, List, Tuple

from asyncio import iscoroutinefunction
from inspect import ismethod
from functools import wraps

from .parameter import ActionParameter

F = TypeVar("F", bound=Callable[..., Any])


def action(
    id: str | None = None, label: str | None = None, allow_runtime_change: bool = True
) -> Callable[[F], F]:
    """Decorator to define a button"""
    orig_id = id

    def decorator(func_orig: F) -> F:
        if ismethod(func_orig):
            if iscoroutinefunction(func_orig):

                @wraps(func_orig)
                async def func(*args, **kwargs) -> Any:  # type: ignore
                    return await func_orig(*args, **kwargs)

            else:

                @wraps(func_orig)
                def func(*args, **kwargs) -> Any:  # type: ignore
                    return func_orig(*args, **kwargs)

        else:
            func = func_orig  # type: ignore
        id = orig_id or func.__name__
        param = ActionParameter(
            id=id, label=label or "", allow_runtime_change=allow_runtime_change
        )

        # Store parameter and action info on the function
        func._tensnap_action = param  # type: ignore
        return func  # type: ignore

    return decorator


def get_action_metadata_from_namespace(namespace: Dict[str, Any]):
    """Find all action-decorated functions in a given namespace"""
    actions: List[Tuple[str, Callable, ActionParameter]] = []
    for name, attr in namespace.items():
        if name.startswith('__') and name.endswith('__'):
            continue
        if callable(attr) and hasattr(attr, "_tensnap_action"):
            param = getattr(attr, "_tensnap_action")
            if isinstance(param, ActionParameter):
                actions.append((name, attr, param))
    return actions
