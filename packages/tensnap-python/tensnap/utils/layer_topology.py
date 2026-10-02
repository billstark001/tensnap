"""Stable dependency-first ordering for layers in one environment."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import TypeVar

T = TypeVar("T")


def order_layers(
    layers: Iterable[T],
    layer_id: Callable[[T], str],
    dependencies: Callable[[T], Mapping[str, str]],
    type_of: Callable[[T], str],
    *,
    allow_missing: bool = False,
) -> list[T]:
    entries = list(layers)
    by_id: dict[str, T] = {}
    for entry in entries:
        identifier = layer_id(entry)
        if not identifier or identifier in by_id:
            raise ValueError(f"empty or duplicate layer id: {identifier!r}")
        by_id[identifier] = entry
    position = {layer_id(entry): index for index, entry in enumerate(entries)}

    ordered: list[T] = []
    state: dict[str, str] = {}

    def visit(identifier: str) -> None:
        if state.get(identifier) == "done":
            return
        if state.get(identifier) == "visiting":
            raise ValueError(f"cyclic layer dependency: {identifier}")
        state[identifier] = "visiting"
        entry = by_id[identifier]
        for role, dependency in sorted(
            dependencies(entry).items(), key=lambda pair: position.get(pair[1], -1)
        ):
            if dependency not in by_id:
                if allow_missing:
                    continue
                raise ValueError(
                    f"layer {identifier} depends on missing layer {dependency}"
                )
            if role == "agent" and type_of(by_id[dependency]) != "agent":
                raise ValueError(
                    f"layer {identifier} requires agent layer {dependency}"
                )
            visit(dependency)
        state[identifier] = "done"
        ordered.append(entry)

    for entry in entries:
        visit(layer_id(entry))
    return ordered
