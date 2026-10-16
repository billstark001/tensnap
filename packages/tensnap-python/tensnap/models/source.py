"""Model-owned keyed sources for item-bearing layers.

The source visits raw entries rather than requiring model-owned item records.
Only projected records are retained for field-level wire diffs.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any, Generic, Literal, TypeVar

from tensnap.utils.object import dict_diff
from tensnap.utils.projection_ownership import (
    configure_projector,
    copy_for_publication,
    detach_record,
    owns_values,
)

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
    projector_owns_values: bool | None = None
    projector_deep_copy: bool = True
    deep_copy: bool | None = None
    copy_items: bool = field(init=False)
    _scan_projector: Callable[..., Any] | None = field(init=False, default=None)

    def __post_init__(self) -> None:
        project = configure_projector(self.project, self.projector_deep_copy)
        object.__setattr__(self, "project", project)
        owned = (
            owns_values(project)
            if self.projector_owns_values is None
            else self.projector_owns_values
        )
        object.__setattr__(
            self, "copy_items", not owned if self.deep_copy is None else self.deep_copy
        )
        if not self.copy_items:
            object.__setattr__(
                self,
                "_scan_projector",
                getattr(project, "__tensnap_raw_projector__", None),
            )

    def current_revision(self, model: Any) -> Any:
        return self.revision(model) if self.revision is not None else None

    def current_shape(self, model: Any) -> Any:
        return self.shape(model) if self.shape is not None else None

    def _project(
        self, model: Any, key: Any, value: Any, scan: bool = False
    ) -> dict[str, Any]:
        item_id = self.encode_key(key)
        if isinstance(item_id, bool) or not isinstance(item_id, (str, int)):
            raise TypeError("source item id must be a string or integer")
        project = (
            self._scan_projector
            if scan and self._scan_projector is not None
            else self.project
        )
        record = dict(project(model, key, value))
        if "id" in record and record["id"] != item_id:
            raise ValueError(f"projected source id differs from key: {item_id!r}")
        record["id"] = item_id
        return record

    def snapshot(
        self, model: Any, deep_copy: bool | None = None
    ) -> list[dict[str, Any]]:
        """Build source records using the resolved publication copy policy.

        The override controls publication only, not projector detachment. False
        relies on the producer to keep all retained records and values stable.
        """
        return [
            copy_for_publication(
                record, self.copy_items if deep_copy is None else deep_copy
            )
            for record in self._records(model)
        ]

    def _records(self, model: Any, scan: bool = False) -> Iterator[dict[str, Any]]:
        seen: set[SourceKey] = set()
        for key, value in self.entries(model):
            if self.omit is not None and self.omit(model, key, value):
                continue
            record = self._project(model, key, value, scan)
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
            record = self._project(model, change.key, value, True)
            if old is not None and record == old:
                plan.replacements[item_id] = old
                continue
            record = self._materialize(record, old)
            if old is None:
                plan.creates.append(record)
            else:
                update = dict_diff(old, record)
                if update:
                    update["id"] = item_id
                    plan.updates.append(update)
            plan.replacements[item_id] = record
        return plan

    def _materialize(
        self, record: dict[str, Any], previous: dict[str, Any] | None
    ) -> dict[str, Any]:
        if self._scan_projector is not None:
            return detach_record(record, previous)
        return copy_for_publication(record, self.copy_items)

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
        for projected in self._records(model, True):
            item_id = projected["id"]
            old = previous.get(item_id)
            if old is not None and projected == old:
                current[item_id] = old
                continue
            record = self._materialize(projected, old)
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
