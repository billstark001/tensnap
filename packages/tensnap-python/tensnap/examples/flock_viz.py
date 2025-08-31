# tensnap/examples/flock_viz.py
"""TenSnap visualization for the flocking simulation"""

import asyncio
from typing import List
from tensnap import (
    TenSnapServer,
    Agent,
    GridEnvironment,
    SimulationManager,
    bind_parameters_batch,
    ParameterBinding,
)
from tensnap.decorators import chart, button

# Import the pure simulation logic
from .flock import FlockSimulation, FlockConfig


# Global state - similar to original basic.py structure
server = TenSnapServer()
grid = GridEnvironment(id="main", width=40, height=40)
agents: List[Agent] = []
config = FlockConfig()
simulation = FlockSimulation(config)
sim_manager = SimulationManager(step_interval=0.05)
time_step = 0

# Bind parameters with type safety
parameters: List[ParameterBinding] = [
    {
        "key": "separation_distance",
        "id": "sep",
        "label": "Separation",
        "min": 0.5,
        "max": 5.0,
        "step": 0.1,
    },
    {
        "key": "alignment_distance",
        "id": "align",
        "label": "Alignment",
        "min": 1.0,
        "max": 10.0,
        "step": 0.5,
    },
    {
        "key": "cohesion_distance",
        "id": "cohesion",
        "label": "Cohesion",
        "min": 2.0,
        "max": 15.0,
        "step": 0.5,
    },
    {
        "key": "max_speed",
        "id": "speed",
        "label": "Max Speed",
        "min": 0.1,
        "max": 2.0,
        "step": 0.1,
    },
    {
        "key": "num_agents",
        "id": "agents",
        "label": "Agents",
        "min": 10,
        "max": 100,
        "step": 10,
    },
]

bound_params = bind_parameters_batch(config, parameters)


# Control buttons
@button("start_stop", "Start/Stop")
async def toggle() -> None:
    await sim_manager.toggle(time_step)


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
    global agents, time_step
    time_step = 0
    agents.clear()
    grid.agents.clear()
    
    # Update simulation config and initialize
    simulation.config = config
    simulation.initialize()
    
    # Create TenSnap agents from simulation birds
    for bird in simulation.birds:
        agent = Agent(
            id=bird.id,
            x=bird.x,
            y=bird.y,
            heading=bird.heading,
            color="#4A90E2",
            icon="arrow",
            size=8,
        )
        agents.append(agent)
        grid.add_agent(agent)


# Simulation step
@button("step", "Evolve 1 Step")
async def simulation_step() -> None:
    """Run one simulation step"""
    global time_step
    if not simulation.birds:
        return

    await server.start_time_step(time_step)

    # Update simulation config in case parameters changed
    simulation.config = config
    
    # Step the simulation
    simulation.step()
    
    # Update TenSnap agents with new bird positions
    updates = []
    for i, bird in enumerate(simulation.birds):
        if i < len(agents):
            agent = agents[i]
            agent.x = bird.x
            agent.y = bird.y
            agent.heading = bird.heading
            
            updates.append({
                "id": agent.id,
                "data": {
                    "x": agent.x,
                    "y": agent.y,
                    "heading": agent.heading
                }
            })

    # Send batch update
    await server.update_agents_batch("main", updates)
    await server.end_time_step()
    time_step += 1


# Main function
async def run_flock_visualization() -> None:
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

    print("TenSnap Flock Visualization starting on ws://localhost:8765")
    print("Features: Pure simulation logic + TenSnap visualization!")
    await server.run()


if __name__ == "__main__":
    asyncio.run(run_flock_visualization())
