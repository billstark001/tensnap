# Tensnap Python Bindings

Python bindings for the Tensnap protocol v0.2 runtime.

## Installation

```bash
pip install tensnap
```

## Quick Start

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
config = Config()

scenario.add_environment(model)
scenario.add_parameters(config, BindParametersConfig(exclude="^_"))
scenario.add_charts(model)


async def main() -> None:
    await scenario.register_model_handler(model_step=model.step)
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

`tensnap.bindings` is the unified attach/readback surface for Python bindings. Use it for decorators such as `env`, `grid_layer`, and `agent_layer`, and for readback helpers such as `environment_binding`, `layer_bindings`, and `bindings`.

`SimulationScenario` registers the renderer-driven built-in actions `start`, `step`, and `reset` during construction. The initial synchronized state is always time `0`, and the first simulated tick emitted by `start` or `step` is `1`. If you need extra actions, attach them with `@action(...)` and register them with `scenario.add_actions(target)`.

`register_model_handler(model_init=None, model_step=None, model_reset=None)` lets you keep `reset` distinct from `init`. If `model_reset` is omitted, the default handler falls back to `model_init`.

## Examples

Example simulations are located in the repository root:

- `examples/python/` - Standard Python examples (flock, hk, sirs)
- `examples/python_mesa/` - Mesa-based examples (cgol, sugarscape, mushroom)

## Documentation

Full documentation: <https://github.com/billstark001/tensnap>

## License

See LICENSE file in the repository root.
