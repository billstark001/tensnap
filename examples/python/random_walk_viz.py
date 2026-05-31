"""TenSnap visualization entrypoint for the random-walk example."""

from __future__ import annotations

import asyncio
import os

import import_config  # noqa: F401

from tensnap import SimulationScenario, chart

from random_walk import RandomWalkConfig, RandomWalkSimulation

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, step_interval=0.1)

config = RandomWalkConfig()
model = RandomWalkSimulation(config)


@chart("avg_distance", "Average Distance From Center", color="#DC2626")
def track_distance() -> float:
    return model.get_average_distance()


@chart("population", "Walker Count", color="#16A34A")
def track_population() -> float:
    return float(len(model.walkers))


async def main() -> None:
    model.initialize()

    scenario.add_all(model)
    scenario.add_all(config)
    scenario.add_all(globals())

    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Random Walk started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
