import asyncio
import os
from typing import cast

import numpy as np

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import (
    BoundModelReinitializer,
    SimulationScenario,
    chart,
)

from sugarscape import SugarAgent, Sugarscape

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

model: Sugarscape | None = None

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50
AGENT_COUNT = 400


@chart(
    "resource_metrics",
    "Resource Metrics",
    data_list=[
        ("total_sugar", "#F39C12", "Total Sugar in System"),
        ("sugar_on_ground", "#95A5A6", "Sugar on Ground"),
    ],
)
def resource_metrics_chart() -> dict:
    """Get resource metrics"""
    assert model is not None
    if model:
        sugar_on_ground = float(np.sum(model.sugar))
        agent_sugar = sum(cast(SugarAgent, a).sugar for a in model.agents)
        total_sugar = sugar_on_ground + agent_sugar

        return {
            "total_sugar": total_sugar,
            "sugar_on_ground": sugar_on_ground,
        }
    return {"total_sugar": 0.0, "sugar_on_ground": 0.0}


# Main function
async def main() -> None:
    global model
    model = Sugarscape(
        width=MODEL_WIDTH,
        height=MODEL_HEIGHT,
        agent_count=AGENT_COUNT,
    )
    reinitializer = BoundModelReinitializer(model)
    assert model is not None

    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)
    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=model.step,
        model_reset=reinitializer.model_reset,
    )

    scenario.add_all(globals())

    print(f"TenSnap Sugarscape visualization starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
