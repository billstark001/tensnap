# region Imports

import asyncio
import os
from typing import cast

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import SimulationScenario, chart
from tensnap.bindings.mesa import MesaSimulationHandler
from tensnap.bindings.mesa.handler import MesaGridEnvironmentBinder
from tensnap.models import EnvironmentLayerState, EnvironmentState

from mushroom import ForagingModel, Hunter, Patch

# endregion

# region Setup

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

handler: MesaSimulationHandler | None = None

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50
NUM_CLUSTERS = 4
PATCHES_PER_CLUSTER = 20
NUM_HUNTERS = 2

# endregion

# region Custom Handler


class MushroomEnvironmentBinder(MesaGridEnvironmentBinder):
    """Expose mushroom patches as a dedicated layer beneath the moving hunters."""

    environment: ForagingModel

    def get_state(self) -> EnvironmentState:
        base_state = super().get_state()
        grid_layers = [
            layer
            for layer in base_state["layers"]
            if layer["layer_type"] == "grid"
        ]
        patch_layer: EnvironmentLayerState = {
            "layer_id": "patches",
            "layer_type": "agent",
            "data": {"z_index": 35},
            "agents": self.environment.get_patch_layer_agents(),
        }
        return {
            "id": base_state["id"],
            "type": base_state["type"],
            "layers": [
                *grid_layers,
                patch_layer,
                *[
                    layer
                    for layer in base_state["layers"]
                    if layer["layer_type"] != "grid"
                ],
            ],
        }


class MushroomSimulationHandler(MesaSimulationHandler):
    async def on_registered(self, scenario: SimulationScenario) -> None:
        first_register = scenario is not self.scenario
        await super().on_registered(scenario)

        if not first_register or self.model is None:
            return

        assert self.env_binder is not None
        scenario.remove_environment(self.env_binder.id)
        self.env_binder = MushroomEnvironmentBinder(
            self.model.__class__.__name__,
            self.model,
            agent_iterable_accessor=self.agent_iterable_accessor,
        )
        scenario.add_environment(self.env_binder)


# endregion

# region Charts


@chart(
    "mushroom_stats",
    "Mushroom Statistics",
    data_list=[
        ("red_mushrooms", "#E74C3C", "Red Mushrooms"),
        ("collected_mushrooms", "#F39C12", "Collected Mushrooms"),
    ],
)
def mushroom_stats_chart() -> dict:
    """Get mushroom statistics"""
    assert handler is not None
    assert isinstance(handler.model, ForagingModel)
    model = handler.model
    if model:
        red_count = 0
        yellow_count = 0
        for patch in model.agents_by_type[Patch]:
            if patch.color == "red":  # type: ignore
                red_count += 1
            elif patch.color == "yellow":  # type: ignore
                yellow_count += 1
        return {
            "red_mushrooms": red_count,
            "collected_mushrooms": yellow_count,
        }
    return {"red_mushrooms": 0, "collected_mushrooms": 0}


@chart("hunter_efficiency", "Hunter Efficiency", color="#3498DB")
def hunter_efficiency_chart() -> float:
    """Calculate average time since last found mushroom"""
    assert handler is not None
    assert isinstance(handler.model, ForagingModel)
    model = handler.model
    if model:
        hunters = [a for a in model.hunters if isinstance(a, Hunter)]
        if hunters:
            avg_time = sum(h.time_since_last_found for h in hunters) / len(hunters)
            return avg_time
    return 0.0


# endregion

# region Main


async def main() -> None:
    # The custom handler keeps the moving hunters and mushroom field in separate inspectable layers.
    global handler
    handler = MushroomSimulationHandler(
        model_class=ForagingModel,
        model_init_kwargs={
            "width": MODEL_WIDTH,
            "height": MODEL_HEIGHT,
            "num_clusters": NUM_CLUSTERS,
            "patches_per_cluster": PATCHES_PER_CLUSTER,
            "num_turtles": NUM_HUNTERS,
        },
        agent_iterable_accessor="hunters",
    )

    await scenario.register_handler(handler)
    scenario.add_charts(globals())

    print(
        f"TenSnap Mushroom Foraging visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())

# endregion
