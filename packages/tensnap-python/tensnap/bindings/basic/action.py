# tensnap/bindings/basic/action.py
"""Action decorators and metadata"""

from asyncio import iscoroutinefunction
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from inspect import ismethod
from typing import Any, TypeVar, cast

F = TypeVar("F", bound=Callable[..., Any])


# ---------------------------------------------------------------------------
# ActionMetadata — standalone Action entity (v0.2)
# ---------------------------------------------------------------------------


@dataclass
class ActionMetadata:
    """Metadata for a standalone action (v0.2 protocol).

    Replaces the old ``ActionParameter`` which mixed actions into the parameter
    type system.  Actions are now sent via ``action_create``/``action_update``/
    ``action_delete`` messages, **not** via ``param_create``.
    """

    id: str
    label: str = ""
    continuous: bool = False
    allow_runtime_change: bool = True

    def __post_init__(self) -> None:
        if not self.label:
            self.label = self.id.replace("_", " ").title().strip()

    def to_dict(self) -> dict[str, Any]:
        """Serialize to wire-format dict (camelCase keys for JS interop)."""
        return {
            "id": self.id,
            "label": self.label,
            "continuous": self.continuous,
            "allowRuntimeChange": self.allow_runtime_change,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ActionMetadata":
        allow = data.get("allowRuntimeChange", data.get("allow_runtime_change", True))
        return cls(
            id=data["id"],
            label=data.get("label", ""),
            continuous=data.get("continuous", False),
            allow_runtime_change=allow,
        )


# ---------------------------------------------------------------------------
# @action decorator
# ---------------------------------------------------------------------------


def action(
    id: str | None = None,
    label: str | None = None,
    continuous: bool = False,
    allow_runtime_change: bool = True,
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
        metadata = ActionMetadata(
            id=action_id,
            label=label or "",
            continuous=continuous,
            allow_runtime_change=allow_runtime_change,
        )

        # Store metadata on the function so callers can retrieve it
        cast(Any, wrapped_func)._tensnap_action = metadata
        return cast(F, wrapped_func)

    return decorator


# ---------------------------------------------------------------------------
# Namespace scanner
# ---------------------------------------------------------------------------


def get_action_metadata_from_namespace(
    namespace: dict[str, Any],
) -> list[tuple[str, Callable[..., Any], ActionMetadata]]:
    """Find all @action-decorated callables in a dict/namespace."""
    actions: list[tuple[str, Callable[..., Any], ActionMetadata]] = []
    for name, attr in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue
        if callable(attr) and hasattr(attr, "_tensnap_action"):
            metadata = attr._tensnap_action
            if isinstance(metadata, ActionMetadata):
                actions.append((name, attr, metadata))
    return actions
