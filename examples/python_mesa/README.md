# TenSnap Python Mesa Examples

This directory contains Python examples for TenSnap that use the Mesa agent-based modeling framework.

## Available Examples

- **cgol** - Conway's Game of Life
- **sugarscape** - Sugarscape-inspired one-cell gradient foraging on a renewable resource field
- **mushroom** - Area-restricted mushroom search with a persistent random-search control
- **schelling** - Schelling segregation model with TenSnap, Solara, and a headless scientific sweep

`cgol.py` binds its NumPy board directly with `@matrix_agent_layer` and uses `@layer_restore(replace=...)` for projected board restore, `@scene_restore(time=mesa_clock_restore)` for projected clock restore, and paired `@checkpoint` hooks for exact RNG and collector state. Its cells use stable coordinate IDs. `sugarscape.py` binds its existing sugar array through a row-oriented matrix view, without presentation-only patch agents. `mushroom.py` binds its keyed patch map with `@map_agent_layer`. The grid examples import typed cell-space classes from `_mesa_space.py` in this directory, which routes to `mesa.discrete_space` on Mesa 3.2+/4.0 and the experimental `mesa.experimental.cell_space` on Mesa 3.0/3.1.

## Running Examples

### Prerequisites

These development examples target the binding in the same checkout. Run the editable install below from the repository root. Examples from a released tag can use its matching published binding; do not mix an unreleased example with an older installed API.

Install TenSnap and Mesa:

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

Source mode is explicit: a missing checkout raises an import error. It never silently falls back to an installed version. For development, an editable install from the repository root (`pip install -e 'packages/tensnap-python[dev]'`) also works without changing `sys.path`.

## File Structure

Most examples consist of:

- `{name}.py` - The Mesa model definition
- `{name}_viz.py` - The visualization setup and TenSnap integration

Schelling is partially split because both the teaching commands and the publication harness reuse it:

- `schelling.py` owns model dynamics and generally useful parameters;
- `schelling_tensnap.py` owns reusable TenSnap binding/reset setup, while `schelling_viz.py` is the user launcher;
- `schelling_study.py` owns reusable trials and sweeps, while `schelling_standalone.py` is the user CLI;
- `netlogo_study.py` similarly serves the NetLogo standalone CLI and its thin benchmark adapter.

This is not the minimum file structure required to bind a Mesa model. The split prevents the example and harness from copying reset behavior or scientific trial loops and then drifting apart; a one-off example can keep those pieces together.

Constructor-driven examples use `await scenario.register_model(model)` to register declarations and assemble initialization, stepping, reset and post-restore rebinding. Schelling supplies a `BoundModelReinitializer` only to retain its non-UI `collect_data` option; it needs no model-specific reinitializer subclass. Checkpoint contents and RNG state remain owned by each model.

`schelling_tensnap.py` deliberately uses the function-call form of decorators, such as `agent(...)(SchellingAgent)` and `env()(SchellingModel)`, to teach how bindings attach to an existing Mesa model. Simple agent fields use `agent` selectors rather than a full projection callback. Applying decorators to imported classes changes those classes for every importer in the same process; this is a teaching example, not recommended application structure. In an application, declare bindings alongside classes you own or use a dedicated binding class. The scientific model remains in `schelling.py`.

## Schelling Solara

The Solara version can be launched with:

```bash
cd examples/python_mesa
solara run schelling_viz_solara.py

# Or from the repository root
pnpm dev:py:schelling:solara
```

It exposes grid width/height, density, balance, similarity threshold, and random seed controls.

## Schelling Standalone Scientific Task

The standalone scripts share the scientific trial loops with the other language examples. CSV contains final satisfaction, segregation, movement, steps, and separate `satisfied_runs`, `jammed_runs`, and `limit_runs` counts. A no-movement step can stop because everyone is satisfied or because relocation is blocked. Warmup, timers and performance rows belong to the benchmark subjects.

```bash
cd examples/python_mesa
python schelling_standalone.py --steps 1000 --seeds 8

# Or from the repository root
pnpm standalone:py:schelling
```

Mesa data collection is enabled by default; `--no-collect-data` disables observational collection. It does not change the scientific transition or caching policy. `--mode steady` runs exactly the requested steps, while `--mode convergence` stops after a no-movement step.

The NetLogo version uses the same model defaults and can be run headlessly with PyNetLogo installed:

```bash
cd examples/python_mesa
python schelling_netlogo_standalone.py --steps 1000 --seeds 8

# Or from the repository root
pnpm standalone:netlogo:schelling
```

## Benchmark separation

These files are runnable teaching and scientific-task examples. The model, study loop and TenSnap binding/server are shared deliberately so a learner sees one source of scientific truth. Publication profiles use thin versioned subjects in `../../benchmarks/schelling/v1/subjects/mesa/` and `../../benchmarks/schelling/v1/subjects/netlogo/`. Profile environment parsing, canonical-state/revision probes, JSON records and artifact timing adapters belong there and are not prerequisites for the examples above.

## Reproducibility and model scope

See the [example guide](../README.md) for the scientific variants, tick ordering, experiment suggestions and limitations, and the [reproducibility contract](../../docs/maintainer-guide/reproducibility.md) for ownership and checks. Seed is an ordinary initialization parameter with default 7. You may omit it, for example `SchellingModel()`; use `SchellingModel(seed=42)` to choose another repeatable experiment. Omitting it uses the default rather than choosing a new random seed on each reset. Changing it affects the next reset; model stepping and projections never seed a global generator.

Sugarscape uses Moore vision and takes one adjacent empty-cell step toward the richest unoccupied visible cell (or stays). Distances respect `torus`; this is a gradient variant, with no reproduction/trade. Metabolism and initial sugar are uniform on the configured bounds; integer vision uses `[vision_min, vision_max)`. Agents activate randomly and sequentially, followed by regrowth.

Mushroom state is `AVAILABLE` or `COLLECTED`; color is a derived view. `area_restricted=False` is the persistent random-search control. Search age begins at zero; cumulative harvest per hunter per tick begins at zero too. These diagnostics are not interchangeable.

Game of Life supports projected and exact restore. Schelling's schema-3 checkpoint retains science and both RNGs but begins a new DataCollector segment; chart history is not reconstructed. Sugarscape and Mushroom expose seeded reset and projections, without claiming checkpoint continuation.
