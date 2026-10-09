"""Build and verify the publication evidence for the Fire/DQN example.

The ordinary ``main --mode compare`` command is useful for exploration, but its
terminal output is not an archival result.  This module executes the declared
training/evaluation matrix, saves per-episode rows and checkpoints, and verifies
that every published aggregate can be reconstructed from those rows.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import random
import shutil
from statistics import mean, stdev
import subprocess
from typing import Any, Iterable

import mesa
import torch

from .config import DQNConfig, EnvConfig, TrainingConfig
from .policies import (
    NoGuidePolicy,
    RandomPolicy,
    SafeExitHeuristicPolicy,
    evaluate_policy,
)
from .train import EpisodeSummary, train_dqn

SCHEMA_VERSION = 1
TRAINING_SEEDS = (7, 11, 23, 37, 53)
REFERENCE_EPISODES = 100
STABILITY_EPISODES = 500
EVALUATION_SEED = 4000
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "benchmark-results" / "fire-dqn"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


@dataclass(frozen=True)
class EvidencePlan:
    """Declared training/evaluation sizes, recorded with every artifact."""

    training_episodes: int = 500
    reference_episodes: int = REFERENCE_EPISODES
    stability_episodes: int = STABILITY_EPISODES
    training_seeds: tuple[int, ...] = TRAINING_SEEDS
    purpose: str = "publication"

    def __post_init__(self) -> None:
        if (
            min(
                self.training_episodes, self.reference_episodes, self.stability_episodes
            )
            < 1
        ):
            raise ValueError("episode counts must be positive")
        if (
            len(set(self.training_seeds)) != len(self.training_seeds)
            or len(self.training_seeds) < 2
            or 7 not in self.training_seeds
        ):
            raise ValueError("use distinct training seeds including reference seed 7")


def _sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=REPOSITORY_ROOT,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _require_clean_source() -> None:
    try:
        status = subprocess.check_output(
            ["git", "status", "--short"],
            cwd=REPOSITORY_ROOT,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(
            "fire evidence requires an identifiable Git checkout"
        ) from error
    if status:
        raise SystemExit(
            "fire evidence requires a clean Git source tree; commit the declared implementation first"
        )


def _set_training_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _summary(rows: Iterable[dict[str, Any]]) -> dict[str, float]:
    items = list(rows)
    if not items:
        raise ValueError("cannot summarize an empty episode group")
    return {
        "episodes": len(items),
        "reward": mean(float(row["reward"]) for row in items),
        "evacuated": mean(int(row["evacuated"]) for row in items),
        "dead": mean(int(row["dead"]) for row in items),
        "unresolved": mean(int(row["unresolved"]) for row in items),
        "steps": mean(int(row["steps"]) for row in items),
    }


def _episode_rows(
    cohort: str,
    policy: str,
    training_seed: int | None,
    results: Iterable[EpisodeSummary],
) -> list[dict[str, Any]]:
    return [
        {
            "cohort": cohort,
            "policy": policy,
            "trainingSeed": training_seed,
            "evaluationIndex": index,
            "episodeSeed": EVALUATION_SEED + 1000 + index,
            **asdict(result),
        }
        for index, result in enumerate(results)
    ]


def _group_rows(
    rows: list[dict[str, Any]],
    *,
    cohort: str,
    policy: str,
    training_seed: int | None,
) -> list[dict[str, Any]]:
    return [
        row
        for row in rows
        if row["cohort"] == cohort
        and row["policy"] == policy
        and row["trainingSeed"] == training_seed
    ]


def _derive_summary(
    rows: list[dict[str, Any]], plan: EvidencePlan = EvidencePlan()
) -> dict[str, Any]:
    reference = {
        policy: _summary(
            _group_rows(
                rows,
                cohort=f"reference-{plan.reference_episodes}",
                policy=policy,
                training_seed=7 if policy == "dqn" else None,
            )
        )
        for policy in ("dqn", "no-guide", "random", "safe-heuristic")
    }
    stability_by_seed = {
        str(seed): _summary(
            _group_rows(
                rows,
                cohort=f"stability-{plan.stability_episodes}",
                policy="dqn",
                training_seed=seed,
            )
        )
        for seed in plan.training_seeds
    }
    stability_baselines = {
        policy: _summary(
            _group_rows(
                rows,
                cohort=f"stability-{plan.stability_episodes}",
                policy=policy,
                training_seed=None,
            )
        )
        for policy in ("no-guide", "random", "safe-heuristic")
    }
    evacuated = [
        stability_by_seed[str(seed)]["evacuated"] for seed in plan.training_seeds
    ]
    return {
        f"reference{plan.reference_episodes}": reference,
        f"stability{plan.stability_episodes}": {
            "dqnByTrainingSeed": stability_by_seed,
            "dqnAcrossTrainingSeeds": {
                "trainingSeeds": list(plan.training_seeds),
                "meanEvacuated": mean(evacuated),
                "sampleSdEvacuated": stdev(evacuated),
                "minEvacuated": min(evacuated),
                "maxEvacuated": max(evacuated),
            },
            "baselines": stability_baselines,
        },
    }


def _evaluate_reference_policy(
    policy: str,
    env_config: EnvConfig,
    episodes: int,
) -> list[EpisodeSummary]:
    if policy == "no-guide":
        return evaluate_policy(
            env_config,
            lambda _seed: NoGuidePolicy(),
            episodes=episodes,
            seed=EVALUATION_SEED,
        )
    if policy == "random":
        return evaluate_policy(
            env_config,
            RandomPolicy,
            episodes=episodes,
            seed=EVALUATION_SEED,
        )
    if policy == "safe-heuristic":
        return evaluate_policy(
            env_config,
            lambda _seed: SafeExitHeuristicPolicy(),
            episodes=episodes,
            seed=EVALUATION_SEED,
        )
    raise ValueError(f"unknown reference policy: {policy}")


def build_artifact(output: Path, plan: EvidencePlan = EvidencePlan()) -> None:
    if output.exists():
        raise SystemExit(f"refusing to overwrite existing evidence artifact: {output}")
    if plan.purpose == "publication":
        _require_clean_source()
    stage = output.with_name(f".{output.name}.staging-{os.getpid()}")
    if stage.exists():
        shutil.rmtree(stage)
    checkpoints = stage / "checkpoints"
    checkpoints.mkdir(parents=True)

    env_config = EnvConfig()
    dqn_config = DQNConfig()
    rows: list[dict[str, Any]] = []
    checkpoint_hashes: dict[str, str] = {}
    trained_agents: dict[int, Any] = {}

    try:
        for seed in plan.training_seeds:
            print(f"training_seed={seed}", flush=True)
            _set_training_seed(seed)
            seed_directory = checkpoints / f"seed-{seed}"
            artifacts = train_dqn(
                env_config,
                dqn_config,
                TrainingConfig(
                    episodes=plan.training_episodes,
                    seed=seed,
                    checkpoint_dir=seed_directory,
                    checkpoint_every=plan.training_episodes,
                    log_every=100,
                ),
                device="cpu",
            )
            trained_agents[seed] = artifacts.agent
            latest = seed_directory / "dqn_latest.pt"
            periodic = seed_directory / f"dqn_ep_{plan.training_episodes}.pt"
            if periodic.exists():
                periodic.unlink()
            checkpoint_hashes[str(seed)] = _sha256_file(latest)

        print(f"evaluating_reference_{plan.reference_episodes}", flush=True)
        reference_dqn = evaluate_policy(
            env_config,
            lambda _seed: trained_agents[7],
            episodes=plan.reference_episodes,
            seed=EVALUATION_SEED,
        )
        rows.extend(
            _episode_rows(
                f"reference-{plan.reference_episodes}", "dqn", 7, reference_dqn
            )
        )
        for policy in ("no-guide", "random", "safe-heuristic"):
            rows.extend(
                _episode_rows(
                    f"reference-{plan.reference_episodes}",
                    policy,
                    None,
                    _evaluate_reference_policy(
                        policy, env_config, plan.reference_episodes
                    ),
                )
            )

        print(f"evaluating_stability_{plan.stability_episodes}", flush=True)
        for seed in plan.training_seeds:
            rows.extend(
                _episode_rows(
                    f"stability-{plan.stability_episodes}",
                    "dqn",
                    seed,
                    evaluate_policy(
                        env_config,
                        lambda _episode_seed, seed=seed: trained_agents[seed],
                        episodes=plan.stability_episodes,
                        seed=EVALUATION_SEED,
                    ),
                )
            )
        for policy in ("no-guide", "random", "safe-heuristic"):
            rows.extend(
                _episode_rows(
                    f"stability-{plan.stability_episodes}",
                    policy,
                    None,
                    _evaluate_reference_policy(
                        policy, env_config, plan.stability_episodes
                    ),
                )
            )

        raw = (
            "\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n"
        ).encode()
        summary = _derive_summary(rows, plan)
        (stage / "episodes.jsonl").write_bytes(raw)
        (stage / "summary.json").write_bytes(_json_bytes(summary))
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "sourceCommit": _source_commit(),
            "purpose": plan.purpose,
            "checkpointSchema": "fire-evacuation-v2",
            "trainingSeeds": list(plan.training_seeds),
            "trainingEpisodes": plan.training_episodes,
            "referenceEpisodes": plan.reference_episodes,
            "stabilityEpisodes": plan.stability_episodes,
            "evaluationSeed": EVALUATION_SEED,
            "envConfig": asdict(env_config),
            "dqnConfig": asdict(dqn_config),
            "runtime": {
                "python": platform.python_version(),
                "torch": torch.__version__,
                "mesa": mesa.__version__,
                "platform": platform.platform(),
                "device": "cpu",
            },
            "checkpointsSha256": checkpoint_hashes,
            "filesSha256": {
                "episodes.jsonl": _sha256_file(stage / "episodes.jsonl"),
                "summary.json": _sha256_file(stage / "summary.json"),
            },
        }
        (stage / "manifest.json").write_bytes(_json_bytes(manifest))
        verify_artifact(stage)
        output.parent.mkdir(parents=True, exist_ok=True)
        stage.rename(output)
        print(f"evidence_artifact={output}")
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def verify_artifact(output: Path) -> None:
    manifest = json.loads((output / "manifest.json").read_text())
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise SystemExit("unsupported fire evidence schema")
    plan = EvidencePlan(
        training_episodes=manifest["trainingEpisodes"],
        reference_episodes=manifest["referenceEpisodes"],
        stability_episodes=manifest["stabilityEpisodes"],
        training_seeds=tuple(manifest["trainingSeeds"]),
        purpose=manifest.get("purpose", "publication"),
    )
    for relative, expected in manifest["filesSha256"].items():
        actual = _sha256_file(output / relative)
        if actual != expected:
            raise SystemExit(f"checksum mismatch for {relative}")
    for seed, expected in manifest["checkpointsSha256"].items():
        path = output / "checkpoints" / f"seed-{seed}" / "dqn_latest.pt"
        if _sha256_file(path) != expected:
            raise SystemExit(f"checkpoint checksum mismatch for training seed {seed}")

    rows = [
        json.loads(line)
        for line in (output / "episodes.jsonl").read_text().splitlines()
    ]
    expected_rows = plan.reference_episodes * 4 + plan.stability_episodes * (
        len(plan.training_seeds) + 3
    )
    if len(rows) != expected_rows:
        raise SystemExit(f"expected {expected_rows} episode rows, found {len(rows)}")
    expected_groups = {
        (
            f"reference-{plan.reference_episodes}",
            policy,
            7 if policy == "dqn" else None,
        ): plan.reference_episodes
        for policy in ("dqn", "no-guide", "random", "safe-heuristic")
    }
    expected_groups.update(
        {
            (
                f"stability-{plan.stability_episodes}",
                "dqn",
                seed,
            ): plan.stability_episodes
            for seed in plan.training_seeds
        }
    )
    expected_groups.update(
        {
            (
                f"stability-{plan.stability_episodes}",
                policy,
                None,
            ): plan.stability_episodes
            for policy in ("no-guide", "random", "safe-heuristic")
        }
    )
    actual_groups: dict[tuple, set[int]] = {}
    for row in rows:
        key = (row["cohort"], row["policy"], row["trainingSeed"])
        indices = actual_groups.setdefault(key, set())
        if row["evaluationIndex"] in indices:
            raise SystemExit("duplicate episode in an evaluation cohort")
        indices.add(row["evaluationIndex"])
        if row["episodeSeed"] != EVALUATION_SEED + 1000 + row["evaluationIndex"]:
            raise SystemExit("episode seed/index contract mismatch")
        if (
            row["evacuated"] + row["dead"] + row["unresolved"]
            != manifest["envConfig"]["num_evacuees"]
        ):
            raise SystemExit("episode population conservation failed")

    if set(actual_groups) != set(expected_groups):
        raise SystemExit("evaluation cohort matrix differs from the declared plan")
    for key, count in expected_groups.items():
        if actual_groups[key] != set(range(count)):
            raise SystemExit(f"incomplete evaluation cohort: {key}")
    derived = _derive_summary(rows, plan)
    stored = json.loads((output / "summary.json").read_text())
    if derived != stored:
        raise SystemExit("summary.json does not match the per-episode rows")
    print("Fire/DQN evidence artifact verified.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser(
        "run", help="train, evaluate, and atomically publish evidence"
    )
    run_parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    run_parser.add_argument(
        "--smoke",
        action="store_true",
        help="diagnostic two-episode training and evaluation",
    )
    verify_parser = subparsers.add_parser(
        "verify", help="verify checksums and reconstruct all aggregates"
    )
    verify_parser.add_argument("--input", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.command == "run":
        plan = (
            EvidencePlan(
                training_episodes=2,
                reference_episodes=2,
                stability_episodes=2,
                purpose="smoke",
            )
            if args.smoke
            else EvidencePlan()
        )
        build_artifact(args.out.resolve(), plan)
    else:
        verify_artifact(args.input.resolve())


if __name__ == "__main__":
    main()
