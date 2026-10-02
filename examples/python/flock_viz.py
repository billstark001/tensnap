# examples/python/flock_viz.py
"""TenSnap visualization for the flocking simulation"""

import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401
from flock import FlockConfig, FlockSimulation
from tensnap import (
    SimulationScenario,
    chart,
)

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(
    port=server_port,
    model_id="examples.python.flock",
    state_schema_version="1",
)

config = FlockConfig()
model = FlockSimulation(config)


# These two model-wide dynamics share a chart group. Returning a dict keyed by
# series id also keeps this example compatible with older v0.3 installations.
@chart(
    "average_speed",
    "Flock Dynamics",
    data_list=[
        ("average_speed", "#2ECC71", "Average Speed"),
        ("order_parameter", "#E74C3C", "Flock Order Parameter"),
    ],
)
def calculate_flock_dynamics() -> dict[str, float]:
    return {
        "average_speed": model.get_average_speed(),
        "order_parameter": model.get_order_parameter(),
    }


# Main function
async def main() -> None:
    """Run the flock visualization"""

    model.initialize()

    scenario.add_all(model)
    scenario.add_all(config)
    scenario.add_all(globals())
    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Flock Visualization started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
