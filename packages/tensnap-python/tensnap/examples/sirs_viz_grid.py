import asyncio
import os

from tensnap import (
    chart,
    SimulationScenario,
    GridEnvironmentBinder,
    make_grid_environment_accessor,
)

# Import the pure simulation logic
from .sirs import SIRSSimulation, GridEnvironment


server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

beta = 0.3  # Infection rate
gamma = 0.1  # Recovery rate
xi = 0.05  # Loss of immunity rate
env = GridEnvironment(rows=40, cols=40)
model = SIRSSimulation(env, beta, gamma, xi, initial_infected=5)

grid = GridEnvironmentBinder(
    id="sirs_grid",
    environment=env,
    environment_accessor=make_grid_environment_accessor(
        id="sirs_grid", background=True
    ),
)



@chart("s", "Susceptible", color="#3498DB")
def calculate_susceptible() -> float:
    return model.history["susceptible"][-1]


@chart("i", "Infected", color="#E74C3C")
def calculate_infected() -> float:
    return model.history["infected"][-1]


@chart("r", "Recovered", color="#2ECC71")
def calculate_recovered() -> float:
    return model.history["recovered"][-1]


async def main():
    
    
    model.init()
    
    
    scenario.register_model_handler(
        model.init,
        model.step,
    )

    scenario.add_environment(grid)
    scenario.add_charts(globals())
    scenario.add_parameters(model)
    scenario.add_parameters(env)
    scenario.add_actions({})

    print(f"Starting TenSnap server on port {server_port}...")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
