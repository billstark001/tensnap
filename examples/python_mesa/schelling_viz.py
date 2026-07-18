import import_config

import asyncio
import os

import tensnap as t

from schelling import SchellingModel, SchellingAgent
from schelling_harness import model_kwargs_from_environment, SeededModelReinitializer

# region TenSnap injection
# These are monkey patching. They should be decorators by default.

t.agent(
    x="cell.coordinate[0]",
    y="cell.coordinate[1]",
    color=lambda agent: "#3498db" if agent.group == 1 else "#e74c3c",
    icon="circle",
    size=lambda agent: 1.0 if agent.is_satisfied() else 0.6,
)(SchellingAgent)


t.agent_layer()(SchellingModel)
t.env()(SchellingModel)
t.bind_kwargs(exclude=["rng"])(SchellingModel)
t.bind_datacollector()(SchellingModel)
t.params(
    exclude=["initialized", "last_swapped", "rng"],
    custom_bindings={
        "similarity_threshold": t.NumberParameter("", min=0, max=1, step=0.05),
        "density": t.NumberParameter("", min=0, max=1, step=0.05),
        "balance": t.NumberParameter("", min=0, max=1, step=0.05),
    },
)(SchellingModel)

# endregion

async def main(server_port=8765) -> None:

    scenario = t.SimulationScenario(port=server_port)
    model_kwargs = model_kwargs_from_environment()
    model = SchellingModel(**model_kwargs)

    reinitializer = SeededModelReinitializer(model, seed=model_kwargs["rng"])

    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)

    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=model.advance,
        model_reset=reinitializer.model_reset,
    )

    print(f"TenSnap Schelling visualization starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main(server_port=int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))))
