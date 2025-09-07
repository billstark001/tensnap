# tensnap/examples/flock_viz.py
"""TenSnap visualization for the flocking simulation"""

import asyncio
import os
from typing import List
from tensnap import (
    TenSnapServer,
    AgentModel,
    GridEnvironmentModel,
)
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import chart, button, quick_bind

# Import the pure simulation logic
from .flock import FlockSimulation, FlockConfig


# Global state - similar to original basic.py structure
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
server = TenSnapServer(port=server_port)
grid = GridEnvironmentModel(id="main", width=40, height=40)
agents: List[AgentModel] = []
config = FlockConfig()
simulation = FlockSimulation(config)
sim_manager = SimulationManager(step_interval=0.05)

# Bind parameters automatically - exclude world dimensions as they match grid size
bound_params = quick_bind(target=config, exclude=["world_width", "world_height"])


# Control buttons
@button("start_stop", "Start/Stop")
async def toggle() -> None:
    await sim_manager.toggle(sim_manager.time_step)


@button("reset", "Reset")
async def reset() -> None:
    await sim_manager.reset(init_simulation)


# Chart functions
@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    """Calculate average speed of all agents"""
    return simulation.get_average_speed()


@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def order_parameter() -> float:
    """Measure flock alignment (0=random, 1=aligned)"""
    return simulation.get_order_parameter()


# Initialize simulation
def init_simulation() -> None:
    """Create initial agents"""
    global agents
    agents.clear()
    grid.agents.clear()

    sim_manager.time_step = 0
    simulation.initialize()

    # Create TenSnap agents from simulation birds with custom update function
    for bird in simulation.birds:
        agent = AgentModel(
            id=bird.id,
            x=bird.x,
            y=bird.y,
            heading=bird.heading,
            color="#4A90E2",
            icon="arrow",
            size=8,
            # Set the bird as the update source
            update_source=bird,
        )
        agents.append(agent)
        grid.add_agent(agent)


# Simulation step
@button("step", "Evolve 1 Step")
async def simulation_step() -> None:
    """Run one simulation step"""
    if not simulation.birds:
        return

    await server.start_time_step(sim_manager.time_step)

    simulation.step()

    updates = grid.generate_agent_updates()
    await server.update_agents_batch("main", updates)

    await server.end_time_step()


# Main function
async def main() -> None:
    """Run the flock visualization"""
    # Setup
    sim_manager.init_func = init_simulation
    sim_manager.step_func = simulation_step

    init_simulation()

    # Register with server
    server.add_environment(grid)
    for param in bound_params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())

    print(f"TenSnap Flock Visualization starting on ws://localhost:{server_port}")
    print("Features: Pure simulation logic + TenSnap visualization!")
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())
