"""Projection ownership and publication-time snapshot detachment."""

from __future__ import annotations

import inspect
import linecache
from collections.abc import Callable
from copy import deepcopy
from functools import update_wrapper
from typing import Any, TypeVar, cast

T = TypeVar("T")
K = TypeVar("K", bound=str)
_IMMUTABLE_TYPES = frozenset({type(None), bool, int, float, str, bytes})


def copy_for_publication(value: T, deep_copy: bool = True) -> T:
    """Detach a published value; False transfers an already stable snapshot."""
    return deepcopy(value) if deep_copy else value


def detach_record(
    record: dict[K, Any], previous: dict[K, Any] | None = None
) -> dict[K, Any]:
    """Own a fresh record, reusing equal fields from a read-only owned baseline."""
    memo: dict[int, Any] | None = None
    for key, value in record.items():
        if type(value) not in _IMMUTABLE_TYPES:
            if previous is not None and key in previous and value == previous[key]:
                record[key] = previous[key]
                continue
            if memo is None:
                memo = {}
            record[key] = deepcopy(value, memo)
    return record


def owns_values(projector: object | None) -> bool:
    return bool(getattr(projector, "__tensnap_owns_values__", False))


def owned_projector(projector: Callable[..., Any]) -> Callable[..., Any]:
    """Wrap a built-in raw projector; custom callbacks remain unmarked by default."""
    cached = getattr(projector, "__tensnap_owned_projector__", None)
    if cached is not None:
        return cast(Callable[..., Any], cached)
    # Built-ins have fixed positional arguments. Generate that signature once;
    # hot calls do not package arguments into *args/**kwargs containers.
    arguments = ", ".join(inspect.signature(projector).parameters)
    source = f"def project({arguments}):\n    return _detach(_raw({arguments}))\n"
    filename = f"<tensnap owned projector {id(projector)}>"
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    namespace: dict[str, Any] = {"_detach": detach_record, "_raw": projector}
    exec(compile(source, filename, "exec"), namespace)
    project = update_wrapper(namespace["project"], projector)
    project.__tensnap_owns_values__ = True  # type: ignore[attr-defined]
    project.__tensnap_raw_projector__ = projector  # type: ignore[attr-defined]
    setattr(projector, "__tensnap_owned_projector__", project)  # noqa: B010
    return project


def configure_projector(projector: T, deep_copy: bool) -> T:
    """Select a built-in projector's copy mode without changing cached callables."""
    raw = getattr(projector, "__tensnap_raw_projector__", None)
    if raw is None or (deep_copy and owns_values(projector)):
        return projector
    return cast(T, owned_projector(raw) if deep_copy else raw)
