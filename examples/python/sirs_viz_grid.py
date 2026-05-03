import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import (
    SimulationScenario,
)

# Import the pure simulation logic
from sirs import SIRSSimulation, GridEnvironment

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

beta = 0.3  # Infection rate
gamma = 0.1  # Recovery rate
xi = 0.05  # Loss of immunity rate
env = GridEnvironment(rows=40, cols=40)
model = SIRSSimulation(env, beta, gamma, xi, initial_infected=5)


async def main():

    model.init()

    scenario.add_environment(env)
    scenario.add_charts(model)
    scenario.add_parameters(model)
    scenario.add_parameters(env)
    scenario.add_actions({})

    await scenario.register_model_handler(
        model.init,
        model.step,
        model.init,
    )

    print(f"Starting TenSnap server on port {server_port}...")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
