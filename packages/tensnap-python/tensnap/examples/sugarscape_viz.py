import asyncio
import os
from typing import cast

import numpy as np

from tensnap import SimulationScenario, chart
from tensnap.bindings.mesa import MesaSimulationHandler

from .sugarscape import SugarAgent, Sugarscape

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

handler: MesaSimulationHandler | None = None

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
    assert handler is not None
    assert isinstance(handler.model, Sugarscape)
    model = handler.model
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
    # Create Mesa simulation handler
    global handler
    handler = MesaSimulationHandler(
        model_class=Sugarscape,
        model_init_kwargs={
            "width": MODEL_WIDTH,
            "height": MODEL_HEIGHT,
            "agent_count": AGENT_COUNT,
        },
    )

    await scenario.register_handler(handler)
    scenario.add_charts(globals())

    print(f"TenSnap Sugarscape visualization starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
