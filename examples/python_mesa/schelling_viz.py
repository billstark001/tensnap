import import_config

import asyncio
from tensnap import SimulationScenario
from schelling import SchellingModel

# region TenSnap injection
# These are monkey patching. They should be decorators by default.

from tensnap import (
    agent_layer,
    env,
    bind_datacollector,
    params,
    NumberParameter,
    bind_kwargs,
    BoundModelReinitializer,
)
from tensnap.utils.object import extend


@extend(SchellingModel)
def project_agent(self, agent):
    return {
        "id": str(agent.unique_id),
        "x": agent.cell.coordinate[0],
        "y": agent.cell.coordinate[1],
        "heading": 0,
        "color": "#3498db" if agent.group == 1 else "#e74c3c",
        "icon": "circle",
        "size": 1.0 if agent.is_satisfied() else 0.6,
        "data": {"group": agent.group},
    }


agent_layer(width=True, height=True, item_dynamic_projector="project_agent")(
    SchellingModel
)
env()(SchellingModel)
bind_kwargs(exclude=["rng"])(SchellingModel)
bind_datacollector()(SchellingModel)
params(
    exclude=["initialized", "last_swapped", "rng"],
    custom_bindings={
        "similarity_threshold": NumberParameter("", min=0, max=1, step=0.05),
        "density": NumberParameter("", min=0, max=1, step=0.05),
        "balance": NumberParameter("", min=0, max=1, step=0.05),
    },
)(SchellingModel)

# endregion


async def main(server_port=8765) -> None:

    scenario = SimulationScenario(port=server_port)
    model = SchellingModel()

    reinitializer = BoundModelReinitializer(model)

    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)

    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=model.advance,
        model_reset=reinitializer.model_reset,
    )

    print(
        f"TenSnap Schelling visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
