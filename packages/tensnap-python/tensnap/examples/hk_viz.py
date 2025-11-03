# tensnap/examples/hk_viz.py
"""TenSnap visualization for the Hegselmann-Krause opinion dynamics model"""

import asyncio
import os
import numpy as np
from typing import Dict, Any
from tensnap import (
    TenSnapServer,
    NXGraphEnvironmentBinder,
    make_graph_agent_accessor_nx,
    make_graph_edge_accessor_nx,
)
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import chart, button, quick_bind
from .hk import DiscreteHKModel


# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
server = TenSnapServer(port=server_port)
model = DiscreteHKModel(n_agents=50, confidence_bound=0.3, k_random=3)
sim_manager = SimulationManager(step_interval=0.1)


graph_env = NXGraphEnvironmentBinder(
    id="opinion_network",
    graph=model.graph,
    agent_accessor=make_graph_agent_accessor_nx(
        color=True, size=True, auto_collect_data=True
    ),
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


async def send_updates():
    """Send environment and agent updates to the server"""
    update_hk_visualization(model)
    model_updates = graph_env.get_model_dict()
    agent_updates = graph_env.get_agent_list()
    await server.update_environment("opinion_network", model_updates)
    await server.update_agents_batch("opinion_network", agent_updates)


# Auto-bind parameters
bound_params = quick_bind(model, exclude=["opinion_history"])


async def init_simulation() -> None:
    await sim_manager.stop()
    model.init()
    graph_env.graph = model.graph

    sim_manager.time_step = 0
    await server.start_time_step(0)
    await send_updates()
    await server.end_time_step()


async def on_step(step: int) -> None:
    await server.start_time_step(step)

    model.step()

    await send_updates()
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

    update_hk_visualization(model)

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
