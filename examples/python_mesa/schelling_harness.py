'''
Schelling model harness for TenSnap.

This module provides a function to extract model parameters 
from environment variables and a class to preserve the random 
seed across model resets.

The codes in this module should not be considered as part of 
the codes necessary to bind the Schelling model to TenSnap, 
but rather as a utility to facilitate the benchmarking.
'''

from typing import Any

import os

from tensnap import BoundModelReinitializer

import schelling as s

def _environment_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _environment_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def model_kwargs_from_environment() -> dict[str, Any]:
    """Return the canonical Schelling startup settings supplied by a profile."""
    raw_seed = os.environ.get("TENSNAP_SCHELLING_SEED", "").strip()
    try:
        seed = int(raw_seed) if raw_seed else None
    except ValueError:
        seed = None
    return {
        "width": _environment_int("TENSNAP_SCHELLING_WIDTH", s.DEFAULT_GRID_W),
        "height": _environment_int("TENSNAP_SCHELLING_HEIGHT", s.DEFAULT_GRID_H),
        "density": _environment_float("TENSNAP_SCHELLING_DENSITY", s.DEFAULT_DENSITY),
        "balance": _environment_float("TENSNAP_SCHELLING_BALANCE", s.DEFAULT_BALANCE),
        "similarity_threshold": _environment_float(
            "TENSNAP_SCHELLING_THRESHOLD", s.DEFAULT_SIMILARITY_THRESHOLD
        ),
        "rng": seed,
    }


class SeededModelReinitializer(BoundModelReinitializer):
    """Keep the profile seed when a TenSnap client initializes or resets the model."""

    def __init__(self, model: s.SchellingModel, *, seed: int | None) -> None:
        # ``rng`` is intentionally not a UI parameter, so preserve the profile value
        # across the model_init call made when the Web client attaches and on Reset.
        super().__init__(model)
        self._seed = seed

    def current_kwargs(self):
        return {**super().current_kwargs(), "rng": self._seed}
