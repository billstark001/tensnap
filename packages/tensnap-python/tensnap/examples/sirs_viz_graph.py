import asyncio
import os

from tensnap import (
    SimulationScenario,
    GraphEnvironmentBinder,
)

# Import the pure simulation logic
from .sirs import SIRSSimulation, ERNetworkEnvironment


server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

beta = 0.3  # Infection rate
gamma = 0.1  # Recovery rate
xi = 0.05  # Loss of immunity rate
env = ERNetworkEnvironment(num_agents=100, connection_prob=0.05)
model = SIRSSimulation(env, beta, gamma, xi, initial_infected=5)

graph = GraphEnvironmentBinder(
    id="sirs_graph",
    environment=env,
)


async def main():

    model.init()

    await scenario.register_model_handler(
        model.init,
        model.step,
    )

    scenario.add_environment(graph)
    scenario.add_charts(model)
    scenario.add_parameters(model)
    scenario.add_parameters(env)
    scenario.add_actions({})

    print(f"Starting TenSnap server on port {server_port}...")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
