import asyncio
import os
from typing import cast

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import SimulationScenario
from tensnap.bindings.mesa import (
    MesaSimulationHandler,
)

from cgol import GameOfLife

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50


# Main function
async def main() -> None:
    # MesaSimulationHandler now syncs through the canonical 2d/layer environment model under the hood.
    handler = MesaSimulationHandler(
        model_class=GameOfLife,
        model_init_kwargs={"width": MODEL_WIDTH, "height": MODEL_HEIGHT},
    )

    await scenario.register_handler(handler)

    print(
        f"TenSnap Game of Life visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
