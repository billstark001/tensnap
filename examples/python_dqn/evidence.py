"""Build and verify the publication evidence for the Fire/DQN example.

The ordinary ``main --mode compare`` command is useful for exploration, but its
terminal output is not an archival result.  This module executes the declared
training/evaluation matrix, saves per-episode rows and checkpoints, and verifies
that every published aggregate can be reconstructed from those rows.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
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
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "artifacts" / "fire-dqn-v2"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


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
        raise SystemExit("fire evidence requires an identifiable Git checkout") from error
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


def _derive_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    reference = {
        policy: _summary(
            _group_rows(
                rows,
                cohort="reference-100",
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
                cohort="stability-500",
                policy="dqn",
                training_seed=seed,
            )
        )
        for seed in TRAINING_SEEDS
    }
    stability_baselines = {
        policy: _summary(
            _group_rows(
                rows,
                cohort="stability-500",
                policy=policy,
                training_seed=None,
            )
        )
        for policy in ("no-guide", "random", "safe-heuristic")
    }
    evacuated = [stability_by_seed[str(seed)]["evacuated"] for seed in TRAINING_SEEDS]
    return {
        "reference100": reference,
        "stability500": {
            "dqnByTrainingSeed": stability_by_seed,
            "dqnAcrossTrainingSeeds": {
                "trainingSeeds": list(TRAINING_SEEDS),
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


def build_artifact(output: Path) -> None:
    if output.exists():
        raise SystemExit(f"refusing to overwrite existing evidence artifact: {output}")
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
        for seed in TRAINING_SEEDS:
            print(f"training_seed={seed}", flush=True)
            _set_training_seed(seed)
            seed_directory = checkpoints / f"seed-{seed}"
            artifacts = train_dqn(
                env_config,
                dqn_config,
                TrainingConfig(
                    episodes=500,
                    seed=seed,
                    checkpoint_dir=seed_directory,
                    checkpoint_every=500,
                    log_every=100,
                ),
                device="cpu",
            )
            trained_agents[seed] = artifacts.agent
            latest = seed_directory / "dqn_latest.pt"
            periodic = seed_directory / "dqn_ep_500.pt"
            if periodic.exists():
                periodic.unlink()
            checkpoint_hashes[str(seed)] = _sha256_file(latest)

        print("evaluating_reference_100", flush=True)
        reference_dqn = evaluate_policy(
            env_config,
            lambda _seed: trained_agents[7],
            episodes=REFERENCE_EPISODES,
            seed=EVALUATION_SEED,
        )
        rows.extend(_episode_rows("reference-100", "dqn", 7, reference_dqn))
        for policy in ("no-guide", "random", "safe-heuristic"):
            rows.extend(
                _episode_rows(
                    "reference-100",
                    policy,
                    None,
                    _evaluate_reference_policy(policy, env_config, REFERENCE_EPISODES),
                )
            )

        print("evaluating_stability_500", flush=True)
        for seed in TRAINING_SEEDS:
            rows.extend(
                _episode_rows(
                    "stability-500",
                    "dqn",
                    seed,
                    evaluate_policy(
                        env_config,
                        lambda _episode_seed, seed=seed: trained_agents[seed],
                        episodes=STABILITY_EPISODES,
                        seed=EVALUATION_SEED,
                    ),
                )
            )
        for policy in ("no-guide", "random", "safe-heuristic"):
            rows.extend(
                _episode_rows(
                    "stability-500",
                    policy,
                    None,
                    _evaluate_reference_policy(policy, env_config, STABILITY_EPISODES),
                )
            )

        raw = ("\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n").encode()
        summary = _derive_summary(rows)
        (stage / "episodes.jsonl").write_bytes(raw)
        (stage / "summary.json").write_bytes(_json_bytes(summary))
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "sourceCommit": _source_commit(),
            "checkpointSchema": "fire-evacuation-v2",
            "trainingSeeds": list(TRAINING_SEEDS),
            "trainingEpisodes": 500,
            "referenceEpisodes": REFERENCE_EPISODES,
            "stabilityEpisodes": STABILITY_EPISODES,
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
    for relative, expected in manifest["filesSha256"].items():
        actual = _sha256_file(output / relative)
        if actual != expected:
            raise SystemExit(f"checksum mismatch for {relative}")
    for seed, expected in manifest["checkpointsSha256"].items():
        path = output / "checkpoints" / f"seed-{seed}" / "dqn_latest.pt"
        if _sha256_file(path) != expected:
            raise SystemExit(f"checkpoint checksum mismatch for training seed {seed}")

    rows = [json.loads(line) for line in (output / "episodes.jsonl").read_text().splitlines()]
    expected_rows = (
        REFERENCE_EPISODES * 4
        + STABILITY_EPISODES * (len(TRAINING_SEEDS) + 3)
    )
    if len(rows) != expected_rows:
        raise SystemExit(f"expected {expected_rows} episode rows, found {len(rows)}")
    for row in rows:
        if row["episodeSeed"] != EVALUATION_SEED + 1000 + row["evaluationIndex"]:
            raise SystemExit("episode seed/index contract mismatch")
        if row["evacuated"] + row["dead"] + row["unresolved"] != 28:
            raise SystemExit("episode population conservation failed")

    derived = _derive_summary(rows)
    stored = json.loads((output / "summary.json").read_text())
    if derived != stored:
        raise SystemExit("summary.json does not match the per-episode rows")
    print("Fire/DQN evidence artifact verified.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser("run", help="train, evaluate, and atomically publish evidence")
    run_parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    verify_parser = subparsers.add_parser("verify", help="verify checksums and reconstruct all aggregates")
    verify_parser.add_argument("--input", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.command == "run":
        build_artifact(args.out.resolve())
    else:
        verify_artifact(args.input.resolve())


if __name__ == "__main__":
    main()
