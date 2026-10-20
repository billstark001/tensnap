"""Schelling publication-profile configuration for the shared Mesa example.

This module translates a publication profile's environment variables into the
shared example model's constructor arguments.

This adapter is benchmark infrastructure, not code required to bind a
Schelling model to TenSnap.
"""

import os
from typing import Any

import model as s


def _environment_int(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


def _environment_float(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def model_kwargs_from_environment() -> dict[str, Any]:
    """Return the canonical Schelling startup settings supplied by a profile."""
    seed = _environment_int("TENSNAP_SCHELLING_SEED", 7)
    return {
        "width": _environment_int("TENSNAP_SCHELLING_WIDTH", s.DEFAULT_GRID_W),
        "height": _environment_int("TENSNAP_SCHELLING_HEIGHT", s.DEFAULT_GRID_H),
        "density": _environment_float("TENSNAP_SCHELLING_DENSITY", s.DEFAULT_DENSITY),
        "balance": _environment_float("TENSNAP_SCHELLING_BALANCE", s.DEFAULT_BALANCE),
        "similarity_threshold": _environment_float(
            "TENSNAP_SCHELLING_THRESHOLD", s.DEFAULT_SIMILARITY_THRESHOLD
        ),
        "collect_data": os.environ.get("TENSNAP_SCHELLING_COLLECT_DATA", "true").lower()
        == "true",
        "seed": seed,
    }
