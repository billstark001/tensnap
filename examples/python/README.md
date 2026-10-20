# TenSnap Python Examples

This directory contains Python examples for TenSnap that don't depend on Mesa.

## Available Examples

- **random_walk** - Simple 2D random walk with charts and parameter controls
- **flock** - Synchronous toroidal Boids-inspired teaching variant
- **hk** - Adaptive-network HK-inspired continuous-opinion model
- **predator_prey** - Sheep, wolves, and renewable grass on a 2D toroidal world; the grass matrix uses `@matrix_agent_layer`
- **sirs** - SIRS epidemic model with multiple visualizations (grid and graph)

`flock.py` demonstrates declarative `@layer_restore` callbacks for birds, grid metadata, and trajectory configuration. Its paired `@checkpoint` hooks retain velocities and RNG state for exact continuation.

## Running Examples

### Prerequisites

These development examples target the binding in the same checkout. Run the editable install below from the repository root. Examples from a released tag can use its matching published binding; do not mix an unreleased example with an older installed API.

Install TenSnap:

```bash
pip install -e 'packages/tensnap-python[dev]'
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

Or use the hosted version at <https://tensnap.netlify.app>

### Run an Example

In another terminal:

```bash
cd examples/python

# Run flock example
python flock_viz.py

# Run random-walk example
python random_walk_viz.py

# Run HK example
python hk_viz.py

# Run predator-prey example
python predator_prey_viz.py

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

Source mode is explicit: a missing checkout raises an import error. It never silently falls back to an installed version. For development, an editable install from the repository root (`pip install -e 'packages/tensnap-python[dev]'`) also works without changing `sys.path`.

## File Structure

Each example consists of:

- `{name}.py` - The simulation logic and model
- `{name}_viz.py` - The visualization setup and TenSnap integration

## Reproducibility and model scope

See the [example guide](../README.md) for the scientific variants, tick ordering, experiment suggestions and limitations, and the [reproducibility contract](../../docs/maintainer-guide/reproducibility.md) for ownership and checks. Seed is an ordinary initialization parameter with default 7. Changing it affects the next reset; model stepping and projections never seed a global generator.

Flock checkpoint schema 2 retains the configured reset seed and instance RNG. Restore validates before installing state. Other plain-Python examples currently demonstrate seeded reset and projection; they do not advertise exact checkpoints. HK is named `AdaptiveNetworkHKModel` and adds directed contacts, inertia, non-neighbor sampling and rewiring. SIRS reads all old health states before committing transitions; topology and disease dynamics share its model-owned generator.
