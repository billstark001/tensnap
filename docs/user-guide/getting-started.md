# Getting Started with TenSnap

This guide will help you get up and running with TenSnap in just a few minutes.

## What You'll Need

- **Python 3.10 or higher** (for Python bindings)
- **Node.js 18+ and pnpm 8+** (for web interface development)
- A web browser (Chrome, Firefox, Safari, or Edge)

## Quick Start (Python)

### 1. Install TenSnap

Currently, TenSnap is available from source. Clone the repository:

```bash
git clone https://github.com/billstark001/tensnap.git
cd tensnap
```

Install Python dependencies:

```bash
cd packages/tensnap-python
pip install -e .
```

### 2. Run Your First Example

TenSnap comes with several example simulations. Let's run the flocking simulation:

```bash
# From the root directory
pnpm install  # Install JavaScript dependencies
pnpm dev:py:flock  # Run the flock example
```

This will:
1. Start a WebSocket server on port 8765
2. Open your browser to the TenSnap web interface
3. Connect to the simulation automatically

### 3. Interact with the Simulation

Once the interface loads, you'll see:

- **Control Panel** (left): Parameters you can adjust (separation distance, alignment, cohesion, etc.)
- **Visualization Area** (center): The grid showing your agents (birds) moving
- **Charts** (right): Real-time plots of simulation metrics
- **Toolbar** (top): Control buttons (Play, Pause, Step, Reset)

Try these interactions:

1. **Click Play** to start the simulation
2. **Adjust sliders** to change parameters in real-time
3. **Click Reset** to restart with new parameters
4. **Drag views** to rearrange the interface

## Understanding the Example

The flock example demonstrates TenSnap's key features:

```python
# Import TenSnap components
from tensnap import (
    SimulationScenario,
    GridEnvironmentBinder,
    make_grid_agent_accessor,
    BindParametersConfig,
    chart,
    action,
)

# Create scenario (combines server + simulation loop)
scenario = SimulationScenario(port=8765)

# Add environment with automatic agent syncing
grid = GridEnvironmentBinder(
    id="main",
    environment=model,
    agent_accessor=make_grid_agent_accessor(heading=True, color=True, icon=True)
)
scenario.add_environment(grid)

# Automatically bind parameters from config object
config = FlockConfig()
scenario.add_parameters(config, BindParametersConfig(exclude="world_.+"))

# Create chart with decorator
@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    return model.get_average_speed()

# Create action button with decorator
@action("reset", "Reset")
async def reset() -> None:
    model.initialize()

# Register charts and actions
scenario.add_charts(globals())
scenario.add_actions(globals())

# Register model lifecycle handlers
scenario.register_model_handler(
    init_func=model.initialize,
    step_func=model.step
)

# Run the scenario
await scenario.run()
```

## What's Next?

- **[Installation Guide](./installation.md)** - Set up TenSnap for development or production
- **[User Guide](./user-guide.md)** - Learn about all features in detail
- **[Tutorials](../tutorials/)** - Follow step-by-step guides to build your own models
- **[Python API Reference](../api-reference/python-api.md)** - Explore the complete API

## Common Issues

### WebSocket Connection Failed

**Problem**: The web interface shows "Disconnected" or connection errors.

**Solution**: 
- Ensure the Python simulation is running
- Check that port 8765 is not blocked by a firewall
- Verify the port matches in both server and client

### Port Already in Use

**Problem**: Error message "Address already in use"

**Solution**:
```bash
# Use a different port
TENSNAP_SERVER_PORT=8766 python your_simulation.py
```

### Module Not Found

**Problem**: `ImportError: No module named 'tensnap'`

**Solution**:
```bash
# Install in development mode
cd packages/tensnap-python
pip install -e .
```

## Getting Help

If you encounter issues:

1. Check the [User Guide](./user-guide.md) for detailed explanations
2. Look at [example code](../../packages/tensnap-python/tensnap/examples/) for reference
3. Open an issue on [GitHub](https://github.com/billstark001/tensnap/issues)
