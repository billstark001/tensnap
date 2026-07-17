# Tensnap Python Bindings

Python bindings for the TenSnap protocol v0.3 runtime.

## Installation

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

scenario.add_all(model)
scenario.add_all(config)


async def main() -> None:
    await scenario.register_model_handler(model_step=model.step)
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

`SimulationScenario` registers the renderer-driven built-in actions `start`, `step`, and `reset` during construction. The initial synchronized state is always time `0`, and the first simulated tick emitted by `start` or `step` is `1`. For most targets, use `scenario.add_all(target)` to register available environment/layer, chart, and action bindings. Parameters are opt-in with `@params(...)` or an explicit config.

`register_model_handler(model_init=None, model_step=None, model_reset=None)` lets you keep `reset` distinct from `init`. If `model_reset` is omitted, the default handler falls back to `model_init`.

Reset reconciles declarations with strict CRUD, deletes the previous agent set
before creating reset state, clears chart history, and preserves stable
trajectory configuration so the renderer can apply `on_reset`.

`add_all(..., dry_run=True)` and the targeted `add_*` dry-run modes report registry ids without mutating the scenario. Mesa lifecycle helpers use this to unregister and rebuild model-owned registrations cleanly.

Trajectory layers expose `length`, `width`, `color`, `z_index`,
`on_agent_delete`, `on_state_sync`, and `on_reset` as first-class decorator
arguments. See the Python API reference for their lifecycle semantics.

Monitors use explicit create/update/delete protocol operations. Scene checkpoint
callbacks work with model data only: provide both `checkpoint_capture` and
`checkpoint_restore`, and the binding infers the wire encoding. Pass
`restore=None` to `@scene_restore(...)` for checkpoint-only models. Every connection
starts with a `simulator_info` handshake containing stable model identity,
per-instance identity, schema compatibility, and declared capabilities.

For Mesa models, prefer `BoundModelReinitializer` from `tensnap` or `tensnap.bindings.lifecycle`. Use `bind_kwargs(...)` to expose constructor keyword arguments as resettable parameters when needed. When a constructor kwarg and a model-owned parameter publish the same source field during `register_model()`, the model parameter keeps UI ownership and the reinitializer aliases its reset value from the model field instead of registering a duplicate kwarg parameter. `configure_reinit(...)` now applies the default Mesa cleanup automatically when no explicit cleanup callback is provided.

## Examples

Example simulations are located in the repository root:

- `examples/python/` - Standard Python examples (flock, hk, sirs)
- `examples/python_mesa/` - Mesa-based examples (cgol, sugarscape, mushroom)

## Documentation

Full documentation: <https://github.com/billstark001/tensnap>

## License

See LICENSE file in the repository root.
