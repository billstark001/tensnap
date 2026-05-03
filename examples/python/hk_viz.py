# examples/python/hk_viz.py
"""TenSnap visualization for the Hegselmann-Krause opinion dynamics model"""

import asyncio
import os
import numpy as np

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import (
    chart,
    SimulationScenario,
)

from hk import DiscreteHKModel

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

model = DiscreteHKModel(n_agents=50, confidence_bound=0.3, k_random=3)


@chart("opinion_variance", "Opinion Variance", color="#E74C3C")
def opinion_variance() -> float:
    return float(np.var(model.opinions))


@chart("mean_opinion", "Mean Opinion", color="#3498DB")
def mean_opinion() -> float:
    return float(np.mean(model.opinions))


@chart("network_density", "Network Density", color="#2ECC71")
def network_density() -> float:
    n = model.n_agents
    return model.graph.number_of_edges() / (n * (n - 1)) if n > 1 else 0.0


# Main function
async def main() -> None:

    model.init()

    scenario.add_environment(model)
    scenario.add_parameters(model)
    scenario.add_charts(globals())
    scenario.add_actions({})

    await scenario.register_model_handler(
        model.init,
        model.step,
        model.init,
    )

    print(f"TenSnap HK Opinion Dynamics starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
