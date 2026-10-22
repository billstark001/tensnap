# Tensnap Python Bindings

Python bindings for the TenSnap protocol v0.3 runtime.

## Installation

Requires Python 3.10+ and `websockets>=13.0`. The server uses the `websockets.asyncio` API introduced in [websockets 13.0](https://websockets.readthedocs.io/en/13.0.1/).

```bash
pip install tensnap
```

## Quick Start

```python
import asyncio

from tensnap import (
    SimulationScenario,
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


@grid_layer()
@agent_layer("birds")
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


@params(include=["speed"])
class Config:
    speed = 1.0


scenario = SimulationScenario(port=8765)
model = Aviary()
config = Config()

scenario.add_all(config)


async def main() -> None:
    await scenario.register_model(model)
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

`tensnap.bindings` is the unified attach/readback surface for Python bindings. Use it for decorators such as `env`, `grid_layer`, and `agent_layer`, and for readback helpers such as `environment_binding`, `layer_bindings`, and `bindings`.

Layer and item binding fields now support these common forms:

- omitted fields, `None`, or `auto()` for one-time same-name discovery from the class or initialized instance
- selector strings such as `x="pos[0]"` or `item_iterable_projector="agents"` when the source path differs from the output field or layer id
- literal values such as `coord_offset="float"` or `icon="circle"`; arbitrary strings still default to selectors unless they match a known literal value, CSS-like string such as `"#3498db"`, or JSON-like string
- explicit helpers such as `attr("pos[0]")`, `value("red")`, `auto()`, and `skip()`
- direct callables such as `size=lambda agent: agent.radius`

`None`/`auto()` field discovery is resolved once when instances initialize or when `layer_bindings(instance)` materializes an instance-specific binding, so fields assigned in `__init__` are picked up without scanning during projection:

```python
from tensnap import agent, agent_layer, grid_layer, value


@agent(x="position[0]", y="position[1]", color=value("red"))
class Bird:
    def __init__(self, bird_id: int, position: tuple[int, int]):
        self.id = bird_id
        self.position = position


@grid_layer()
@agent_layer("birds")
class Aviary:
    def __init__(self):
        self.width = 20
        self.height = 10
        self.birds = [Bird(1, (2, 3))]
```

`SimulationScenario` registers the renderer-driven built-in actions `start`, `step`, and `reset` during construction. The initial synchronized state is always time `0`, and the first simulated tick emitted by `start` or `step` is `1`. For model lifecycle, use `await scenario.register_model(model)` to register declarations and constructor-driven stepping/reset. Use `scenario.add_all(target)` for separate declarations. Parameters are opt-in with `@params(...)` or an explicit config.

The older manual `register_model_handler(model_init=None, model_step=None, model_reset=None)` path lets explicit adapters keep `reset` distinct from `init`. If `model_reset` is omitted, the default handler falls back to `model_init`.

Reset reconciles declarations with strict CRUD, deletes the previous agent set before creating reset state, clears chart history, and preserves stable trajectory configuration so the renderer can apply `on_reset`.

`add_all(..., dry_run=True)` and the targeted `add_*` dry-run modes report registry ids without mutating the scenario, for explicit registration planning. Scenario model registration records its actual model-owned inventory and replaces that inventory during reconstruction.

Trajectory layers expose `length`, `width`, `color`, `z_index`, `on_agent_delete`, `on_state_sync`, and `on_reset` as first-class decorator arguments. See the Python API reference for their lifecycle semantics.

Model-owned mappings, matrices, and indexed columns can use `map_agent_layer`, `matrix_agent_layer`, and `indexed_agent_layer` without creating visual agent wrappers. Built-in layer metadata goes in direct decorator keywords; custom metadata goes in `metadata={...}`. Source layers also accept direct `color`, `icon`, and `size` shortcuts. See the [Python API reference](../../docs/api-reference/python-api.md#layer-declaration-conventions) for the conflict rules, projection forms, and restore behavior.

Monitors use explicit create/update/delete protocol operations. Scene checkpoint callbacks work with model data only: provide both `checkpoint_capture` and `checkpoint_restore`, and the binding infers the wire encoding. Constructor registration does not add lifecycle fields to checkpoints. To retain staged UI parameter values separately, save them with the scene snapshot and restore through its parameter overlay when projected restore is supported. Pass `restore=None` to `@scene_restore(...)` for checkpoint-only models. Every connection starts with a `simulator_info` handshake containing stable model identity, per-instance identity, schema compatibility, and declared capabilities.

For constructor-driven models, use `await scenario.register_model(model)` to register declarations and assemble initialization, stepping, reset and post-restore rebinding. Use `bind_kwargs(...)` to expose constructor arguments as initialization controls. Model-owned parameters retain their existing declarations and stable IDs without duplicate controls. `BoundModelReinitializer(model, init_args=..., init_kwargs=..., cleanup=...)` supplies optional construction choices, including excluded non-UI options; it owns no registry or scenario. Mesa cleanup runs automatically before reconstruction. Replace the former reinitializer-owned registration/configuration and init/reset calls with scenario registration and `await scenario.reset()`; those old entry points have no aliases.

## Projection ownership

Standalone built-in item projectors return independent nested snapshots. Eligible automatic layer scans can compare with previous owned snapshots and reuse equal read-only nested fields before materializing changed values; this does not guarantee outer-record identity. Custom callbacks keep safe publication copying and may explicitly declare independent output to avoid it. Layer options control projector and publication copying separately: disabling publication copying does not cancel an owning projector. Configure policies before use, and treat published records as read-only. See the [shared ownership contract and focused benchmark commands](../../docs/maintainer-guide/projection-ownership.md) for the language-specific options, overrides, and source-value rules.

## Examples

Example simulations are located in the repository root:

- `examples/python/` - Standard Python examples (flock, hk, sirs)
- `examples/python_mesa/` - Mesa-based examples (cgol, sugarscape, mushroom)

## Documentation

Full documentation: <https://github.com/billstark001/tensnap>

## License

See LICENSE file in the repository root.

## IP family

See the [networking guide](../../docs/user-guide/networking.md) for `auto` (default), `ipv4`, and `ipv6` policies, IPv6 URLs, and shared ephemeral ports.
