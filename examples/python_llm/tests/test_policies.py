"""Deterministic networks, complete notes, and bounded policy correction."""

import copy
import hashlib
import json

import networkx as nx
import pytest

from examples.python_llm.common.action_policy import LegalActionPolicy
from examples.python_llm.common.llm import DecisionError
from examples.python_llm.mini_commons_harvest.model import MiniCommons
from examples.python_llm.naming_game.model import NamingConfig, NamingGame
from examples.python_llm.naming_game.scenarios import create_contact_network


@pytest.mark.parametrize(
    "seed,topology,expected",
    [
        (
            1,
            "mixed",
            "e3b38fa97373de0cbb8787ce5fe07a5afd3dca1e6e0c00b1e46d54dba9183c7a",
        ),
        (
            1,
            "community",
            "2a624ad06890211fc1eb3f53ce1fc97536ff096e260fdcf7e8de851f89161a0d",
        ),
        (
            7,
            "mixed",
            "a261b052e82bd4a8950a16045f8d01748f287f4e9029271b1d4d7f046e6e0669",
        ),
        (
            42,
            "community",
            "03b18cea6a7521ed18d69fd7f07a8ad531389b4df967323e19a6a3a48267e6dd",
        ),
    ],
)
def test_network_matches_pre_refactor_graphs(seed, topology, expected):
    network = create_contact_network(
        [f"agent_{i}" for i in range(24)], NamingConfig(seed=seed, topology=topology)
    )
    payload = json.dumps([network.adjacency, network.communities], sort_keys=True)
    assert hashlib.sha256(payload.encode()).hexdigest() == expected
    assert nx.is_connected(network.graph)
    assert nx.is_frozen(network.graph)


@pytest.mark.asyncio
async def test_long_note_is_retained_and_only_display_is_shortened():
    note = "observation " * 100

    class Tape:
        cursor = 0

        async def decide(self, *_):
            self.cursor += 1
            return {"name": "Q", "note": note}

    model = NamingGame(NamingConfig(), Tape())
    await model.step()
    for identity in model.last_interaction["players"]:
        player = next(p for p in model.agents if p.id == identity)
        assert player.last_decision["note"] == note
        assert len(player.data["last_decision"]["note"]) == 160
        assert player.data["last_decision"]["note"].endswith("…")
    saved = model.capture()
    model.restore(saved)
    assert model.capture() == saved
    assert note in [p.last_decision.get("note") for p in model.agents]


class ActionTape:
    cursor = 0

    def __init__(self, answers):
        self.answers = answers
        self.requests = []

    async def decide(self, system, observation):
        self.requests.append(copy.deepcopy(observation))
        answer = self.answers[min(self.cursor, len(self.answers) - 1)]
        self.cursor += 1
        return answer


@pytest.mark.asyncio
async def test_illegal_harvest_reprompts_same_state_without_rule_substitution():
    tape = ActionTape([{"action": "harvest"}, {"action": "wait"}])
    policy = LegalActionPolicy(tape)
    model = MiniCommons(provider=policy)
    model.resources = [[0] * model.config.width for _ in range(model.config.height)]
    await model.step()
    assert model.tick == 1 and model.metrics()["harvested"] == 0
    assert tape.requests[0]["tick"] == tape.requests[1]["tick"] == 0
    assert "action_validation" not in tape.requests[0]
    assert tape.requests[1]["action_validation"]["current_cell"]["resource"] == 0
    assert policy.corrections[0]["answer"] == {"action": "harvest"}
    assert model.agents[0].last_action == "wait"


@pytest.mark.asyncio
async def test_exhausted_correction_is_bounded_and_model_stays_atomic():
    tape = ActionTape([{"action": "teleport"}])
    model = MiniCommons(provider=LegalActionPolicy(tape))
    before = model.capture()
    with pytest.raises(DecisionError, match="correction limit"):
        await model.step()
    assert model.capture() == before
    assert len(tape.requests) == 2
