import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import (
    BoundModelReinitializer,
    SimulationScenario,
)

from cgol import GameOfLife

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50

model = GameOfLife(width=MODEL_WIDTH, height=MODEL_HEIGHT)
reinitializer = BoundModelReinitializer(model)


# Main function
async def main() -> None:
    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)
    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=lambda: model.step(),
        model_reset=reinitializer.model_reset,
    )

    print(
        f"TenSnap Game of Life visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
