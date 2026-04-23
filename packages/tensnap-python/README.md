# Tensnap Python Bindings

Python bindings for Tensnap - an agent-based model visualization toolkit.

## Installation

```bash
pip install tensnap
```

## Quick Start

```python
from tensnap import SimulationScenario
import asyncio

# Create a scenario
scenario = SimulationScenario(port=8765)

# Register your environments, parameters, charts, and handlers
# See examples/ directory for complete examples

# Run the server
asyncio.run(scenario.run())
```

## Examples

Example simulations are now located in the repository root:

- `examples/python/` - Standard Python examples (flock, hk, sirs)
- `examples/python_mesa/` - Mesa-based examples (cgol, sugarscape, mushroom)

See the README files in each directory for details on running the examples.

## Documentation

Full documentation: <https://github.com/billstark001/tensnap>

## License

See LICENSE file in the repository root.
