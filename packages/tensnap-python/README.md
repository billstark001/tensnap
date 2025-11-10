# Tensnap Python Bindings

Python bindings for Tensnap - an agent-based model visualization toolkit.

## Installation

```bash
pip install tensnap
```

## Quick Start

```python
from tensnap import Scenario
import asyncio

# Create a scenario
scenario = Scenario(name="my-simulation", port=8765)

# Define your model logic
# See examples/ directory for complete examples

# Run the server
asyncio.run(scenario.run())
```

## Examples

Check the `examples/` directory for complete simulations:

- `flock.py` - Flocking behavior
- `sirs.py` - SIRS epidemic model
- `sugarscape.py` - Sugarscape economic model

## Documentation

Full documentation: <https://github.com/billstark001/tensnap>

## License

See LICENSE file in the repository root.
