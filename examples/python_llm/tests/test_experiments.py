"""Mechanism and paired-control invariants; never contact a provider."""

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.naming_game.model import NamingConfig, NamingGame


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_network_degree_connectivity_partition_and_bridges(seed):
    graphs = [
        NamingGame(NamingConfig(seed=seed, protocol="factorial-v1", topology=topology))
        for topology in ("mixed", "community")
    ]
    for model in graphs:
        assert all(len(peers) == 4 for peers in model.neighbors)
        assert all(
            i not in peers and all(i in model.neighbors[j] for j in peers)
            for i, peers in enumerate(model.neighbors)
        )
        reached, todo = {0}, [0]
        while todo:
            for node in set(model.neighbors[todo.pop()]) - reached:
                reached.add(node)
                todo.append(node)
        assert len(reached) == 24
    mixed, community = [model.network_summary() for model in graphs]
    assert mixed["communities"] == community["communities"]
    assert mixed["cross_community_edges"] > community["cross_community_edges"] == 2


@pytest.mark.asyncio
async def test_naming_treatment_preserves_memories_and_schedules_and_excludes_minority():
    model = NamingGame(NamingConfig(protocol="factorial-v1", topology="mixed"))
    for _ in range(200):
        await model.step()
    prefix = model.capture()
    model.apply_treatment("community", 4, "M")
    assert model.capture()["state"]["agents"] == prefix["state"]["agents"]
    assert model.capture()["random_state"] == prefix["random_state"]
    assert model.capture()["policy_random_state"] == prefix["policy_random_state"]
    ids = model.committed_ids
    assert len(ids) == 4
    for _ in range(300):
        await model.step()
        a, b = [int(agent.split("_")[1]) for agent in model.last_interaction["players"]]
        assert b in model.neighbors[a]
        assert all(
            name == "M"
            for agent, name in zip(
                model.last_interaction["players"], model.last_interaction["names"]
            )
            if agent in ids
        )
    choices = [
        name
        for event in model.events
        for agent, name in zip(event["players"], event["names"])
        if agent not in ids
    ]
    assert model.metrics()["ordinary_target_choice_share"] == choices.count("M") / len(
        choices
    )
    saved = model.capture()
    for _ in range(30):
        await model.step()
    expected = model.capture()
    model.restore(json.loads(json.dumps(saved)))
    for _ in range(30):
        await model.step()
    assert model.capture() == expected
    bad = copy.deepcopy(saved)
    bad["state"]["events"][-1]["players"] = ["unknown", "agent_1"]
    with pytest.raises(ValueError):
        model.restore(bad)
    assert model.capture() == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("rule", ["wsls", "frequency"])
async def test_naming_label_counterbalance_and_fixed_policy_avoids_provider(rule):
    models = [
        NamingGame(
            NamingConfig(
                protocol="factorial-v1", topology="mixed", label_order=order, rule=rule
            )
        )
        for order in ("QM", "MQ")
    ]
    for _ in range(300):
        for model in models:
            await model.step()
        assert (
            models[0].last_interaction["players"]
            == models[1].last_interaction["players"]
        )
        assert (
            models[0].last_interaction["success"]
            == models[1].last_interaction["success"]
        )
        assert all(
            a != b
            for a, b in zip(
                models[0].last_interaction["names"], models[1].last_interaction["names"]
            )
        )

    class NeverCalled:
        async def decide(self, *_):
            raise AssertionError("Fixed agents must not call the LLM")

    fixed = NamingGame(
        NamingConfig(protocol="factorial-v1", committed=4), NeverCalled()
    )
    player = next(player for player in fixed.agents if player.id in fixed.committed_ids)
    assert (await fixed._choose_name(player))["name"] == "M"


def test_frequency_uses_partner_memory_and_chart_has_numeric_empty_sample():
    from examples.python_llm.naming_game.viz import NamingView

    model = NamingGame(
        NamingConfig(protocol="factorial-v1", rule="frequency", exploration=0)
    )
    assert model.metrics()["ordinary_target_choice_share"] is None
    assert NamingView(model).ordinary_target_share == 0.0
    player = model.agents[0]
    player.history = [{"other": name} for name in ("M", "M", "Q")]
    assert model.rule_decision(player)["name"] == "M"


@pytest.mark.asyncio
async def test_missing_prefix_is_retained_and_empty_community_is_undefined(tmp_path):
    from examples.python_llm.experiments import naming, parser

    args = parser().parse_args(["naming", "--output", str(tmp_path / "unused")])
    args.seeds, args.agents, args.warmup = [1], 8, 1
    args.degree, args.minority, args.interactions = 2, 7, 32
    failed = await naming(args, tmp_path / "failed")
    assert len(failed["failed_prefixes"]) == 2
    assert failed["runs"] == []
    args.warmup = 3000
    report = await naming(args, tmp_path / "extreme")
    assert len(report["runs"]) == 8
    assert all(
        run["outcome"]["community_gap"] is None
        for run in report["runs"]
        if run["committed"] == 7
    )
    assert report["paired_effects"]["community_gap"]["interaction"]["n_seeds"] == 0


def test_signal_receives_advice_while_off_keeps_message_generation():
    models = [
        MiniCommons(
            CommonsConfig(
                protocol="factorial-v1", rule="signal", message_delivery=delivery
            )
        )
        for delivery in ("on", "off")
    ]
    for model in models:
        player = model.agents[0]
        x, y = player.x, player.y
        model.resources[y][x] = 1
        model.messages = [
            {
                "tick": 0,
                "agent": "agent_1",
                "x": x,
                "y": y,
                "message": f"reserve {x} {y}",
            }
        ]
    decisions = [
        model.rule_decision(model.agents[0], model.observation(model.agents[0]))
        for model in models
    ]
    assert decisions[0]["action"] != "harvest"
    assert decisions[1]["action"] == "harvest"
    assert decisions[0]["message"] == decisions[1]["message"] != ""
    assert models[1].messages  # researcher can inspect undelivered output


def test_environment_field_does_not_shift_with_cell_eligibility():
    config = CommonsConfig(seed=42, protocol="factorial-v1", regrowth=0.7)
    a, b = MiniCommons(config), MiniCommons(config)
    # First fertile cell full in A, eligible in B. A distant unchanged region
    # must receive exactly the same random tests over repeated rounds.
    x, y = a.components[0][0]
    for model in (a, b):
        for cy in range(config.height):
            for cx in range(config.width):
                if model.habitat[cy][cx]:
                    model.resources[cy][cx] = 2
    a.resources[y][x], b.resources[y][x] = 3, 2
    for round_number in range(1, 20):
        for model in (a, b):
            model.tick = round_number * config.agents
            model.regrow()
        assert all(
            a.resources[cy][cx] == b.resources[cy][cx]
            for component in a.components[1:]
            for cx, cy in component
        )


@pytest.mark.asyncio
async def test_drought_boundaries_restore_and_irreversible_component_extinction():
    config = CommonsConfig(
        protocol="factorial-v1",
        rule="signal",
        drought_start=2,
        drought_duration=3,
        drought_multiplier=0.1,
    )
    model = MiniCommons(config)
    for round_number, expected in [(1, 0.35), (2, 0.035), (4, 0.035), (5, 0.35)]:
        model.tick = round_number * config.agents
        assert model.effective_regrowth() == pytest.approx(expected)
    model.tick = 0
    for _ in range(13):
        await model.step()
    saved = model.capture()
    for _ in range(20):
        await model.step()
    expected = model.capture()
    model.restore(saved)
    for _ in range(20):
        await model.step()
    assert model.capture() == expected
    for x, y in model.components[0]:
        model.resources[y][x] = 0
    for round_number in range(10, 40):
        model.tick = round_number * config.agents
        model.regrow()
    assert model.metrics()["component_stocks"][0] == 0
    assert model.metrics()["extinct_components"] >= 1


@pytest.mark.parametrize(
    "kind,options",
    [
        ("naming", ["--warmup", "3000", "--interactions", "120"]),
        (
            "commons",
            ["--rounds", "20", "--drought-start", "5", "--drought-duration", "5"],
        ),
    ],
)
def test_factorial_entrypoint_and_no_overwrite(kind, options, tmp_path):
    output = tmp_path / kind
    command = [
        sys.executable,
        "-m",
        "examples.python_llm.experiments",
        kind,
        "--seeds",
        "1",
        "--output",
        str(output),
        *options,
    ]
    root = Path(__file__).resolve().parents[3]
    subprocess.run(command, cwd=root, check=True, capture_output=True, text=True)
    report = json.loads((output / "report.json").read_text())
    assert report["inference"] == {"mode": "rule", "live_calls": 0, "cost_cny": 0}
    assert len(report["runs"]) == (8 if kind == "naming" else 12)
    assert not report.get("failed_prefixes")
    if kind == "commons":
        assert all(
            check.get("delivery_negative_control_identical", True)
            for check in report["paired_checks"]
        )
    before = (output / "report.json").read_bytes()
    failed = subprocess.run(
        command, cwd=root, capture_output=True, text=True, check=False
    )
    assert failed.returncode != 0
    assert (output / "report.json").read_bytes() == before
