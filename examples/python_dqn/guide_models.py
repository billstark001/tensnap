"""Guide policy checkpoint discovery shared by visualization entrypoints."""

from __future__ import annotations

import os
from pathlib import Path

UNTRAINED_GUIDE_MODEL = "untrained"
CHECKPOINT_EXTENSIONS = (".pt", ".pth")


def default_checkpoint_dir() -> Path:
    return Path(__file__).resolve().parent / "checkpoints"


def guide_model_dir_from_env() -> Path:
    return Path(os.environ.get("DQN_GUIDE_MODEL_DIR", default_checkpoint_dir()))


def discover_guide_models(directory: Path) -> list[str]:
    if not directory.exists():
        return [UNTRAINED_GUIDE_MODEL]
    checkpoints = sorted(
        path.name
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in CHECKPOINT_EXTENSIONS
    )
    return [UNTRAINED_GUIDE_MODEL, *checkpoints]
