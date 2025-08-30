# tensnap/examples/basic.py
"""Simple starling flocking simulation demonstrating TenSnap features"""

import asyncio
import random
import math
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


# Simple configuration
class Config:
    separation_distance = 2.0
    alignment_distance = 5.0
    cohesion_distance = 8.0
    max_speed = 0.8
    num_agents = 50


# Global state
server = TenSnapServer()
grid = GridEnvironment(id="main", width=40, height=40)
agents: List[Agent] = []
config = Config()
sim_manager = SimulationManager(step_interval=0.05)

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


# Chart


@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    """Calculate average speed of all agents"""
    if not agents:
        return 0.0

    speeds = [
        math.sqrt(agent.data.get("vx", 0) ** 2 + agent.data.get("vy", 0) ** 2)
        for agent in agents
    ]
    return sum(speeds) / len(speeds)


@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def order_parameter() -> float:
    """Measure flock alignment (0=random, 1=aligned)"""
    if not agents:
        return 0.0

    # Average velocity
    avg_vx = sum(agent.data.get("vx", 0) for agent in agents) / len(agents)
    avg_vy = sum(agent.data.get("vy", 0) for agent in agents) / len(agents)
    avg_speed = math.sqrt(avg_vx**2 + avg_vy**2)

    # Average individual speed
    speeds = [
        math.sqrt(agent.data.get("vx", 0) ** 2 + agent.data.get("vy", 0) ** 2)
        for agent in agents
    ]
    individual_avg = sum(speeds) / len(speeds) if speeds else 0

    return avg_speed / individual_avg if individual_avg > 0 else 0.0


# Simple flocking update
def update_agent(agent: Agent) -> None:
    """Update agent using simple flocking rules"""
    sep_x = sep_y = align_x = align_y = coh_x = coh_y = 0.0
    neighbors = 0

    for other in agents:
        if other.id == agent.id:
            continue

        dx = agent.x - other.x
        dy = agent.y - other.y
        dist = math.sqrt(dx * dx + dy * dy)

        if 0 < dist < config.cohesion_distance:
            neighbors += 1

            # Separation: avoid crowding
            if dist < config.separation_distance:
                sep_x += dx / dist
                sep_y += dy / dist

            # Alignment: match neighbors
            if dist < config.alignment_distance:
                align_x += other.data.get("vx", 0)
                align_y += other.data.get("vy", 0)

            # Cohesion: move toward center
            coh_x += other.x
            coh_y += other.y

    if neighbors > 0:
        # Combine forces
        sep_x /= neighbors
        sep_y /= neighbors
        align_x /= neighbors
        align_y /= neighbors
        coh_x = (coh_x / neighbors) - agent.x
        coh_y = (coh_y / neighbors) - agent.y

        # Update velocity
        force_x = sep_x * 1.5 + align_x + coh_x
        force_y = sep_y * 1.5 + align_y + coh_y

        vx = agent.data.get("vx", 0) + force_x * 0.1
        vy = agent.data.get("vy", 0) + force_y * 0.1

        # Speed limit
        speed = math.sqrt(vx * vx + vy * vy)
        if speed > config.max_speed:
            vx = (vx / speed) * config.max_speed
            vy = (vy / speed) * config.max_speed

        # Update agent
        agent.data["vx"] = vx
        agent.data["vy"] = vy
        agent.x = (agent.x + vx) % 40  # Wrap boundaries
        agent.y = (agent.y + vy) % 40
        agent.heading = math.atan2(vy, vx) if speed > 0.01 else agent.heading


# Simulation step
@button("step", "Evolve 1 Step")
async def simulation_step() -> None:
    """Run one simulation step"""
    global time_step
    if not agents:
        return

    await server.start_time_step(time_step)

    # Update all agents
    for agent in agents:
        update_agent(agent)

    # Send batch update
    updates = [
        {"id": agent.id, "data": {"x": agent.x, "y": agent.y, "heading": agent.heading}}
        for agent in agents
    ]

    await server.update_agents_batch("main", updates)
    await server.end_time_step()
    time_step += 1


# Initialize simulation
def init_simulation() -> None:
    """Create initial agents"""
    global agents, time_step
    time_step = 0
    agents.clear()
    grid.agents.clear()

    for i in range(config.num_agents):
        agent = Agent(
            id=f"bird_{i}",
            x=random.uniform(15, 25),
            y=random.uniform(15, 25),
            heading=random.uniform(0, 2 * math.pi),
            color="#4A90E2",
            icon="arrow",
            size=8,
        )
        agent.data = {
            "vx": math.cos(agent.heading) * random.uniform(0.2, 0.6),
            "vy": math.sin(agent.heading) * random.uniform(0.2, 0.6),
        }
        agents.append(agent)
        grid.add_agent(agent)


# Main function
async def run_simulation() -> None:
    """Run the simulation"""
    # Setup
    sim_manager.init_func = init_simulation
    sim_manager.step_func = simulation_step

    init_simulation()

    # Register with server
    server.add_environment(grid)
    for param in bound_params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())

    print("TenSnap server starting on ws://localhost:8765")
    print("Features: SimulationManager + bound parameters + type safety!")
    await server.run()


if __name__ == "__main__":
    asyncio.run(run_simulation())
