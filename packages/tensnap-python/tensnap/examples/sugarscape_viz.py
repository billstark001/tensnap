# tensnap/examples/sugarscape_viz.py
"""TenSnap visualization for Sugarscape model (Mesa 3 version)"""

import asyncio
import os
from typing import cast
import numpy as np

from tensnap import SimulationScenario, GridEnvironmentBinder
from tensnap.bindings.mesa import MesaSimulationHandler, chart

from .sugarscape import Sugarscape, SugarAgent


# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50
AGENT_COUNT = 400


# Create environment binder
grid_env = GridEnvironmentBinder[SugarAgent, Sugarscape](
    id="sugarscape_grid",
    environment=None,  # type: ignore  # Will be set in on_model_init
)


def on_model_init(model: Sugarscape) -> None:
    """Initialize visualization after model is created"""
    # Update the environment reference
    grid_env.environment = model
    
    # Populate agents list
    grid_env.agents.clear()
    for agent in model.agents:
        sugar_agent = cast(SugarAgent, agent)
        grid_env.agents.append(sugar_agent)


def on_model_step(model: Sugarscape) -> None:
    """Update visualization after each step"""
    # Update agents list (agents may die/be removed)
    grid_env.agents.clear()
    for agent in model.agents:
        sugar_agent = cast(SugarAgent, agent)
        grid_env.agents.append(sugar_agent)


# Custom accessor for SugarAgent
def agent_accessor(agent: SugarAgent) -> dict:
    """Custom accessor for SugarAgent agents"""
    x, y = agent.pos
    # Color agents based on their sugar level (green = high sugar, red = low sugar)
    sugar_level = min(max(agent.sugar, 0), 50)  # Clamp between 0 and 50
    
    # Interpolate color from red (low sugar) to green (high sugar)
    red = int(255 * (1 - sugar_level / 50.0))
    green = int(255 * (sugar_level / 50.0))
    color = f"#{red:02x}{green:02x}00"
    
    return {
        "id": agent.unique_id,
        "x": x,
        "y": y,
        "color": color,
        "size": 0.8,
        "data": {
            "sugar": round(agent.sugar, 2),
            "metabolism": round(agent.metabolism, 2),
            "vision": agent.vision,
        },
    }


# Custom environment accessor to show sugar distribution as background
def env_accessor(model: Sugarscape) -> dict:
    """Custom accessor for Sugarscape environment with sugar field as background"""
    # Encode sugar field as a simple grayscale representation
    # Higher sugar = lighter color
    sugar_normalized = (model.sugar / model.sugar.max() * 255).astype(np.uint8)
    
    return {
        "id": "sugarscape_grid",
        "type": "grid",
        "width": model.grid.width,
        "height": model.grid.height,
        # Note: In a real implementation, you'd encode this as a proper image
        # For now, we'll skip the background
    }


# Define chart functions
@chart("population", "Population", color="#3498DB")
def population_chart() -> float:
    """Get current agent population"""
    model = grid_env.environment
    if model:
        return float(len(model.agents))
    return 0.0


@chart("average_sugar", "Average Sugar", color="#2ECC71")
def average_sugar_chart() -> float:
    """Get average sugar level across all agents"""
    model = grid_env.environment
    if model and len(model.agents) > 0:
        total_sugar = sum(cast(SugarAgent, a).sugar for a in model.agents)
        return float(total_sugar / len(model.agents))
    return 0.0


@chart("average_vision", "Average Vision", color="#E74C3C")
def average_vision_chart() -> float:
    """Get average vision across all agents"""
    model = grid_env.environment
    if model and len(model.agents) > 0:
        total_vision = sum(cast(SugarAgent, a).vision for a in model.agents)
        return float(total_vision / len(model.agents))
    return 0.0


@chart(
    "resource_metrics",
    "Resource Metrics",
    data_list=[
        ("total_sugar", "#F39C12", "Total Sugar in System"),
        ("sugar_on_ground", "#95A5A6", "Sugar on Ground"),
    ],
)
def resource_metrics_chart() -> dict:
    """Get resource metrics"""
    model = grid_env.environment
    if model:
        sugar_on_ground = float(np.sum(model.sugar))
        agent_sugar = sum(cast(SugarAgent, a).sugar for a in model.agents)
        total_sugar = sugar_on_ground + agent_sugar
        
        return {
            "total_sugar": total_sugar,
            "sugar_on_ground": sugar_on_ground,
        }
    return {"total_sugar": 0.0, "sugar_on_ground": 0.0}


# Main function
async def main() -> None:
    # Create Mesa simulation handler
    handler = MesaSimulationHandler(
        model_class=Sugarscape,
        model_init_kwargs={
            "width": MODEL_WIDTH,
            "height": MODEL_HEIGHT,
            "agent_count": AGENT_COUNT,
        },
        on_model_init=on_model_init,
        on_model_step=on_model_step,
    )

    # Setup grid environment with custom accessors
    grid_env.agent_accessor = agent_accessor
    grid_env.environment_accessor = env_accessor

    # Register components with scenario
    scenario.add_environment(grid_env)
    
    # Add charts
    scenario.add_charts(globals())
    
    # Register actions
    scenario.add_actions({})

    # Register the Mesa handler
    await scenario.register_handler(handler)

    print(f"TenSnap Sugarscape visualization starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
