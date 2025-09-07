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
        hk_model.graph.nodes[node_id].update({
            'opinion': opinion,
            'color': "#E74C3C" if opinion < -0.33 else "#3498DB" if opinion > 0.33 else "#F39C12",
            'size': 8 + abs(opinion) * 5
        })
    env.update_from_networkx(hk_model.graph)


# Configure automatic updates
graph_env.update_source = model
graph_env.update_func = update_hk_visualization

# Auto-bind parameters
bound_params = quick_bind(model, exclude=["opinion_history"])


# Control buttons
@button("start_stop", "Start/Stop")
async def toggle() -> None:
    await sim_manager.toggle()


@button("reset", "Reset")
async def reset() -> None:
    def reset_model():
        model.__init__(model.n_agents, model.confidence_bound, model.influence_strength, 
                      model.k_random, model.rewire_prob)
        graph_env.update()
    await sim_manager.reset(reset_model)


@button("step", "Step")
async def step() -> None:
    await server.start_time_step(sim_manager.time_step)
    model.step()
    graph_env.update()
    await server.update_environment("opinion_network", dict(graph_env.to_dict()))
    await server.end_time_step()
    sim_manager.time_step += 1


# Charts
@chart("opinion_variance", "Opinion Variance", color="#E74C3C")
def opinion_variance() -> float: return float(np.var(model.opinions))

@chart("mean_opinion", "Mean Opinion", color="#3498DB") 
def mean_opinion() -> float: return float(np.mean(model.opinions))

@chart("network_density", "Network Density", color="#2ECC71")
def network_density() -> float:
    n = model.n_agents
    return model.graph.number_of_edges() / (n * (n - 1)) if n > 1 else 0.0


# Main function
async def main() -> None:
    """Run the HK opinion dynamics visualization"""
    # Setup simulation manager
    sim_manager.step_func = step
    
    # Initialize
    graph_env.update()
    
    # Register components
    server.add_environment(graph_env)
    for param in bound_params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())
    
    print(f"TenSnap HK Opinion Dynamics starting on ws://localhost:{server_port}")
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())
