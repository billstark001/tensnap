# TenSnap Python Mesa Examples

This directory contains Python examples for TenSnap that use the Mesa agent-based modeling framework.

## Available Examples

- **cgol** - Conway's Game of Life
- **sugarscape** - Sugarscape economic model with resource gathering
- **mushroom** - Mushroom foraging simulation
- **schelling** - Schelling segregation model with TenSnap, Solara, and a headless scientific sweep

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

Or use the hosted version at <https://tensnap.netlify.app>

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

# Run Schelling in TenSnap
python schelling_viz.py
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

Most examples consist of:

- `{name}.py` - The Mesa model definition
- `{name}_viz.py` - The visualization setup and TenSnap integration

Schelling is partially split because both the teaching commands and the
publication harness reuse it:

- `schelling.py` owns model dynamics and generally useful parameters;
- `schelling_tensnap.py` owns reusable TenSnap binding/reset setup, while
  `schelling_viz.py` is the user launcher;
- `schelling_study.py` owns reusable trials and sweeps, while
  `schelling_standalone.py` is the user CLI;
- `netlogo_study.py` similarly serves the NetLogo standalone CLI and its thin
  benchmark adapter.

This is not the minimum file structure required to bind a Mesa model. The
split prevents the example and harness from copying reset behavior or
scientific trial loops and then drifting apart; a one-off example can keep
those pieces together.

## Schelling Solara

The Solara version can be launched with:

```bash
cd examples/python_mesa
solara run schelling_viz_solara.py

# Or from the repository root
pnpm dev:py:schelling:solara
```

It exposes grid width/height, density, balance, similarity threshold, and random
seed controls.

## Schelling Standalone Scientific Task

The standalone scripts run the same heavy threshold-sweep task used by the
Julia, NetLogo, and Go examples: multiple seeds per similarity threshold, fixed
grid parameters, and CSV output for final satisfaction, segregation, movement,
and convergence. After all scientific rows are computed, they print a separate
performance row with `total_ticks`, `elapsed_ms`, `tpms`, and `mspt`. Timing is
wrapped around each trial's step loop only, so there is no per-tick timing work
inside the model hot path.

```bash
cd examples/python_mesa
python schelling_standalone.py --steps 1000 --seeds 8

# Or from the repository root
pnpm standalone:py:schelling
```

Mesa data collection is part of the teaching model, not a harness patch. It is
enabled by default and can be removed from a timing-oriented study with
`--no-collect-data`; the reusable model constructor accepts
`collect_data=False` directly. `--mode steady` runs exactly the requested
steps, while `--mode convergence` stops after a no-movement step.

The NetLogo version uses the same model defaults and can be run headlessly with
PyNetLogo installed:

```bash
cd examples/python_mesa
python schelling_netlogo_standalone.py --steps 1000 --seeds 8

# Or from the repository root
pnpm standalone:netlogo:schelling
```

## Benchmark separation

These files are runnable teaching and scientific-task examples. The model,
study loop and TenSnap binding/server are shared deliberately so a learner sees
one source of scientific truth. Publication profiles use thin versioned
subjects in
`../../benchmarks/schelling/v1/subjects/mesa/` and
`../../benchmarks/schelling/v1/subjects/netlogo/`. Profile environment parsing,
canonical-state/revision probes, JSON records and artifact timing adapters
belong there and are not prerequisites for the examples above.
