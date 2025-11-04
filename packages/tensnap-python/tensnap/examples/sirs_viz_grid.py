import asyncio
import os
from typing import List
from tensnap import (
    TenSnapServer,
    GridEnvironmentBinder,
    make_grid_environment_accessor,
)
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import chart, action, quick_bind

# Import the pure simulation logic
from .sirs import SIRSSimulation, GridEnvironment


server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
server = TenSnapServer(port=server_port, use_msgpack=True)
sim_manager = SimulationManager(step_interval=0.05)


beta = 0.3  # Infection rate
gamma = 0.1  # Recovery rate
xi = 0.05  # Loss of immunity rate
env = GridEnvironment(rows=40, cols=40)
model = SIRSSimulation(env, beta, gamma, xi, initial_infected=5)

bound_params = quick_bind(
    target=model, include=["beta", "gamma", "xi", "initial_infected"]
)

grid = GridEnvironmentBinder(
    id="sirs_grid",
    environment=env,
    environment_accessor=make_grid_environment_accessor(
        id="sirs_grid", background=True
    ),
)


async def send_updates():
    """Send environment and agent updates to the server"""
    model_updates = grid.get_model_dict()
    await server.update_environment("sirs_grid", model_updates)


async def init_simulation():
    model.init()
    await sim_manager.stop()

    # since agents are plotted as the grid's background, no agents are added to the binder

    sim_manager.time_step = 0
    await server.start_time_step(0)
    await send_updates()
    await server.end_time_step(0)


async def on_step(step: int) -> None:
    """Run one simulation step"""
    await server.start_time_step(step)
    model.step()
    await send_updates()
    await server.end_time_step(step)


@action("reset", "Reset")
async def reset() -> None:
    await init_simulation()


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

    sim_manager.on_step = on_step

    await init_simulation()

    server.add_environment(grid)
    for param in bound_params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())
    sim_manager.register_to(server)

    print(f"Starting TenSnap server on port {server_port}...")
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())
