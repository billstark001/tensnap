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
    action,
    agent,
    agent_layer,
    chart,
    env,
    grid_layer,
    params,
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


@params(include=["speed", "paused"])
class Config:
    speed = 1.0
    paused = False


scenario = SimulationScenario(port=8765)
model = Aviary()
config = Config()

scenario.add_all(model)
scenario.add_all(config)


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
- `params(...)` / `BindParametersConfig(...)`: configure automatic parameter discovery. `BindParametersConfig.EXCLUDE_ALL` is the built-in exclude-all config.
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

### Combined registration

- `add_all(target, cfg_suggest=None, dry_run=False) -> dict[str, list[str]]`
- `remove_all() -> dict[str, list[str]]`
- `remove_by_dict(removals) -> dict[str, list[str]]`

`add_all(...)` is the normal high-level path. It registers any available environment/layer, action, and chart bindings on the target and returns changed registry ids grouped by kind. If no parameter config is passed, it uses `BindParametersConfig.EXCLUDE_ALL`; attach `@params(...)` to opt fields into parameter discovery.

### Environment and layer registration

- `add_environment_binding(binding: EnvironmentBinding | EnvironmentRegistration) -> dict[str, list[str]]`
- `add_environment(target: object) -> dict[str, list[str]]`
- `add_layer_binding(env_id: str, binding: LayerBinding, target: object) -> dict[str, list[str]]`
- `add_bound_layers(env_id: str, target: object) -> dict[str, list[str]]`
- `set_layer_target(env_id: str, layer_id: str, target: object) -> None`
- `remove_layer(env_id: str, layer_id: str) -> dict[str, list[str]]`
- `remove_environment(env_id: str) -> dict[str, list[str]]`

`add_all(...)` is the normal path when your class is decorated with `env(...)` and one or more layer decorators. `add_environment_binding(...)` + `add_layer_binding(...)` is the manual path when you build bindings imperatively.

### Parameters, charts, and actions

- `add_parameters(target, cfg_suggest=None) -> dict[str, list[str]]`
- `remove_parameters(param_ids) -> dict[str, list[str]]`
- `remove_all_parameters() -> dict[str, list[str]]`
- `add_charts(target) -> dict[str, list[str]]`
- `remove_charts(chart_ids) -> dict[str, list[str]]`
- `remove_all_charts() -> dict[str, list[str]]`
- `add_actions(target) -> dict[str, list[str]]`
- `remove_action(action_id) -> dict[str, list[str]]`
- `remove_all_actions() -> dict[str, list[str]]`

Automatic parameter discovery excludes private names by default. Pass `BindParametersConfig(include_private=True)` if you want `_private` fields included.

### Handlers and runtime

- `register_handler(handler) -> None`
- `register_model_handler(model_init=None, model_step=None, model_reset=None) -> None`
- `run() -> None`

`DefaultSimulationHandler` initializes lazily at time `0`, emits the first simulated tick as time `1`, computes full environment snapshots for init/reset, and emits layer-level incremental item diffs on subsequent steps. If `model_reset` is omitted, reset falls back to `model_init`.

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

### `BoundModelReinitializer`

```python
from tensnap import SimulationScenario
from tensnap.bindings.mesa import BoundModelReinitializer

scenario = SimulationScenario(port=8765)
model = MyMesaModel(width=50, height=50)
reinitializer = BoundModelReinitializer(model)

reinitializer.register_model(scenario)
reinitializer.configure_reinit(scenario)
await scenario.register_model_handler(
    model_init=reinitializer.model_init,
    model_step=model.step,
    model_reset=reinitializer.model_reset,
)
await scenario.run()
```

`BoundModelReinitializer` is the recommended Mesa lifecycle helper. It registers the decorated model through `scenario.add_all(model)`, adds constructor kwargs as resettable parameters when they are not already exposed by the model, and rebuilds the model in place on init/reset.

### `MesaSimulationHandler`

`MesaSimulationHandler` remains available for compatibility, but new examples prefer `BoundModelReinitializer` plus `register_model_handler(...)` so registration and reset behavior are explicit.

## Migration Notes

The following older entrypoints are no longer the recommended public surface:

- `LayeredEnvironmentBinder`
- `EnvironmentBindingBuilder`
- `scenario.add_custom_actions(...)`
- scattered `scenario.add_environment(...)` / `add_parameters(...)` / `add_charts(...)` calls for ordinary decorated targets

Use these replacements instead:

- `scenario.add_all(model, ...)`
- `scenario.add_environment_binding(...)` + `scenario.add_layer_binding(...)`
- `scenario.add_all(target)` for chart/action-only registration
