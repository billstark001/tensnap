"""Training environment adapters for the evacuation DQN example."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import torch
from torch import Tensor

from .config import EnvConfig, build_evacuation_layout
from .model import EvacuationModel

EnvKind = Literal["mesa", "netlogo"]


class EvacuationEnv(Protocol):
    @property
    def action_size(self) -> int: ...

    @property
    def state_size(self) -> int: ...

    @property
    def evacuated_count(self) -> int: ...

    @property
    def dead_count(self) -> int: ...

    def reset(self, seed: int | None = None) -> Tensor: ...

    def step(self, action: int) -> tuple[Tensor, float, bool, dict[str, float]]: ...

    def close(self) -> None: ...


class MesaEvacuationEnv:
    """Mesa implementation of the DQN environment protocol."""

    def __init__(self, config: EnvConfig, seed: int | None = None) -> None:
        self.config = config
        self.model = EvacuationModel(config, seed=seed)

    @property
    def action_size(self) -> int:
        return self.model.action_size

    @property
    def state_size(self) -> int:
        return self.model.state_size

    @property
    def evacuated_count(self) -> int:
        return self.model.evacuated_count

    @property
    def dead_count(self) -> int:
        return self.model.dead_count

    def reset(self, seed: int | None = None) -> Tensor:
        self.model = EvacuationModel(self.config, seed=seed)
        return self.model.get_state()

    def step(self, action: int) -> tuple[Tensor, float, bool, dict[str, float]]:
        return self.model.env_step(action)

    def close(self) -> None:
        return None


@dataclass(slots=True)
class NetLogoEnvConfig:
    model_path: Path | None = None
    netlogo_home: Path | None = None
    gui: bool = False


class NetLogoEvacuationEnv:
    """NetLogo implementation of the DQN environment protocol.

    This adapter intentionally keeps Python in control of the DQN action. The
    NetLogo model runs with `use-python-policy?` disabled, and each step writes
    the selected action into NetLogo before calling `go`.
    """

    action_size = 5
    state_size = 16

    def __init__(
        self,
        config: EnvConfig,
        seed: int | None = None,
        netlogo_config: NetLogoEnvConfig | None = None,
    ) -> None:
        self.config = config
        self.netlogo_config = netlogo_config or NetLogoEnvConfig()
        self.model_path = (
            self.netlogo_config.model_path
            or Path(__file__).resolve().parent / "netlogo" / "evac_dqn_netlogo.nlogox"
        )
        self._validate_supported_layout()

        try:
            import pynetlogo  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "NetLogo training requires the optional 'pynetlogo' package and a "
                "local NetLogo installation. Install pyNetLogo or use '--env mesa'."
            ) from exc

        kwargs = {"gui": self.netlogo_config.gui}
        if self.netlogo_config.netlogo_home is not None:
            kwargs["netlogo_home"] = str(self.netlogo_config.netlogo_home)
        self._link = pynetlogo.NetLogoLink(**kwargs)
        self._link.load_model(str(self.model_path))
        self.reset(seed=seed)

    @property
    def evacuated_count(self) -> int:
        return int(self._link.report("evacuated-count"))

    @property
    def dead_count(self) -> int:
        return int(self._link.report("dead-count"))

    def reset(self, seed: int | None = None) -> Tensor:
        self._configure_model(seed)
        self._link.command("setup")
        return self.get_state()

    def step(self, action: int) -> tuple[Tensor, float, bool, dict[str, float]]:
        action = max(0, min(self.action_size - 1, int(action)))
        self._link.command(f"set training-action {action}")
        self._link.command("go")
        info = {
            "alive": float(self._link.report("alive-count")),
            "evacuated": float(self._link.report("evacuated-count")),
            "dead": float(self._link.report("dead-count")),
            "congestion": float(self._link.report("congestion")),
        }
        return (
            self.get_state(),
            float(self._link.report("last-reward")),
            bool(self._link.report("done?")),
            info,
        )

    def get_state(self) -> Tensor:
        values = self._link.report("dqn-state-values")
        return torch.Tensor([float(value) for value in values])

    def close(self) -> None:
        kill = getattr(self._link, "kill_workspace", None)
        if callable(kill):
            kill()

    def _configure_model(self, seed: int | None) -> None:
        values: dict[str, int | float | str | bool] = {
            "grid-width": self.config.width,
            "grid-height": self.config.height,
            "num-evacuees": self.config.num_evacuees,
            "max-steps": self.config.max_steps,
            "guide-influence-radius": self.config.guide_influence_radius,
            "guide-follow-bias": self.config.guide_follow_bias,
            "random-move-bias": self.config.random_move_bias,
            "fire-spread-interval": self.config.fire_spread_interval,
            "evacuation-reward": self.config.evacuation_reward,
            "fire-reward-penalty": self.config.fire_reward_penalty,
            "step-penalty": self.config.step_penalty,
            "congestion-penalty": self.config.congestion_penalty,
            "clustering-bonus": self.config.clustering_bonus,
            "seed": 0 if seed is None else seed,
            "training-action": 0,
            "use-python-policy?": False,
            "repo-root": "auto",
            "python-executable": "",
            "checkpoint-dir": "",
            "guide-model": "untrained",
        }
        for name, value in values.items():
            self._link.command(f"set {name} {self._format_value(value)}")

    def _validate_supported_layout(self) -> None:
        exits, fire_sources, walls = build_evacuation_layout(
            self.config.width,
            self.config.height,
        )
        if (
            tuple(self.config.exits) != exits
            or tuple(self.config.fire_sources) != fire_sources
            or set(self.config.walls) != set(walls)
        ):
            raise ValueError(
                "The NetLogo adapter currently supports the canonical generated "
                "layout only. Build EnvConfig with build_evacuation_layout(...) "
                "or use '--env mesa' for custom exits, fire sources, or walls."
            )

    @staticmethod
    def _format_value(value: int | float | str | bool) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, str):
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            return f'"{escaped}"'
        return str(value)


def make_evacuation_env(
    env_kind: EnvKind,
    config: EnvConfig,
    seed: int | None = None,
    netlogo_config: NetLogoEnvConfig | None = None,
) -> EvacuationEnv:
    if env_kind == "mesa":
        return MesaEvacuationEnv(config, seed=seed)
    if env_kind == "netlogo":
        return NetLogoEvacuationEnv(config, seed=seed, netlogo_config=netlogo_config)
    raise ValueError(f"Unknown evacuation environment: {env_kind}")
