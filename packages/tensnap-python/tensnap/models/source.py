"""Model-owned keyed sources for item-bearing layers.

The source visits raw entries rather than requiring model-owned item records.
Only projected records are retained for field-level wire diffs.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypeVar

from tensnap.utils.object import dict_diff

SourceOperation = Literal["create", "update", "delete"]
SourceKey = str | int
TKey = TypeVar("TKey")


@dataclass(frozen=True, slots=True)
class SourceKeyCodec(Generic[TKey]):
    """Stable wire ID conversion for a model-owned mapping key."""

    encode: Callable[[TKey], SourceKey]
    decode: Callable[[SourceKey], TKey]


@dataclass(frozen=True, slots=True)
class SourceChange:
    operation: SourceOperation
    key: Any


@dataclass(frozen=True, slots=True)
class SourceBatch:
    """A non-consuming change batch since the caller's previous revision."""

    revision: Any
    changes: Iterable[SourceChange]


@dataclass(slots=True)
class SourceDeltaPlan:
    creates: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    deletes: list[SourceKey]
    replacements: dict[SourceKey, dict[str, Any]]
    revision: Any
    shape: Any
    full: bool = False


@dataclass(frozen=True, slots=True)
class KeyedSource:
    """Compiled, layer-local accessors for a model-owned container."""

    entries: Callable[[Any], Iterable[tuple[Any, Any]]]
    read: Callable[[Any, Any], Any]
    encode_key: Callable[[Any], SourceKey]
    project: Callable[[Any, Any, Any], dict[str, Any]]
    revision: Callable[[Any], Any] | None = None
    changes: Callable[[Any, Any], SourceBatch | None] | None = None
    shape: Callable[[Any], Any] | None = None
    omit: Callable[[Any, Any, Any], bool] | None = None

    def current_revision(self, model: Any) -> Any:
        return self.revision(model) if self.revision is not None else None

    def current_shape(self, model: Any) -> Any:
        return self.shape(model) if self.shape is not None else None

    def _project(self, model: Any, key: Any, value: Any) -> dict[str, Any]:
        item_id = self.encode_key(key)
        if isinstance(item_id, bool) or not isinstance(item_id, (str, int)):
            raise TypeError("source item id must be a string or integer")
        record = dict(self.project(model, key, value))
        if "id" in record and record["id"] != item_id:
            raise ValueError(f"projected source id differs from key: {item_id!r}")
        record["id"] = item_id
        return record

    def snapshot(self, model: Any) -> list[dict[str, Any]]:
        """Return projected records detached from mutable model values."""
        return [deepcopy(record) for record in self._records(model)]

    def _records(self, model: Any) -> Iterator[dict[str, Any]]:
        seen: set[SourceKey] = set()
        for key, value in self.entries(model):
            if self.omit is not None and self.omit(model, key, value):
                continue
            record = self._project(model, key, value)
            item_id = record["id"]
            if item_id in seen:
                raise ValueError(f"duplicate source item id: {item_id!r}")
            seen.add(item_id)
            yield record

    def plan(
        self,
        model: Any,
        previous: dict[SourceKey, dict[str, Any]],
        cursor: Any,
        previous_shape: Any,
    ) -> SourceDeltaPlan:
        shape = self.current_shape(model)
        if self.changes is not None and cursor is not None and shape == previous_shape:
            batch = self.changes(model, cursor)
            if batch is not None:
                return self._plan_changes(model, previous, batch, shape)
        return self._plan_scan(model, previous, shape)

    def _plan_changes(
        self,
        model: Any,
        previous: dict[SourceKey, dict[str, Any]],
        batch: SourceBatch,
        shape: Any,
    ) -> SourceDeltaPlan:
        # Last operation for a key wins, while preserving first-seen order.
        changes: dict[SourceKey, SourceChange] = {}
        for change in batch.changes:
            if change.operation not in ("create", "update", "delete"):
                raise ValueError(f"unknown source operation: {change.operation!r}")
            changes[self.encode_key(change.key)] = change
        plan = SourceDeltaPlan([], [], [], {}, batch.revision, shape)
        for item_id, change in changes.items():
            old = previous.get(item_id)
            if change.operation == "delete":
                if old is not None:
                    plan.deletes.append(item_id)
                continue
            try:
                value = self.read(model, change.key)
            except (KeyError, IndexError) as error:
                raise ValueError(
                    f"changed source key is absent: {change.key!r}"
                ) from error
            if self.omit is not None and self.omit(model, change.key, value):
                if old is not None:
                    plan.deletes.append(item_id)
                continue
            record = self._project(model, change.key, value)
            if old is not None and record == old:
                plan.replacements[item_id] = old
                continue
            record = deepcopy(record)
            if old is None:
                plan.creates.append(record)
            else:
                update = dict_diff(old, record)
                if update:
                    update["id"] = item_id
                    plan.updates.append(update)
            plan.replacements[item_id] = record
        return plan

    def _plan_scan(
        self,
        model: Any,
        previous: dict[SourceKey, dict[str, Any]],
        shape: Any,
    ) -> SourceDeltaPlan:
        current: dict[SourceKey, dict[str, Any]] = {}
        plan = SourceDeltaPlan(
            [], [], [], current, self.current_revision(model), shape, True
        )
        for projected in self._records(model):
            item_id = projected["id"]
            old = previous.get(item_id)
            if old is not None and projected == old:
                current[item_id] = old
                continue
            record = deepcopy(projected)
            current[item_id] = record
            if old is None:
                plan.creates.append(record)
            else:
                update = dict_diff(old, record)
                if update:
                    update["id"] = item_id
                    plan.updates.append(update)
        plan.deletes.extend(item_id for item_id in previous if item_id not in current)
        return plan
