import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401
from cgol import GameOfLife
from tensnap import (
    SimulationScenario,
    mesa_model_time,
)

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(
    port=server_port,
    use_msgpack=True,
    model_id="examples.python_mesa.cgol",
    state_schema_version="1",
)

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50

model = GameOfLife(width=MODEL_WIDTH, height=MODEL_HEIGHT)


# Main function
async def main() -> None:
    await scenario.register_model(model, model_time=lambda: int(mesa_model_time(model)))

    print(
        f"TenSnap Game of Life visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
