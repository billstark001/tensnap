"""Metadata access for decorated callables and read-only properties."""

from __future__ import annotations

from typing import Any, TypeVar

T = TypeVar("T")


def metadata_target(value: Any, decorator: str) -> Any:
    target = value.fget if isinstance(value, property) else value
    if target is None or not callable(target):
        raise TypeError(f"{decorator} requires a callable or property getter")
    return target


def attach_member_metadata(
    value: Any, name: str, metadata: Any, decorator: str
) -> None:
    setattr(metadata_target(value, decorator), name, metadata)


def read_member_metadata(value: Any, name: str, expected: type[T]) -> T | None:
    target = value.fget if isinstance(value, property) else value
    metadata = getattr(target, name, None)
    return metadata if isinstance(metadata, expected) else None
