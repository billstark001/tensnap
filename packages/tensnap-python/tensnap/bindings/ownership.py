"""Ownership rules for metadata installed by class decorators.

Declarations live on classes, never on model instances or arbitrary objects.
Readers may resolve inherited declarations; writers always create an entry on
the decorated class so a subclass cannot mutate its parent's registry.
"""

from __future__ import annotations

from typing import Any, TypeVar

T = TypeVar("T")


def require_class(value: Any, decorator: str) -> type[Any]:
    if not isinstance(value, type):
        raise TypeError(f"{decorator} can only decorate a class")
    return value


def class_owner(value: Any) -> type[Any]:
    if isinstance(value, type):
        return value
    return type(value)


def read_class_metadata(value: Any, name: str, expected: type[T]) -> T | None:
    metadata = getattr(class_owner(value), name, None)
    return metadata if isinstance(metadata, expected) else None


def attach_class_metadata(owner: type[Any], name: str, metadata: Any) -> None:
    require_class(owner, name)
    setattr(owner, name, metadata)


def append_class_metadata(owner: type[Any], name: str, item: T) -> None:
    require_class(owner, name)
    entries = list(getattr(owner, name, ()))
    entries.append(item)
    attach_class_metadata(owner, name, entries)
