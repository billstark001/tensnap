# examples/python/flock_viz.py
"""TenSnap visualization for the flocking simulation"""

import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import (
    chart,
    SimulationScenario,
    BindParametersConfig,
)

from flock import FlockSimulation, FlockConfig

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

config = FlockConfig()
model = FlockSimulation(config)

# Chart functions
@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    return model.get_average_speed()


@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def calculate_order_parameter() -> float:
    return model.get_order_parameter()


# Main function
async def main() -> None:
    """Run the flock visualization"""

    model.initialize()

    scenario.add_environment(model)
    scenario.add_parameters(config, BindParametersConfig(exclude="world_.+"))
    scenario.add_charts(globals())

    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Flock Visualization started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
