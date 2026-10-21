"""Derived statistics must preserve the seeded model, charts, and projection."""

import sys
from pathlib import Path
from types import MethodType

import pytest

from tensnap import cleanup_mesa_model_step

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "examples/python_mesa"))
from schelling import SchellingAgent, SchellingModel
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
        width=16, height=16, seed=20260718, collect_data=collect_data
    )
    reference = SchellingModel(
        width=16, height=16, seed=20260718, collect_data=collect_data
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
    assert cached.rng.bit_generator.state == reference.rng.bit_generator.state


@pytest.mark.parametrize("collect_data", [False, True])
def test_counts_invalidate_on_population_edits_and_restore(collect_data):
    model = SchellingModel(
        width=8, height=8, density=0.5, seed=7, collect_data=collect_data
    )
    saved = capture_checkpoint(model)
    for edit in ("move", "group", "remove", "add"):
        state(model)  # populate the cache before each mutation
        agent = next(iter(model.agents))
        if edit == "move":
            agent.cell = next(cell for cell in model.grid.all_cells if cell.is_empty)
        elif edit == "group":
            agent.group = 3 - agent.group
        elif edit == "remove":
            agent.remove()
        else:
            cell = next(cell for cell in model.grid.all_cells if cell.is_empty)
            SchellingAgent(model, cell, group=1)
        assert not model._neighbor_counts
        for remaining in model.agents:
            assert model.neighbor_counts(remaining) == uncached_counts(model, remaining)
    restore_checkpoint(model, saved)
    assert model.collect_data == collect_data
    assert model.steps == model.tick == saved["time"]
    for agent in model.agents:
        assert model.neighbor_counts(agent) == uncached_counts(model, agent)
    model.step()
    expected = capture_checkpoint(model)
    restore_checkpoint(model, saved)
    model.step()
    assert capture_checkpoint(model) == expected
    assert model.steps == model.tick == saved["time"] + 1
    cleanup_mesa_model_step(model)


def test_statistics_reuse_neighbor_scans_until_occupancy_changes(monkeypatch):
    model = SchellingModel(width=8, height=8, seed=7, collect_data=True)
    model._neighbor_counts.clear()
    agent = next(iter(model.agents))
    calls = 0
    original = type(agent.cell).get_neighborhood

    def count(cell, *args, **kwargs):
        nonlocal calls
        calls += 1
        return original(cell, *args, **kwargs)

    monkeypatch.setattr(type(agent.cell), "get_neighborhood", count)
    model.datacollector.collect(model)
    model.satisfied_pct()
    model.segregation_index()
    state(model)  # the size projector calls is_satisfied for every agent
    assert calls == len(model.agents)
    model.similarity_threshold = 0.9
    state(model)
    assert calls == len(model.agents)  # counts do not depend on threshold
    assert all(
        agent.is_satisfied() == (occupied == 0 or same >= 0.9 * occupied)
        for agent in model.agents
        for same, occupied in [uncached_counts(model, agent)]
    )


def test_kernel_steps_bypass_statistics_helper_and_keep_native_clock(monkeypatch):
    model = SchellingModel(width=8, height=8, seed=7, collect_data=False)

    def unexpected(*_args):
        raise AssertionError("kernel step entered the statistics cache helper")

    monkeypatch.setattr(model, "neighbor_counts", unexpected)
    for tick in range(1, 11):
        model.step()
        assert not model._neighbor_counts
        assert model.steps == model.tick == tick


def test_kernel_statistics_bypass_cache_reads_and_writes():
    class UnusedCache(dict):
        def get(self, *_args):
            raise AssertionError("kernel statistics read the cache")

        def __setitem__(self, *_args):
            raise AssertionError("kernel statistics populated the cache")

    model = SchellingModel(width=8, height=8, seed=7, collect_data=False)
    model._neighbor_counts = UnusedCache()
    for _ in range(3):
        for agent in model.agents:
            assert model.neighbor_counts(agent) == uncached_counts(model, agent)
        assert 0 <= model.satisfied_pct() <= 1
        assert 0 <= model.segregation_index() <= 1
        model.step()
        assert not model._neighbor_counts


@pytest.mark.parametrize("edit", ["move", "group", "remove", "add"])
def test_cache_stays_valid_when_collection_is_disabled_then_reenabled(edit):
    model = SchellingModel(width=8, height=8, density=0.5, seed=7)
    model.segregation_index()
    assert model._neighbor_counts
    model.collect_data = False
    agent = next(iter(model.agents))
    empty = next(cell for cell in model.grid.all_cells if cell.is_empty)
    if edit == "move":
        agent.cell = empty
    elif edit == "group":
        agent.group = 3 - agent.group
    elif edit == "remove":
        agent.remove()
    else:
        SchellingAgent(model, empty, group=1)
    assert not model._neighbor_counts
    model.segregation_index()
    assert not model._neighbor_counts
    model.collect_data = True
    for remaining in model.agents:
        assert model.neighbor_counts(remaining) == uncached_counts(model, remaining)
    assert len(model._neighbor_counts) == len(model.agents)


def test_collection_only_changes_observational_history():
    observed = SchellingModel(width=8, height=8, seed=7, collect_data=True)
    unobserved = SchellingModel(width=8, height=8, seed=7, collect_data=False)
    for _ in range(10):
        assert state(observed) == state(unobserved)
        observed.step()
        unobserved.step()
    assert observed.random.getstate() == unobserved.random.getstate()
    assert observed.rng.bit_generator.state == unobserved.rng.bit_generator.state
    assert observed.datacollector.model_vars["Occupied"]
    assert not unobserved.datacollector.model_vars["Occupied"]
