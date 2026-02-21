# tensnap/bindings/basic/action.py
"""Action decorators and metadata"""

from typing import Any, Callable, TypeVar, Dict, List, Tuple, Optional
from dataclasses import dataclass, asdict

from asyncio import iscoroutinefunction
from inspect import ismethod
from functools import wraps

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

    def __post_init__(self):
        if not self.label:
            self.label = self.id.replace("_", " ").title().strip()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to wire-format dict (camelCase keys for JS interop)."""
        return {
            "id": self.id,
            "label": self.label,
            "continuous": self.continuous,
            "allowRuntimeChange": self.allow_runtime_change,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ActionMetadata":
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
    id: Optional[str] = None,
    label: Optional[str] = None,
    continuous: bool = False,
    allow_runtime_change: bool = True,
) -> Callable[[F], F]:
    """Decorator to mark a function as a TenSnap action button."""
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

        action_id = orig_id or func.__name__
        metadata = ActionMetadata(
            id=action_id,
            label=label or "",
            continuous=continuous,
            allow_runtime_change=allow_runtime_change,
        )

        # Store metadata on the function so callers can retrieve it
        func._tensnap_action = metadata  # type: ignore
        return func  # type: ignore

    return decorator


# ---------------------------------------------------------------------------
# Namespace scanner
# ---------------------------------------------------------------------------

def get_action_metadata_from_namespace(namespace: Dict[str, Any]) -> List[Tuple[str, Callable, ActionMetadata]]:
    """Find all @action-decorated callables in a dict/namespace."""
    actions: List[Tuple[str, Callable, ActionMetadata]] = []
    for name, attr in namespace.items():
        if name.startswith('__') and name.endswith('__'):
            continue
        if callable(attr) and hasattr(attr, "_tensnap_action"):
            metadata = getattr(attr, "_tensnap_action")
            if isinstance(metadata, ActionMetadata):
                actions.append((name, attr, metadata))
    return actions
