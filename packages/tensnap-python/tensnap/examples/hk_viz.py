# tensnap/examples/hk_viz.py
"""TenSnap visualization for the Hegselmann-Krause opinion dynamics model"""

import asyncio
import os
import numpy as np
from typing import Dict, Any
from tensnap import TenSnapServer, GraphEnvironmentModel
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import chart, button, quick_bind
from .hk import DiscreteHKModel


# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
server = TenSnapServer(port=server_port)
model = DiscreteHKModel(n_agents=50, confidence_bound=0.3, k_random=3)
graph_env = GraphEnvironmentModel(id="opinion_network")
sim_manager = SimulationManager(step_interval=0.1)


# Custom update function for automatic visualization updates
def update_hk_visualization(env: GraphEnvironmentModel, hk_model) -> None:
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
                "size": 8 + abs(opinion) * 5,
            }
        )
    env.update_from_networkx(hk_model.graph)


# Configure automatic updates
graph_env.update_source = model
graph_env.update_func = update_hk_visualization

# Auto-bind parameters
bound_params = quick_bind(model, exclude=["opinion_history"])


async def init_simulation() -> None:
    await sim_manager.stop()
    model.__init__(
        model.n_agents,
        model.confidence_bound,
        model.influence_strength,
        model.k_random,
        model.rewire_prob,
    )

    sim_manager.time_step = 0
    await server.start_time_step(0)

    updates = graph_env.update()
    await server.update_environment("opinion_network", updates)

    await server.end_time_step()


async def on_step(step: int) -> None:
    await server.start_time_step(step)

    model.step()
    updates = graph_env.update()
    await server.update_environment("opinion_network", updates)

    await server.end_time_step(step)


@button("reset", "Reset")
async def reset() -> None:
    await init_simulation()


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
    """Run the HK opinion dynamics visualization"""
    # Setup simulation manager
    sim_manager.on_step = on_step

    # Initialize
    graph_env.update()

    # Register components
    server.add_environment(graph_env)
    for param in bound_params:
        server.add_parameter(param)

    server.auto_register_from_globals(globals())
    sim_manager.register_to(server)

    print(f"TenSnap HK Opinion Dynamics starting on ws://localhost:{server_port}")
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())
