# Tensnap Python Bindings

Python bindings for Tensnap - an agent-based model visualization toolkit.

## Installation

```bash
pip install tensnap
```

## Quick Start

```python
import asyncio

from tensnap import (
    BindParametersConfig,
    LayeredEnvironmentBinder,
    SimulationScenario,
)


scenario = SimulationScenario(port=8765)
grid = LayeredEnvironmentBinder(id="main", environment=model)


async def main() -> None:
    scenario.add_environment(grid)
    scenario.add_parameters(config, BindParametersConfig(exclude="^_.*"))
    scenario.add_charts(globals())
    scenario.add_actions({})  # registers default renderer-driven start/step/reset actions

    await scenario.register_model_handler(
        model.initialize,
        model.step,
    )

    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

Default controls follow the renderer-driven protocol: `start` is the only built-in continuous action, `step` advances one tick, and `reset` is registered by `SimulationScenario.add_actions({})`. There is no implicit `stop` action; add one explicitly only if your scenario needs backend-side stop behavior.

## Examples

Example simulations are now located in the repository root:

- `examples/python/` - Standard Python examples (flock, hk, sirs)
- `examples/python_mesa/` - Mesa-based examples (cgol, sugarscape, mushroom)

See the README files in each directory for details on running the examples.

## Documentation

Full documentation: <https://github.com/billstark001/tensnap>

## License

See LICENSE file in the repository root.
