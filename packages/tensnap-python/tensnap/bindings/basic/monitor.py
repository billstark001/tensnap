"""Declarative monitor discovery for Python model classes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar, cast

from tensnap.models.monitor import MonitorMetadata
from tensnap.utils.object import infer_id_from_func_name

F = TypeVar("F", bound=Callable[..., Any])
_TENSNAP_MONITOR_FIELD = "_tensnap_monitor"


def monitor(
    id: str | None = None,
    label: str | None = None,
    *,
    render_hint: str | None = None,
) -> Callable[[F | property], F | property]:
    """Mark a method or read-only property as a renderer monitor getter."""

    def decorator(value: F | property) -> F | property:
        getter = value.fget if isinstance(value, property) else value
        if getter is None:
            raise ValueError("@monitor cannot wrap a property without fget")
        metadata = MonitorMetadata(
            id=id or infer_id_from_func_name(getter.__name__),
            label=label or "",
            render_hint=render_hint,
        )
        setattr(getter, _TENSNAP_MONITOR_FIELD, metadata)
        return value

    return decorator


def get_monitor_metadata_from_namespace(
    namespace: dict[str, Any],
) -> list[tuple[str, Callable[..., Any], MonitorMetadata]]:
    """Return monitor getters declared on a class, module, or namespace."""
    monitors: list[tuple[str, Callable[..., Any], MonitorMetadata]] = []
    for name, value in namespace.items():
        if name.startswith("__") and name.endswith("__"):
            continue
        getter = value.fget if isinstance(value, property) else value
        metadata = getattr(getter, _TENSNAP_MONITOR_FIELD, None)
        if callable(getter) and isinstance(metadata, MonitorMetadata):
            monitors.append((name, cast(Callable[..., Any], getter), metadata))
    return monitors


__all__ = ["MonitorMetadata", "monitor", "get_monitor_metadata_from_namespace"]
