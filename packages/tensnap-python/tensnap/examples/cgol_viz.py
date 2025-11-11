# tensnap/examples/cgol_viz.py
"""TenSnap visualization for Conway's Game of Life (Mesa 3 version)"""

import asyncio
import os
from typing import cast

from tensnap import GridEnvironmentBinder, SimulationScenario
from tensnap.bindings.mesa import (
    MesaSimulationHandler,
    chart,
    get_latest_data,
)

from .cgol import Cell, GameOfLife

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50


# Create environment binder
# We'll update this after model initialization
grid_env = GridEnvironmentBinder[Cell, GameOfLife](
    id="game_of_life_grid",
    environment=None,  # type: ignore  # Will be set in on_model_init
)


def on_model_init(model: GameOfLife) -> None:
    """Initialize visualization after model is created"""
    # Update the environment reference
    grid_env.environment = model
    
    # Clear agents list and populate with cells
    grid_env.agents.clear()
    for agent in model.agents:
        cell = cast(Cell, agent)
        grid_env.agents.append(cell)


def on_model_step(model: GameOfLife) -> None:
    """Update visualization after each step"""
    # Update agents list (in case cells were added/removed)
    grid_env.agents.clear()
    for agent in model.agents:
        cell = cast(Cell, agent)
        grid_env.agents.append(cell)


# Define chart functions that use the datacollector
@chart("alive_cells", "Alive Cells", color="#2ECC71")
def alive_cells_chart() -> float:
    """Get number of alive cells from model datacollector"""
    model = grid_env.environment
    if model and hasattr(model, 'datacollector'):
        data = get_latest_data(model.datacollector)
        return float(data.get("Alive", 0))
    return 0.0


# Create custom accessor to show alive/dead cells with different colors
def cell_accessor(cell: Cell) -> dict:
    """Custom accessor for Cell agents"""
    x, y = cell.pos
    return {
        "id": cell.unique_id,
        "x": x,
        "y": y,
        "color": "#2ECC71" if cell.alive else "#34495E",  # Green if alive, gray if dead
        "size": 1.0,
    }


# Main function
async def main() -> None:
    # Create Mesa simulation handler
    handler = MesaSimulationHandler(
        model_class=GameOfLife,
        model_init_kwargs={"width": MODEL_WIDTH, "height": MODEL_HEIGHT},
        on_model_init=on_model_init,
        on_model_step=on_model_step,
    )

    # Setup grid environment with custom accessor
    grid_env.agent_accessor = cell_accessor
    
    # Use a custom environment accessor that gets grid dimensions from the model
    def env_accessor(model: GameOfLife) -> dict:
        return {
            "id": "game_of_life_grid",
            "type": "grid",
            "width": model.grid.width,
            "height": model.grid.height,
        }
    
    grid_env.environment_accessor = env_accessor

    # Register components with scenario
    scenario.add_environment(grid_env)
    
    # Add charts
    scenario.add_charts(globals())
    
    # Add model parameters (if any were decorated)
    # scenario.add_parameters(model)
    
    # Register actions
    scenario.add_actions({})

    # Register the Mesa handler
    await scenario.register_handler(handler)

    print(f"TenSnap Game of Life visualization starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
