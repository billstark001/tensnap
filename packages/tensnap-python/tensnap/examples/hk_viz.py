# tensnap/examples/hk_viz.py
"""TenSnap visualization for the Hegselmann-Krause opinion dynamics model"""

import asyncio
import os
import numpy as np

from tensnap import (
    chart,
    GraphEnvironmentBinderNX,
    make_graph_agent_accessor_nx,
    SimulationScenario,
)

from .hk import DiscreteHKModel


# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

model = DiscreteHKModel(n_agents=50, confidence_bound=0.3, k_random=3)
graph_env = GraphEnvironmentBinderNX(
    id="opinion_network",
    graph=model.graph,
    agent_accessor={"color": True, "size": True, "auto_collect_data": True},
)


# Custom update function for automatic visualization updates
def update_hk_visualization(hk_model: DiscreteHKModel) -> None:
    """Update graph visualization with opinion colors and sizes"""
    for node_id in hk_model.graph.nodes():
        opinion = hk_model.opinions[node_id]
        hk_model.graph.nodes[node_id].update(
            {
                "opinion": opinion,
                "color": (
                    "#E74C3C"
                    if opinion < -0.33
                    else "#3498DB" if opinion > 0.33 else "#F39C12"
                ),
                "size": 16 + abs(opinion) * 10,
            }
        )


def init():
    model.init()
    graph_env.graph = model.graph
    update_hk_visualization(model)


def step():
    model.step()
    update_hk_visualization(model)


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

    init()

    scenario.add_environment(graph_env)
    scenario.add_parameters(model)
    scenario.add_charts(globals())
    scenario.add_actions({})

    await scenario.register_model_handler(
        init,
        step,
    )

    print(f"TenSnap HK Opinion Dynamics starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
