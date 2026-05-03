# TenSnap User Guide

This guide describes the current 0.2.0 user-facing workflow.

If you need runnable references, start with `examples/python/`, `examples/python_mesa/`, and `packages/tensnap-python/README.md`. Tutorials 1-4 are backed by runnable examples, but the examples and Python API reference remain the authoritative source for the current release.

## Core Concepts

TenSnap separates three concerns:

1. Your simulation logic.
2. A simulator/runtime that exposes that logic over protocol v0.2.
3. A renderer that owns synchronized state and turns it into an interactive UI.

For Python users, the recommended entry point is `SimulationScenario`.

## Recommended Python Workflow

The current high-level path is:

1. Define your model objects.
2. Attach environment/layer/item metadata with decorators from `tensnap.bindings`.
3. Register the model with `SimulationScenario`.
4. Register parameters, charts, and optional custom actions.
5. Start the renderer and connect to the running scenario.

### Minimal Example

```python
import asyncio

from tensnap import SimulationScenario
from tensnap.bindings import (
    BindParametersConfig,
    agent,
    agent_layer,
    chart,
    env,
    grid_layer,
)


@agent(x="position[0]", y="position[1]")
class Bird:
    def __init__(self, bird_id: int, position: tuple[int, int]):
        self.id = bird_id
        self.position = position


@grid_layer(width="width", height="height")
@agent_layer("birds", item_iterable_projector="birds")
@env(id="main")
class Aviary:
    def __init__(self):
        self.width = 20
        self.height = 10
        self.birds = [Bird(1, (2, 3)), Bird(2, (4, 5))]

    def step(self) -> None:
        for bird in self.birds:
            x, y = bird.position
            bird.position = (x + 1, y)

    @chart("population", "Population")
    def population(self) -> int:
        return len(self.birds)


class Config:
    speed = 1.0


scenario = SimulationScenario(port=8765)
model = Aviary()

scenario.add_environment(model)
scenario.add_parameters(Config(), BindParametersConfig(exclude="^_"))
scenario.add_charts(model)


async def main() -> None:
    await scenario.register_model_handler(model_step=model.step)
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

## Binding Surface

The recommended decorator/readback surface lives under `tensnap.bindings`.

### Common decorators

- `env(...)`
- `grid_layer(...)`
- `agent_layer(...)`
- `edge_layer(...)`
- `trajectory_layer(...)`
- `background_layer(...)`
- `agent(...)`
- `edge(...)`
- `trajectory_item(...)`
- `chart(...)`
- `action(...)`
- `BindParametersConfig(...)`

These decorators describe how your own Python objects should be projected into protocol state. They do not create a separate mutable TenSnap-side model object that you manipulate directly.

## Environments and Layers

TenSnap 0.2.0 uses canonical `uniform` and `2d` environments.

Rendering behavior comes from layers.

Built-in layer types include:

- `agent`
- `edge`
- `trajectory`
- `grid`
- `background`

### Practical guidance

- Use `grid_layer(...)` when you need 2D world metadata such as width/height.
- Use `agent_layer(...)` for moving objects or cell-as-agent visualizations.
- Use `edge_layer(...)` for graph/network links.
- Use `trajectory_layer(...)` when you want trails that depend on an agent layer.
- Use `background_layer(...)` for explicit background assets or static backing visuals.

For resource fields or per-cell state, prefer an explicit square-agent layer over ad-hoc image shortcuts when you want inspectable, diffable state.

## Parameters, Charts, and Actions

### Parameters

Register parameters with:

```python
scenario.add_parameters(config, BindParametersConfig(exclude="^_"))
```

Automatic parameter discovery reads plain attributes from objects, classes, dictionaries, and dataclass-like configs.

### Charts

Attach charts with `@chart(...)` and register them with:

```python
scenario.add_charts(model)
```

or, for module-level functions:

```python
scenario.add_charts(globals())
```

### Actions

`SimulationScenario` registers three built-in renderer-driven actions automatically:

- `start`
- `step`
- `reset`

There is no built-in `stop` action unless your scenario registers one explicitly.

If you need extra actions, use `@action(...)` and then:

```python
scenario.add_actions(target)
```

## Runtime Semantics

The default Python handler semantics are:

- initial synchronized state is time `0`
- the first simulated tick emitted by `start` or `step` is time `1`
- `register_model_handler(model_init=None, model_step=None, model_reset=None)` keeps reset distinct from init when you provide both callbacks
- if `model_reset` is omitted, reset falls back to `model_init`

These semantics are important when you expose resettable models or charts keyed by simulation time.

## Running the Renderer

### Local web app

From the repository root:

```bash
pnpm install
pnpm dev:web
```

This starts the renderer at `http://localhost:3200`.

### Hosted web app

You can also connect to:

```text
https://tensnap.netlify.app
```

### Example simulator processes

From the repository root:

```bash
pnpm dev:py:flock
pnpm dev:py:hk
pnpm dev:py:sirs:grid
pnpm dev:py:sirs:graph
pnpm dev:py:cgol
pnpm dev:py:sugarscape
pnpm dev:py:mushroom
```

## User Interface Overview

The current renderer UI typically includes:

- parameter controls for registered parameters
- environment views for synchronized environments/layers
- chart views for registered charts
- built-in action controls and status/timing feedback
- settings for language and renderer behavior
- project/snapshot panels in the full web app

Exact layout can vary by package (`tensnap-web` vs `tensnap-tauri`) and by current application state.

## Low-Level Python API

If you are not using `SimulationScenario`, the low-level server surface is still available through `TenSnapServer`.

Current layer-aware helpers include:

- `update_layer_metadata()`
- `update_layer_items()`
- `update_layer_agents()`
- `update_layer_edges()`
- `replace_layer_state()`
- `replace_environment_layers()`

Use these helpers when you need explicit control over the payloads emitted to the renderer.

## Working Examples

These repository examples are the best reference implementations today.

### Standard Python

- `examples/python/flock_viz.py`
- `examples/python/hk_viz.py`
- `examples/python/sirs_viz_grid.py`
- `examples/python/sirs_viz_graph.py`

### Mesa-based

- `examples/python_mesa/cgol_viz.py`
- `examples/python_mesa/sugarscape_viz.py`
- `examples/python_mesa/mushroom_viz.py`

## Tutorial Status

- `docs/tutorials/01-random-walk.md`, `docs/tutorials/02-flocking.md`, `docs/tutorials/03-predator-prey.md`, and `docs/tutorials/04-network-simulation.md` are backed by runnable examples in `examples/python/`.
- Tutorials 5-6 are still planned and not implemented yet.
- For production or teaching material, prefer the examples and Python API reference whenever a tutorial and an example diverge.

## Best Practices

1. Keep simulation logic separate from visualization registration.
2. Prefer the `tensnap.bindings` decorators over undocumented compatibility shortcuts in new code.
3. Treat layers as the primary modeling unit for 2D and graph rendering.
4. Register `model_reset` separately when reset behavior is not identical to initialization.
5. Use the examples as the reference for end-to-end runnable setups.

## Related Documentation

- `docs/user-guide/getting-started.md`
- `docs/api-reference/python-api.md`
- `docs/maintainer-guide/protocol-v0.2.md`
- `packages/tensnap-python/README.md`
