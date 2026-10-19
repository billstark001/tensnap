"""Model-owned checkpoints and transactional stochastic decisions."""

from __future__ import annotations

import copy
import json
from dataclasses import asdict, replace
from typing import Any

from .config import integer


def tuples(value):
    """Undo JSON's tuple-to-list conversion before Random.setstate()."""
    return tuple(tuples(item) for item in value) if isinstance(value, list) else value


class CheckpointModel:
    """Share checkpoint plumbing; subclasses own configuration and model state."""

    model_id: str
    config_type: Any
    checkpoint_version = 2

    def capture(self) -> dict:
        """Detach a complete continuation state, excluding credentials and paid usage."""
        return copy.deepcopy(
            {
                "model_id": self.model_id,
                "version": self.checkpoint_version,
                "config": asdict(self.config),
                "tick": self.tick,
                "random_state": json.dumps(self.rng.getstate()),
                "policy_random_state": json.dumps(self.policy_rng.getstate()),
                "state": self.state(),
                "decision_cursor": self.provider.cursor if self.provider else 0,
                "uses_provider": self.provider is not None,
            }
        )

    def restore(self, payload: dict) -> None:
        """Validate a fresh candidate, then install it without rewinding request costs."""
        if (payload.get("model_id"), payload.get("version")) != (
            self.model_id,
            self.checkpoint_version,
        ):
            raise ValueError(
                "Checkpoint model or schema mismatch; historical checkpoints require the Git snapshot described in HISTORY.md"
            )
        if payload.get("uses_provider") != (self.provider is not None):
            raise ValueError("Checkpoint policy mode mismatch")
        tick = integer(payload["tick"], "checkpoint tick", 0, 10**9)
        cursor = integer(payload["decision_cursor"], "decision cursor", 0, 10**9)
        # Validate a detached candidate before changing this model or provider.
        candidate = type(self)(self.config_type(**payload["config"]), self.provider)
        candidate.tick = tick
        candidate.load_state(copy.deepcopy(payload["state"]))
        candidate.rng.setstate(tuples(json.loads(payload["random_state"])))
        candidate.policy_rng.setstate(
            tuples(json.loads(payload["policy_random_state"]))
        )
        self.__dict__.update(candidate.__dict__)
        if self.provider:
            self.provider.cursor = cursor

    def reset(self, seed: int | None = None) -> None:
        """Start a fresh model with the current configuration and shared response cache."""
        config = self.config if seed is None else replace(self.config, seed=seed)
        replacement = type(self)(config, self.provider)
        self.__dict__.update(replacement.__dict__)
        if self.provider:
            self.provider.cursor = 0

    def transaction_mark(self):
        """Remember stochastic cursors before a decision that can fail or be cancelled."""
        return (
            self.rng.getstate(),
            self.policy_rng.getstate(),
            self.provider.cursor if self.provider else 0,
        )

    def transaction_rollback(self, mark) -> None:
        """Restore random draws and logical position; remote request charges persist."""
        self.rng.setstate(mark[0])
        self.policy_rng.setstate(mark[1])
        if self.provider:
            self.provider.cursor = mark[2]
