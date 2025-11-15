# TenSnap Python Mesa Examples

This directory contains Python examples for TenSnap that use the Mesa agent-based modeling framework.

## Available Examples

- **cgol** - Conway's Game of Life
- **sugarscape** - Sugarscape economic model with resource gathering
- **mushroom** - Mushroom foraging simulation

## Running Examples

### Prerequisites

Install TenSnap and Mesa:
```bash
pip install tensnap mesa
```

Or use the source code from the repository by setting:
```bash
export TENSNAP_USE_SOURCE=1
```

### Start the Web Interface

In one terminal:
```bash
# From repository root
pnpm dev:web
```

Or use the hosted version at https://tensnap.netlify.app

### Run an Example

In another terminal:
```bash
cd examples/python_mesa

# Run Game of Life example
python cgol_viz.py

# Run Sugarscape example
python sugarscape_viz.py

# Run Mushroom example
python mushroom_viz.py
```

Then open your browser to `http://localhost:3200` (or the Netlify instance) and watch the simulation!

## Configuring Imports

Each example uses `import_config.py` to determine whether to use:
1. The pip-installed tensnap package (default)
2. The source code from the repository

### Option 1: Environment Variable (Recommended)
```bash
export TENSNAP_USE_SOURCE=1  # Use source code
python cgol_viz.py
```

### Option 2: Edit import_config.py
Change `USE_SOURCE = False` to `USE_SOURCE = True` in `import_config.py`

## File Structure

Each example consists of:
- `{name}.py` - The Mesa model definition
- `{name}_viz.py` - The visualization setup and TenSnap integration
