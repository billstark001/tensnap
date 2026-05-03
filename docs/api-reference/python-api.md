# Python API Reference

This reference describes the current TenSnap Python surface for protocol v0.2.

The recommended workflow is:

1. Attach environment, layer, item, parameter, chart, and action bindings under `tensnap.bindings`.
2. Register those bindings with `SimulationScenario`.
3. Let `SimulationScenario` own protocol sync and incremental updates.

## Quick Start

```python
import asyncio

from tensnap import SimulationScenario
from tensnap.bindings import (
    BindParametersConfig,
    action,
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

    @action("scramble", "Scramble")
    def scramble(self) -> None:
        self.birds.reverse()


class Config:
    speed = 1.0
    paused = False


scenario = SimulationScenario(port=8765)
model = Aviary()

scenario.add_environment(model)
scenario.add_parameters(Config(), BindParametersConfig(exclude="^_"))
scenario.add_charts(model)
scenario.add_actions(model)


async def main() -> None:
    await scenario.register_model_handler(model_step=model.step)
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

## `tensnap.bindings`

`tensnap.bindings` is the unified attach/readback surface.

### Attach decorators and configs

- `env(...)`: attach environment metadata to a class.
- `grid_layer(...)`: attach a grid layer config.
- `agent_layer(...)`: attach an agent layer config.
- `edge_layer(...)`: attach an edge layer config.
- `trajectory_layer(...)`: attach a trajectory layer config.
- `background_layer(...)`: attach a background layer config.
- `agent(...)`: attach an item projector for agent-like objects.
- `edge(...)`: attach an item projector for edge-like objects.
- `trajectory_item(...)`: attach an item projector for trajectory config objects.
- `param(...)` / `BindParameterConfig(...)`: attach explicit parameter metadata.
- `params(...)` / `BindParametersConfig(...)`: configure automatic parameter discovery.
- `chart(...)`: attach chart metadata to a function or method.
- `action(...)`: attach action metadata to a function or method.

### Readback helpers

- `environment_binding(target) -> EnvironmentBinding | None`
- `layer_bindings(target) -> list[LayerBinding]`
- `layer_configs(target) -> list[BindLayerConfig]`
- `bindings(target) -> tuple[EnvironmentBinding | None, list[LayerBinding]]`
- `parameters(target, cfg_suggest=None)`
- `charts(target)`
- `actions(target)`

These helpers accept classes, instances, modules, or plain dictionaries where that shape makes sense.

## `SimulationScenario`

`SimulationScenario` is the recommended high-level API.

### Constructor

```python
scenario = SimulationScenario(
    host="localhost",
    port=8765,
    use_msgpack=False,
    step_interval=0.05,
)
```

### State stores

- `scenario.environments`: environment registry keyed by environment id.
- `scenario.parameters`: registered parameters keyed by parameter id.
- `scenario.actions`: registered action metadata keyed by action id.
- `scenario.charts`: registered chart getters keyed by chart id.

`SimulationScenario` registers the built-in renderer-driven actions `start`, `step`, and `reset` during construction.

### Environment and layer registration

- `add_environment_binding(binding: EnvironmentBinding | EnvironmentRegistration) -> EnvironmentRegistration`
- `add_environment(target: object) -> EnvironmentRegistration`
- `add_layer_binding(env_id: str, binding: LayerBinding, target: object) -> LayerRegistration`
- `add_bound_layers(env_id: str, target: object) -> list[str]`
- `set_layer_target(env_id: str, layer_id: str, target: object) -> None`
- `remove_layer(env_id: str, layer_id: str) -> None`
- `remove_environment(env_id: str) -> None`

`add_environment` is the normal path when your class is decorated with `env(...)` and one or more layer decorators. `add_environment_binding_binding` + `add_layer_binding` is the manual path when you build bindings imperatively.

### Parameters, charts, and actions

- `add_parameters(target, cfg_suggest=None) -> list[str]`
- `remove_parameters(param_ids) -> None`
- `remove_all_parameters() -> None`
- `add_charts(target) -> list[str]`
- `remove_charts(chart_ids) -> None`
- `remove_all_charts() -> None`
- `add_actions(target) -> None`
- `remove_action(action_id) -> None`
- `remove_all_actions() -> None`

Automatic parameter discovery excludes private names by default. Pass `BindParametersConfig(include_private=True)` if you want `_private` fields included.

### Handlers and runtime

- `register_handler(handler) -> None`
- `register_model_handler(model_init=None, model_step=None) -> None`
- `run() -> None`

`DefaultSimulationHandler` computes full environment snapshots on start/reset and layer-level incremental item diffs on subsequent steps.

## Runtime Models

The scenario registry is built from these runtime objects.

### `EnvironmentBinding`

Pure environment binding metadata.

```python
from tensnap.models import EnvironmentBinding

binding = EnvironmentBinding(id="main", type="2d")
```

### `EnvironmentRegistration`

Scenario-owned environment entry containing one `EnvironmentBinding` and a per-environment layer registry.

Key methods:

- `add_layer_binding(...)`
- `remove_layer(...)`
- `clear_layers()`
- `build_state() -> EnvironmentState`

### `LayerBinding`

Pure layer binding metadata and projection rules.

Typical constructor fields:

- `layer_id`
- `layer_type`
- `item_keys`
- `metadata_projector`
- `iterable_getter`
- `item_projector`
- `item_dynamic_projector`
- `items_projector`
- `dependency_layer_ids`

### `LayerRegistration`

Scenario-owned layer entry containing one `LayerBinding`, the current target object, and incremental diff cache.

Key methods:

- `set_target(target)`
- `reset_diff_state()`
- `build_state() -> EnvironmentLayerState`
- `build_item_deltas()`
- `build_item_delete_payloads(...)`

## Imperative Registration Example

```python
from tensnap.models import EnvironmentBinding, LayerBinding

scenario.add_environment_binding(EnvironmentBinding(id="main", type="2d"))

scenario.add_layer_binding(
    "main",
    LayerBinding(
        layer_id="agents",
        layer_type="agent",
        item_keys=("id",),
        items_projector=lambda model: [
            {"id": agent.id, "x": agent.x, "y": agent.y}
            for agent in model.agents
        ],
    ),
    my_model,
)
```

## Mesa Integration

The Mesa integration lives under `tensnap.bindings.mesa`.

### `MesaSimulationHandler`

```python
from tensnap import SimulationScenario
from tensnap.bindings.mesa import MesaSimulationHandler

scenario = SimulationScenario(port=8765)
await scenario.register_handler(MesaSimulationHandler(MyMesaModel))
await scenario.run()
```

If your Mesa model class already has `env(...)` / layer decorators attached, the handler reads them through `tensnap.bindings`. Otherwise it falls back to default grid + agent bindings derived from `model.grid` and `model.agents`.

## Migration Notes

The following older entrypoints are no longer the recommended public surface:

- `LayeredEnvironmentBinder`
- `EnvironmentBindingBuilder`
- `scenario.add_custom_actions(...)`

Use these replacements instead:

- `scenario.add_environment(model)`
- `scenario.add_environment_binding(...)` + `scenario.add_layer_binding(...)`
- `scenario.add_actions(target)`
