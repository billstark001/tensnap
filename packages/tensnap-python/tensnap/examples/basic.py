# tensnap/examples/basic.py
"""Simplified starling flocking simulation with emergent behavior"""

import asyncio
import random
import math
from typing import List, Tuple
from tensnap import TenSnapServer, Agent, GridEnvironment
from tensnap.decorators import parameter, button, chart

# Global simulation state
server = TenSnapServer()
grid = GridEnvironment(id="main", width=40, height=40)
agents: List[Agent] = []
running = False
time_step = 0
simulation_task = None

# Simplified flocking parameters
_separation_distance = 2.0
_alignment_distance = 5.0
_cohesion_distance = 8.0
_max_speed = 0.8
_num_agents = 50

# Simple parameter decorators with getters and setters
@parameter("separation_distance", "Separation Distance", min=0.5, max=5.0, step=0.1, default=2.0)
def get_separation_distance() -> float:
    return _separation_distance

def set_separation_distance(value: float) -> None:
    global _separation_distance
    _separation_distance = value

get_separation_distance = get_separation_distance.setter(set_separation_distance)


@parameter("alignment_distance", "Alignment Distance", min=1.0, max=10.0, step=0.5, default=5.0)
def get_alignment_distance() -> float:
    return _alignment_distance

def set_alignment_distance(value: float) -> None:
    global _alignment_distance
    _alignment_distance = value

get_alignment_distance = get_alignment_distance.setter(set_alignment_distance)


@parameter("cohesion_distance", "Cohesion Distance", min=2.0, max=15.0, step=0.5, default=8.0)
def get_cohesion_distance() -> float:
    return _cohesion_distance

def set_cohesion_distance(value: float) -> None:
    global _cohesion_distance
    _cohesion_distance = value

get_cohesion_distance = get_cohesion_distance.setter(set_cohesion_distance)


@parameter("max_speed", "Max Speed", min=0.1, max=2.0, step=0.1, default=0.8)
def get_max_speed() -> float:
    return _max_speed

def set_max_speed(value: float) -> None:
    global _max_speed
    _max_speed = value

get_max_speed = get_max_speed.setter(set_max_speed)


@parameter("num_agents", "Number of Agents", min=10, max=200, step=10, default=50)
def get_num_agents() -> int:
    return _num_agents

def set_num_agents(value: int) -> None:
    global _num_agents, agents
    diff = value - _num_agents
    if diff > 0:
        # Add agents
        for i in range(diff):
            agent = Agent(
                id=f"starling_{_num_agents + i}",
                x=random.uniform(15, 25),
                y=random.uniform(15, 25),
                heading=random.uniform(0, 2 * math.pi),
                color="#4A90E2",
                icon="arrow",
                size=8
            )
            agent.data = {
                "vx": math.cos(agent.heading) * random.uniform(0.2, 0.6),
                "vy": math.sin(agent.heading) * random.uniform(0.2, 0.6)
            }
            agents.append(agent)
            grid.add_agent(agent)
    elif diff < 0:
        # Remove agents
        for _ in range(-diff):
            if agents:
                removed_agent = agents.pop()
                grid.remove_agent(removed_agent.id)
    _num_agents = value

get_num_agents = get_num_agents.setter(set_num_agents)


# Button controls
@button("start_stop", "Start/Stop Simulation")
def toggle_simulation() -> None:
    """Toggle simulation running state"""
    global running, simulation_task
    running = not running
    if running and simulation_task is None:
        # Start simulation task
        simulation_task = asyncio.create_task(simulation_loop())
    elif not running and simulation_task:
        # Stop simulation task
        simulation_task.cancel()
        simulation_task = None


@button("reset", "Reset Simulation")  
def reset_simulation() -> None:
    """Reset simulation to initial state"""
    global running, time_step, simulation_task
    running = False
    time_step = 0
    
    # Cancel existing simulation task
    if simulation_task:
        simulation_task.cancel()
        simulation_task = None
    
    # Reset agent positions and velocities
    for agent in agents:
        agent.x = random.uniform(15, 25)
        agent.y = random.uniform(15, 25)
        agent.heading = random.uniform(0, 2 * math.pi)
        agent.data = {
            "vx": math.cos(agent.heading) * random.uniform(0.2, 0.6),
            "vy": math.sin(agent.heading) * random.uniform(0.2, 0.6)
        }


# Simplified charts
@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def calculate_order_parameter() -> float:
    """Calculate the order parameter (polarization) of the flock"""
    if not agents:
        return 0.0
    
    # Calculate average velocity vector
    avg_vx = sum(agent.data.get("vx", 0) for agent in agents) / len(agents)
    avg_vy = sum(agent.data.get("vy", 0) for agent in agents) / len(agents)
    
    # Calculate magnitude of average velocity
    avg_speed = math.sqrt(avg_vx**2 + avg_vy**2)
    
    # Calculate average individual speed
    individual_speeds = [math.sqrt(agent.data.get("vx", 0)**2 + agent.data.get("vy", 0)**2) for agent in agents]
    avg_individual_speed = sum(individual_speeds) / len(individual_speeds) if individual_speeds else 0
    
    # Order parameter is the ratio (ranges from 0 to 1)
    return avg_speed / avg_individual_speed if avg_individual_speed > 0 else 0.0


@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    """Calculate average speed of all agents"""
    if not agents:
        return 0.0
    
    speeds = [math.sqrt(agent.data.get("vx", 0)**2 + agent.data.get("vy", 0)**2) for agent in agents]
    return sum(speeds) / len(speeds)


def calculate_flocking_forces(agent: Agent, neighbors: List[Agent]) -> Tuple[float, float]:
    """Calculate simplified flocking forces for an agent"""
    sep_x = sep_y = 0.0  # Separation
    align_x = align_y = 0.0  # Alignment  
    coh_x = coh_y = 0.0  # Cohesion
    
    sep_count = align_count = coh_count = 0
    
    for neighbor in neighbors:
        dx = agent.x - neighbor.x
        dy = agent.y - neighbor.y
        distance = math.sqrt(dx*dx + dy*dy)
        
        if distance > 0:
            # Separation
            if distance < _separation_distance:
                sep_x += dx / distance
                sep_y += dy / distance
                sep_count += 1
            
            # Alignment
            if distance < _alignment_distance:
                align_x += neighbor.data.get("vx", 0)
                align_y += neighbor.data.get("vy", 0)
                align_count += 1
            
            # Cohesion
            if distance < _cohesion_distance:
                coh_x += neighbor.x
                coh_y += neighbor.y
                coh_count += 1
    
    # Normalize forces
    if sep_count > 0:
        sep_x /= sep_count
        sep_y /= sep_count
    
    if align_count > 0:
        align_x /= align_count
        align_y /= align_count
    
    if coh_count > 0:
        # Calculate center of mass and seek it
        coh_x = (coh_x / coh_count) - agent.x
        coh_y = (coh_y / coh_count) - agent.y
    
    # Combine forces with simple weights
    force_x = sep_x * 1.5 + align_x * 1.0 + coh_x * 1.0
    force_y = sep_y * 1.5 + align_y * 1.0 + coh_y * 1.0
    
    return force_x, force_y


def apply_force(agent: Agent, force_x: float, force_y: float) -> None:
    """Apply force to agent and update velocity"""
    current_vx = agent.data.get("vx", 0)
    current_vy = agent.data.get("vy", 0)
    
    # Apply force directly (simplified)
    vel_x = current_vx + force_x * 0.1
    vel_y = current_vy + force_y * 0.1
    
    # Limit speed
    speed = math.sqrt(vel_x*vel_x + vel_y*vel_y)
    if speed > _max_speed:
        vel_x = (vel_x / speed) * _max_speed
        vel_y = (vel_y / speed) * _max_speed
    
    # Update agent
    agent.data["vx"] = vel_x
    agent.data["vy"] = vel_y
    
    # Update position
    agent.x += vel_x
    agent.y += vel_y
    
    # Wrap around boundaries
    agent.x = agent.x % 40
    agent.y = agent.y % 40
    
    # Update heading for display
    if abs(vel_x) > 0.01 or abs(vel_y) > 0.01:
        agent.heading = math.atan2(vel_y, vel_x)


async def simulation_step() -> None:
    """Execute one simulation step with batch updates"""
    if not running or not agents:
        return
    
    # Calculate all agent updates
    agent_updates = []
    
    for agent in agents:
        # Find neighbors (simplified - use all other agents)
        neighbors = [a for a in agents if a.id != agent.id]
        
        # Calculate flocking forces
        force_x, force_y = calculate_flocking_forces(agent, neighbors)
        
        # Apply forces
        apply_force(agent, force_x, force_y)
        
        # Prepare update data for batch sending
        agent_updates.append({
            "id": agent.id,
            "data": {
                "x": agent.x,
                "y": agent.y, 
                "heading": agent.heading,
                "vx": agent.data.get("vx", 0),
                "vy": agent.data.get("vy", 0)
            }
        })
    
    # Send all updates in one batch - this is the key efficiency improvement
    if agent_updates:
        await server.update_agents_batch("main", agent_updates)


async def simulation_loop() -> None:
    """Main simulation loop that runs independently"""
    global time_step, running, simulation_task
    
    try:
        while running:
            await server.start_time_step(time_step)
            await simulation_step()
            await server.end_time_step()
            
            time_step += 1
            await asyncio.sleep(0.05)  # 20 FPS
    except asyncio.CancelledError:
        print("Simulation loop cancelled")
    finally:
        simulation_task = None


def initialize_simulation() -> None:
    """Initialize the simulation"""
    global agents
    
    # Clear existing agents
    agents.clear()
    grid.agents.clear()
    
    # Create initial flock
    for i in range(_num_agents):
        agent = Agent(
            id=f"starling_{i}",
            x=random.uniform(15, 25),  # Start clustered in center
            y=random.uniform(15, 25),
            heading=random.uniform(0, 2 * math.pi),
            color="#4A90E2",
            icon="arrow",
            size=8
        )
        # Initialize with random velocity
        agent.data = {
            "vx": math.cos(agent.heading) * random.uniform(0.2, 0.6),
            "vy": math.sin(agent.heading) * random.uniform(0.2, 0.6)
        }
        agents.append(agent)
        grid.add_agent(agent)
    
    # Register everything with server
    server.add_environment(grid)
    
    # Use auto-registration to register all decorated functions
    server.auto_register_from_globals(globals())


async def run_simulation() -> None:
    """Run the starling flocking simulation"""
    
    # Initialize simulation
    initialize_simulation()
    
    # Start server (this handles WebSocket connections and messages)
    print("Starting TenSnap server on ws://localhost:8765")
    print("Connect with the web client to interact with the simulation")
    await server.run()


if __name__ == "__main__":
    asyncio.run(run_simulation())
