import asyncio
import os
from typing import cast

import numpy as np

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import SimulationScenario, chart
from tensnap.bindings.mesa import MesaSimulationHandler
from tensnap.models import EnvironmentBindingBuilder
from tensnap.models.agent import make_grid_agent_accessor

from sugarscape import SugarAgent, Sugarscape

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

handler: MesaSimulationHandler | None = None

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50
AGENT_COUNT = 400
class SugarscapeSimulationHandler(MesaSimulationHandler):
    async def on_registered(self, scenario: SimulationScenario) -> None:
        first_register = scenario is not self.scenario
        await super().on_registered(scenario)

        if not first_register or self.model is None:
            return

        assert self.env_binder is not None
        scenario.remove_environment(self.env_binder.id)
        builder = EnvironmentBindingBuilder(environment_type="2d")
        builder.add_agent_layer(
            layer_id="sugar",
            item_iterable_accessor=lambda env: env.sugar_patches,
            item_accessor=lambda patch: patch.to_agent_state(),
        )
        builder.add_trajectory_layer(
            layer_id="trails",
            metadata={"length": 2},
            dependency_layer_ids={"agent": "agents"},
        )
        builder.add_grid_layer(
            metadata_accessor=lambda env: {
                "width": env.grid.width,
                "height": env.grid.height,
            }
        )
        builder.add_agent_layer(
            layer_id="agents",
            item_iterable_accessor=lambda env: env.agents,
            item_accessor=make_grid_agent_accessor(
                id="unique_id",
                x="pos[0]",
                y="pos[1]",
                color=True,
            ),
        )
        self.env_binder = builder.build(self.model.__class__.__name__, self.model)
        scenario.add_environment(self.env_binder)


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
    # The custom handler keeps Mesa's convenience API while exposing the sugar field as a dedicated resource layer.
    global handler
    handler = SugarscapeSimulationHandler(
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
