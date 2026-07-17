"""Action decorators and compatibility exports."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from inspect import iscoroutinefunction, ismethod
from typing import TYPE_CHECKING, Any, TypeVar, cast
from warnings import warn

from tensnap.models.action import ActionMetadata as _ActionMetadata

F = TypeVar("F", bound=Callable[..., Any])

if TYPE_CHECKING:
    ActionMetadata = _ActionMetadata


def action(  # noqa: PLR0913
    id: str | None = None,
    label: str | None = None,
    continuous: bool = False,
    allow_runtime_change: bool = True,
    *,
    scope: str | None = None,
    kwargs: list[dict[str, Any]] | None = None,
) -> Callable[[F], F]:
    """Decorator to mark a function as a TenSnap action button."""
    orig_id = id

    def decorator(func_orig: F) -> F:
        wrapped_func: Callable[..., Any]
        if ismethod(func_orig):
            if iscoroutinefunction(func_orig):

                @wraps(func_orig)
                async def method_wrapper(*args: Any, **kwargs: Any) -> Any:
                    return await func_orig(*args, **kwargs)

                wrapped_func = method_wrapper
            else:

                @wraps(func_orig)
                def method_wrapper(*args: Any, **kwargs: Any) -> Any:
                    return func_orig(*args, **kwargs)

                wrapped_func = method_wrapper

        else:
            wrapped_func = cast(Callable[..., Any], func_orig)

        action_id = orig_id or wrapped_func.__name__
        metadata = _ActionMetadata(
            id=action_id,
            label=label or "",
            continuous=continuous,
            allow_runtime_change=allow_runtime_change,
            scope=scope,
            kwargs=kwargs,
        )

        cast(Any, wrapped_func)._tensnap_action = metadata
        return cast(F, wrapped_func)

    return decorator


def get_action_metadata_from_namespace(
    namespace: dict[str, Any],
) -> list[tuple[str, Callable[..., Any], _ActionMetadata]]:
    """Find all @action-decorated callables in a dict/namespace."""
    actions: list[tuple[str, Callable[..., Any], _ActionMetadata]] = []
    for name, attr in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue
        if callable(attr) and hasattr(attr, "_tensnap_action"):
            metadata = getattr(attr, "_tensnap_action", None)
            if isinstance(metadata, _ActionMetadata):
                actions.append((name, attr, metadata))
    return actions


def __getattr__(name: str) -> Any:
    if name == "ActionMetadata":
        warn(
            "tensnap.bindings.basic.action.ActionMetadata is deprecated; "
            "import ActionMetadata from tensnap.models instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return _ActionMetadata
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ActionMetadata",
    "action",
    "get_action_metadata_from_namespace",
]
