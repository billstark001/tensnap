"""Thin compatibility import for the user-facing Mesa Schelling model."""

from pathlib import Path
import sys

EXAMPLE_DIR = Path(__file__).parents[5] / "examples/python_mesa"
if str(EXAMPLE_DIR) not in sys.path:
    sys.path.insert(0, str(EXAMPLE_DIR))

from schelling import (  # noqa: E402
    DEFAULT_BALANCE,
    DEFAULT_DENSITY,
    DEFAULT_GRID_H,
    DEFAULT_GRID_W,
    DEFAULT_SIMILARITY_THRESHOLD,
    SCHELLING_DYNAMICS_VERSION,
    SchellingAgent,
    SchellingModel,
)

if SCHELLING_DYNAMICS_VERSION != 1:
    raise RuntimeError("Schelling benchmark v1 requires dynamics contract version 1")

__all__ = [
    "DEFAULT_BALANCE",
    "DEFAULT_DENSITY",
    "DEFAULT_GRID_H",
    "DEFAULT_GRID_W",
    "DEFAULT_SIMILARITY_THRESHOLD",
    "SchellingAgent",
    "SchellingModel",
]
