"""Behavioral checks for stochastic state, local observations, and restoration."""

import copy
import json

import pytest

from examples.python_llm.common.llm import DecisionError
from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.naming_game.model import NamingConfig, NamingGame


@pytest.mark.asyncio
@pytest.mark.parametrize("factory", [NamingGame, MiniCommons])
async def test_seeded_restore_repeats_future_without_aliasing(factory):
    model = factory()
    for _ in range(17):
        await model.step()
    saved = model.capture()
    retained = copy.deepcopy(saved)
    for _ in range(23):
        await model.step()
    expected = model.capture()
    assert saved == retained
    # Exercise the same JSON representation as persisted headless checkpoints.
    model.restore(json.loads(json.dumps(saved)))
    for _ in range(23):
        await model.step()
    assert model.capture() == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("factory", [NamingGame, MiniCommons])
async def test_reseed_changes_state_and_reset_reproduces_it(factory):
    model = factory()
    await model.step()
    old = model.capture()
    model.reset(seed=8)
    await model.step()
    new = model.capture()
    assert old != new
    model.reset()
    await model.step()
    assert model.capture() == new


@pytest.mark.parametrize(
    "factory,corrupt",
    [
        (NamingGame, lambda p: p["state"]["agents"][0].update(id="wrong")),
        (NamingGame, lambda p: p["state"]["agents"][0].update(name="invented")),
        (MiniCommons, lambda p: p["state"]["resources"][0].append(3)),
        (MiniCommons, lambda p: p["state"]["agents"][0].update(x=-1)),
    ],
)
def test_invalid_restore_does_not_partially_mutate_model(factory, corrupt):
    model = factory()
    saved = model.capture()
    broken = copy.deepcopy(saved)
    corrupt(broken)
    with pytest.raises(ValueError):
        model.restore(broken)
    assert model.capture() == saved


@pytest.mark.asyncio
async def test_naming_simultaneous_answers_and_failed_second_answer_are_atomic():
    class Provider:
        cursor = 0
        observations = []

        async def decide(self, system, observation):
            self.observations.append(copy.deepcopy(observation))
            self.cursor += 1
            return {"name": "Q" if self.cursor == 1 else "invalid"}

    provider = Provider()
    model = NamingGame(provider=provider)
    saved = model.capture()
    with pytest.raises(DecisionError):
        await model.step()
    assert model.capture() == saved
    assert len(provider.observations) == 2
    assert all(not obs["recent_interactions"] for obs in provider.observations)
    assert all("partner_choice" not in obs for obs in provider.observations)


@pytest.mark.asyncio
async def test_naming_pair_schedule_does_not_depend_on_policy_random_draws():
    class Provider:
        cursor = 0

        async def decide(self, system, observation):
            self.cursor += 1
            return {"name": "Q"}

    rule = NamingGame()
    llm = NamingGame(provider=Provider())
    for _ in range(30):
        await rule.step()
        await llm.step()
        assert rule.last_interaction["players"] == llm.last_interaction["players"]


@pytest.mark.asyncio
async def test_ring_only_pairs_neighbors():
    model = NamingGame(NamingConfig(agents=8, topology="ring"))
    for _ in range(50):
        await model.step()
        a, b = [int(p.split("_")[1]) for p in model.last_interaction["players"]]
        assert (a - b) % 8 in (1, 7)


@pytest.mark.asyncio
async def test_commons_harvest_conservation_and_irrecoverable_extinction():
    model = MiniCommons(CommonsConfig(regrowth=0))
    initial = model.metrics()["resource"]
    for _ in range(300):
        await model.step()
        metrics = model.metrics()
        assert metrics["resource"] + metrics["harvested"] == initial
        assert 0 <= metrics["gini"] <= 1
    model.resources = [[0] * model.config.width for _ in range(model.config.height)]
    model.regrow()
    assert model.metrics()["resource"] == 0


def test_commons_observations_are_local_and_do_not_include_global_totals():
    model = MiniCommons()
    observer = model.agents[0]
    for cell in model.observation(observer)["cells"]:
        assert abs(cell["x"] - observer.x) + abs(cell["y"] - observer.y) <= 2
    assert "resource_total" not in model.observation(observer)
    model.messages = [
        {"tick": 0, "agent": "remote", "x": 100, "y": 100, "message": "hidden"}
    ]
    assert model.observation(observer)["local_messages"] == []


@pytest.mark.asyncio
async def test_conserve_exploration_preserves_last_resource_unit():
    model = MiniCommons(CommonsConfig(regrowth=0, rule="conserve"))
    model.resources = [[min(value, 1) for value in row] for row in model.resources]
    initial = model.metrics()["resource"]
    for _ in range(120):
        await model.step()
    assert model.metrics()["resource"] == initial
    assert model.metrics()["harvested"] == 0


@pytest.mark.asyncio
async def test_commons_invalid_action_does_not_become_a_rule_fallback():
    class Provider:
        cursor = 0

        async def decide(self, system, observation):
            self.cursor += 1
            return {"action": "teleport"}

    model = MiniCommons(provider=Provider())
    saved = model.capture()
    with pytest.raises(DecisionError):
        await model.step()
    assert model.capture() == saved
