# TenSnap Python Examples

This directory contains Python examples for TenSnap that don't depend on Mesa.

## Available Examples

- **flock** - Flocking behavior simulation (Boids algorithm)
- **hk** - Hegselmann-Krause opinion dynamics model
- **sirs** - SIRS epidemic model with multiple visualizations (grid and graph)

## Running Examples

### Prerequisites

Install TenSnap:
```bash
pip install tensnap
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
cd examples/python

# Run flock example
python flock_viz.py

# Run HK example
python hk_viz.py

# Run SIRS grid example
python sirs_viz_grid.py

# Run SIRS graph example
python sirs_viz_graph.py
```

Then open your browser to `http://localhost:3200` (or the Netlify instance) and watch the simulation!

## Configuring Imports

Each example uses `import_config.py` to determine whether to use:
1. The pip-installed tensnap package (default)
2. The source code from the repository

### Option 1: Environment Variable (Recommended)
```bash
export TENSNAP_USE_SOURCE=1  # Use source code
python flock_viz.py
```

### Option 2: Edit import_config.py
Change `USE_SOURCE = False` to `USE_SOURCE = True` in `import_config.py`

## File Structure

Each example consists of:
- `{name}.py` - The simulation logic and model
- `{name}_viz.py` - The visualization setup and TenSnap integration
