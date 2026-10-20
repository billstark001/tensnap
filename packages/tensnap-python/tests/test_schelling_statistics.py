"""Derived statistics must preserve the seeded model, charts, and projection."""

import sys
from pathlib import Path
from types import MethodType

import pytest

from tensnap import cleanup_mesa_model_step

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "examples/python_mesa"))
from schelling import SchellingModel
from schelling_checkpoint import capture_checkpoint, restore_checkpoint


def uncached_counts(self, agent):
    neighbors = list(agent.cell.get_neighborhood(radius=1).agents)
    return sum(n.group == agent.group for n in neighbors), len(neighbors)


def state(model):
    return [
        (a.unique_id, a.cell.coordinate, a.group, a.is_satisfied())
        for a in model.agents
    ]


@pytest.mark.parametrize("collect_data", [False, True])
def test_reused_counts_preserve_transitions_collector_and_visual_sizes(collect_data):
    cached = SchellingModel(
        width=16, height=16, rng=20260718, collect_data=collect_data
    )
    reference = SchellingModel(
        width=16, height=16, rng=20260718, collect_data=collect_data
    )
    reference.neighbor_counts = MethodType(uncached_counts, reference)
    threshold_edit_step = 15
    for step in range(35):
        if step == threshold_edit_step:
            cached.similarity_threshold = reference.similarity_threshold = 0.8
        assert state(cached) == state(reference)
        assert cached.satisfied_pct() == reference.satisfied_pct()
        assert cached.segregation_index() == reference.segregation_index()
        assert cached.datacollector.model_vars == reference.datacollector.model_vars
        assert (
            cached.datacollector._agent_records
            == reference.datacollector._agent_records
        )
        assert cached.step() == reference.step()
    assert cached.random.getstate() == reference.random.getstate()


def test_counts_invalidate_on_movement_group_edit_removal_and_restore():
    model = SchellingModel(width=8, height=8, density=0.5, rng=7)
    saved = capture_checkpoint(model)
    for edit in ("move", "group", "remove"):
        state(model)  # populate the cache before each mutation
        agent = next(iter(model.agents))
        if edit == "move":
            agent.cell = next(cell for cell in model.grid.all_cells if cell.is_empty)
        elif edit == "group":
            agent.group = 3 - agent.group
        else:
            agent.remove()
        assert not model._neighbor_counts
        for remaining in model.agents:
            assert model.neighbor_counts(remaining) == uncached_counts(model, remaining)
    restore_checkpoint(model, saved)
    for agent in model.agents:
        assert model.neighbor_counts(agent) == uncached_counts(model, agent)
    model.step()
    expected = capture_checkpoint(model)
    restore_checkpoint(model, saved)
    model.step()
    assert capture_checkpoint(model) == expected
    cleanup_mesa_model_step(model)


def test_statistics_reuse_neighbor_scans_until_occupancy_changes(monkeypatch):
    model = SchellingModel(width=8, height=8, rng=7, collect_data=True)
    model._neighbor_counts.clear()
    agent = next(iter(model.agents))
    calls = 0
    original = type(agent.cell).get_neighborhood

    def count(cell, *args, **kwargs):
        nonlocal calls
        calls += 1
        return original(cell, *args, **kwargs)

    monkeypatch.setattr(type(agent.cell), "get_neighborhood", count)
    model.satisfied_pct()
    model.segregation_index()
    state(model)  # the size projector calls is_satisfied for every agent
    assert calls == len(model.agents)
    model.similarity_threshold = 0.9
    state(model)
    assert calls == len(model.agents)  # counts do not depend on threshold


def test_kernel_only_steps_do_not_populate_or_call_the_statistics_cache(monkeypatch):
    model = SchellingModel(width=8, height=8, rng=7, collect_data=False)

    def unexpected(*args):
        raise AssertionError("kernel step entered the statistics cache")

    monkeypatch.setattr(model, "neighbor_counts", unexpected)
    for _ in range(10):
        model.advance()
        assert not model._neighbor_counts
