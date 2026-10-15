"""Incremental caches must not share mutable values with the live model."""

from typing import Any

import pytest

from tensnap.models.layer import LayerBinding, LayerRegistration
from tensnap.models.source import KeyedSource, SourceBatch, SourceChange


@pytest.mark.parametrize("precise", [False, True])
def test_layer_deltas_snapshot_nested_values(precise: bool) -> None:
    items = [{"id": "one", "x": 0, "y": 0, "data": {"tags": [1]}}]
    binding: LayerBinding[Any, str, Any, str] = LayerBinding(
        "agents",
        "agent",
        ("id",),
        iterable_getter=lambda model: model,
        item_projector=lambda item: item,
        item_id_getter=(lambda item: item["id"]) if precise else None,
        item_changed_getter=(lambda _item: True) if precise else None,
    )
    registration = LayerRegistration(binding, items)
    registration.seed_item_deltas_from_state(registration.build_state())
    items[0]["data"]["tags"].append(2)
    created, updated, deleted = registration.build_item_deltas()
    assert (created, deleted) == ([], [])
    assert updated[0]["data"] == {"tags": [1, 2]}
    items[0]["data"]["tags"].append(3)
    assert updated[0]["data"] == {"tags": [1, 2]}
    assert registration.build_item_deltas()[1][0]["data"] == {"tags": [1, 2, 3]}
    if not precise:
        previous = registration.last_items[("one",)]
        assert registration.build_item_deltas() == ([], [], [])
        assert registration.last_items[("one",)] is previous


@pytest.mark.parametrize("revisioned", [False, True])
def test_source_deltas_snapshot_nested_values(revisioned: bool) -> None:
    model = {"items": {"one": {"values": [1]}}, "revision": 0}
    source = KeyedSource(
        entries=lambda model: model["items"].items(),
        read=lambda model, key: model["items"][key],
        encode_key=lambda key: key,
        project=lambda _model, _key, value: {"data": value},
        revision=(lambda model: model["revision"]) if revisioned else None,
        changes=(
            lambda model, _cursor: SourceBatch(
                model["revision"], [SourceChange("update", "one")]
            )
        )
        if revisioned
        else None,
    )
    snapshot = source.snapshot(model)
    registration = LayerRegistration(
        LayerBinding("agents", "agent", ("id",), source=source), model
    )
    registration.seed_item_deltas_from_state(registration.build_state())
    model["items"]["one"]["values"].append(2)
    model["revision"] = 1
    assert snapshot[0]["data"] == {"values": [1]}
    created, updated, deleted = registration.build_item_deltas()
    assert (created, deleted) == ([], [])
    assert updated == [{"id": "one", "data": {"values": [1, 2]}}]
    registration.commit_item_deltas()
    model["items"]["one"]["values"].append(3)
    model["revision"] = 2
    assert updated[0]["data"] == {"values": [1, 2]}
    assert registration.build_item_deltas()[1] == [
        {"id": "one", "data": {"values": [1, 2, 3]}}
    ]
    registration.commit_item_deltas()
    previous = registration.last_items["one"]
    assert registration.build_item_deltas() == ([], [], [])
    registration.commit_item_deltas()
    assert registration.last_items["one"] is previous
