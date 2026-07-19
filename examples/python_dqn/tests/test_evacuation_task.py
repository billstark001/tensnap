from __future__ import annotations

from statistics import mean

import pytest

from python_dqn.config import (
    FIRE_EVACUATION_CHECKPOINT_SCHEMA,
    DQNConfig,
    EnvConfig,
    build_evacuation_layout,
)
from python_dqn.dqn import DQNAgent
from python_dqn.evidence import _derive_summary
from python_dqn.envs import MesaEvacuationEnv
from python_dqn.model import EvacuationModel
from python_dqn.policies import NoGuidePolicy, SafeExitHeuristicPolicy, evaluate_policy


def test_layout_creates_two_single_door_barriers_and_candidate_fires() -> None:
    exits, fire_sources, walls = build_evacuation_layout(17, 13)

    assert exits == ((0, 6), (16, 6))
    assert fire_sources == ((5, 6), (11, 6))
    assert len(walls) == 24
    assert (4, 6) not in walls
    assert (12, 6) not in walls
    assert {(4, y) for y in range(13) if y != 6}.issubset(walls)
    assert {(12, y) for y in range(13) if y != 6}.issubset(walls)


def test_episode_samples_one_fire_side_and_exposes_16_value_state() -> None:
    config = EnvConfig()
    model = EvacuationModel(config, seed=7)
    state = model.get_state()

    assert len(model.fire_cells) == 1
    assert next(iter(model.fire_cells)) in config.fire_sources
    assert state.shape == (16,)
    assert (state[9] > 0) != (state[10] > 0)
    assert abs(float(state[11] + state[12]) - 1.0) < 1e-6


def test_max_steps_resolves_episode_as_truncation() -> None:
    env = MesaEvacuationEnv(EnvConfig(max_steps=3), seed=11)
    try:
        env.reset(seed=11)
        done = False
        for _ in range(3):
            _, _, done, info = env.step(0)
        assert done
        assert info["truncated"] == 1.0
        assert env.alive_count > 0
    finally:
        env.close()


def test_safe_exit_signal_materially_improves_evacuation() -> None:
    config = EnvConfig()
    no_guide = evaluate_policy(
        config,
        lambda _seed: NoGuidePolicy(),
        episodes=40,
        seed=3000,
    )
    safe_guide = evaluate_policy(
        config,
        lambda _seed: SafeExitHeuristicPolicy(),
        episodes=40,
        seed=3000,
    )

    assert mean(item.evacuated for item in safe_guide) >= (
        mean(item.evacuated for item in no_guide) + 8
    )
    assert mean(item.dead for item in safe_guide) <= (
        mean(item.dead for item in no_guide) - 2
    )
    assert mean(item.unresolved for item in safe_guide) < 1


def test_checkpoint_rejects_an_incompatible_environment_schema(tmp_path) -> None:
    checkpoint = tmp_path / "policy.pt"
    source = DQNAgent(
        16,
        5,
        DQNConfig(),
        device="cpu",
        checkpoint_schema=FIRE_EVACUATION_CHECKPOINT_SCHEMA,
    )
    source.save(str(checkpoint))

    incompatible = DQNAgent(
        16,
        5,
        DQNConfig(),
        device="cpu",
        checkpoint_schema="different-environment",
    )
    with pytest.raises(ValueError, match="Incompatible DQN checkpoint schema"):
        incompatible.load(str(checkpoint))


def test_evidence_summary_is_derived_from_episode_rows() -> None:
    rows = []
    policies = ("dqn", "no-guide", "random", "safe-heuristic")
    for policy in policies:
        for index in range(100):
            rows.append({
                "cohort": "reference-100",
                "policy": policy,
                "trainingSeed": 7 if policy == "dqn" else None,
                "reward": 1.0,
                "evacuated": 20,
                "dead": 3,
                "unresolved": 5,
                "steps": 50,
            })
    for seed in (7, 11, 23, 37, 53):
        for _ in range(500):
            rows.append({
                "cohort": "stability-500",
                "policy": "dqn",
                "trainingSeed": seed,
                "reward": 1.0,
                "evacuated": seed,
                "dead": 0,
                "unresolved": 0,
                "steps": 20,
            })
    for policy in ("no-guide", "random", "safe-heuristic"):
        for _ in range(500):
            rows.append({
                "cohort": "stability-500",
                "policy": policy,
                "trainingSeed": None,
                "reward": 1.0,
                "evacuated": 20,
                "dead": 3,
                "unresolved": 5,
                "steps": 50,
            })

    summary = _derive_summary(rows)

    assert summary["reference100"]["dqn"]["episodes"] == 100
    assert summary["stability500"]["dqnByTrainingSeed"]["23"]["evacuated"] == 23
    assert summary["stability500"]["dqnAcrossTrainingSeeds"]["meanEvacuated"] == 26.2
