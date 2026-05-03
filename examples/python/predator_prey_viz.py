"""TenSnap visualization entrypoint for the predator-prey example."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import import_config  # noqa: F401

from tensnap import BindParametersConfig, SimulationScenario, chart

from predator_prey import (
    PredatorPreyConfig,
    PredatorPreySimulation,
    SHEEP_ASSET_ID,
    WOLF_ASSET_ID,
)

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, step_interval=0.15)

config = PredatorPreyConfig()
model = PredatorPreySimulation(config)


def resolve_asset_path(name: str) -> Path:
    local_assets = Path(__file__).resolve().parent / "assets" / name
    repo_assets = Path(__file__).resolve().parents[2] / "assets" / name
    for candidate in (local_assets, repo_assets):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Could not find asset '{name}'. Checked {local_assets} and {repo_assets}."
    )


async def publish_animal_assets() -> None:
    await scenario.server.publish_asset(
        SHEEP_ASSET_ID,
        resolve_asset_path("sheep.svg").read_bytes(),
        "image/svg+xml",
        label="Sheep",
    )
    await scenario.server.publish_asset(
        WOLF_ASSET_ID,
        resolve_asset_path("wolf.svg").read_bytes(),
        "image/svg+xml",
        label="Wolf",
    )


@chart("sheep_count", "Sheep", color="#F8FAFC")
def track_sheep() -> float:
    return model.get_sheep_count()


@chart("wolf_count", "Wolves", color="#111827")
def track_wolves() -> float:
    return model.get_wolf_count()


@chart("grass_fraction", "Available Grass", color="#16A34A")
def track_grass() -> float:
    return model.get_available_grass_fraction()


async def main() -> None:
    model.initialize()
    await publish_animal_assets()

    scenario.add_environment(model)
    scenario.add_parameters(config, BindParametersConfig(exclude=["width", "height"]))
    scenario.add_charts(globals())

    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Predator-Prey started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())