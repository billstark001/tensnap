# tensnap/examples/flock_viz.py
"""TenSnap visualization for the flocking simulation"""

import asyncio
import os
from typing import List
from tensnap import (
    TenSnapServer,
    GridEnvironmentBinder,
    make_grid_agent_accessor,
)
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import chart, button, quick_bind

# Import the pure simulation logic
from .flock import FlockSimulation, FlockConfig


# Global state - similar to original basic.py structure
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
server = TenSnapServer(port=server_port)
config = FlockConfig()
model = FlockSimulation(config)
sim_manager = SimulationManager(step_interval=0.05)

# Bind parameters automatically - exclude world dimensions as they match grid size
bound_params = quick_bind(target=config, exclude=["world_width", "world_height"])

grid = GridEnvironmentBinder(
    id="main",
    environment=model,
    agent_accessor=make_grid_agent_accessor(heading=True, color=True, icon=True),
)

async def send_updates():
    """Send environment and agent updates to the server"""
    model_updates = grid.get_model_dict()
    agent_updates = grid.get_agent_list()
    await server.update_environment("main", model_updates)
    await server.update_agents_batch("main", agent_updates)

# Initialize simulation
async def init_simulation():
    """Create initial agents"""
    grid.agents.clear()

    model.initialize()
    await sim_manager.stop()

    # Create TenSnap agents from simulation birds with custom update function
    for agent in model.birds:
        grid.add_agent(agent)
    
    sim_manager.time_step = 0
    await server.start_time_step(0)
    await send_updates()
    await server.end_time_step(0)

# Simulation step
async def on_step(step: int) -> None:
    """Run one simulation step"""
    if not model.birds:
        return
    
    await server.start_time_step(step)

    model.step()
    
    await send_updates()
    await server.end_time_step(step)



@button("reset", "Reset")
async def reset() -> None:
    await init_simulation()


# Chart functions
@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    return model.get_average_speed()


@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def calculate_order_parameter() -> float:
    return model.get_order_parameter()


# Main function
async def main() -> None:
    """Run the flock visualization"""
    # Setup
    sim_manager.on_step = on_step

    await init_simulation()

    # Register with server
    server.add_environment(grid)
    for param in bound_params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())
    sim_manager.register_to(server)

    print(f"TenSnap Flock Visualization starting on ws://localhost:{server_port}")
    print("Features: Pure simulation logic + TenSnap visualization!")
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())
