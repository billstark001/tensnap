# Tutorial 4: Network Dynamics

**Difficulty**: Intermediate  
**Time**: 30-40 minutes

This tutorial maps directly to the runnable repository example in `examples/python/hk.py` and `examples/python/hk_viz.py`.

## Learning Objectives

In this tutorial, you will:

- build a graph-backed simulation using NetworkX and the current TenSnap decorators
- expose node and edge state with `@agent_layer` and `@edge_layer`
- bind editable parameters directly from the model with `@params`
- track opinion variance, mean opinion, and network density with charts

## Prerequisites

- completed [Tutorial 1: Simple Random Walk](./01-random-walk.md)
- Python 3.10+
- `numpy` and `networkx`
- TenSnap installed, or this repository checked out locally

## What We Are Building

We will build a Hegselmann-Krause opinion dynamics model on a directed random graph.

Each node stores an opinion in the range `[-1, 1]`.

On every step:

- each agent is influenced by in-neighbors whose opinions lie within a confidence bound
- each agent also samples a few random peers
- incompatible outgoing edges can be rewired to more compatible neighbors

The finished example exposes:

- a graph view with synchronized `agents` and `edges` layers
- parameters for network size, confidence bound, influence strength, rewiring, and edge density
- charts for opinion variance, mean opinion, and network density

Unlike Tutorials 1-3, this model does not use a grid layer. The environment is driven by graph nodes and edges directly.

## Step 1: Create the Simulation File

Create `hk.py` with the following content:

```python
from typing import List, Any, Dict

import numpy as np
import networkx as nx
import random


from tensnap import (
    env,
    agent_layer,
    edge_layer,
    params,
)


@env()
@agent_layer(
    "agents",
    item_iterable_projector="graph.nodes",
    item_dynamic_projector="render_tensnap_node",
)
@edge_layer(
    "edges",
    item_iterable_projector="graph.edges",
    item_dynamic_projector="render_tensnap_edge",
)
@params(
    include=[
        "n_agents",
        "confidence_bound",
        "influence_strength",
        "k_random",
        "rewire_prob",
        "edge_prob",
    ]
)
class DiscreteHKModel:
    def __init__(
        self,
        n_agents: int,
        confidence_bound: float = 0.3,
        influence_strength: float = 0.1,
        k_random: int = 3,
        rewire_prob: float = 0.1,
        initial_opinions: List[float] | None = None,
        edge_prob: float = 0.1,
    ):
        self.n_agents = n_agents
        self.confidence_bound = confidence_bound
        self.influence_strength = influence_strength
        self.k_random = k_random
        self.rewire_prob = rewire_prob
        self.edge_prob = edge_prob
        self.initial_opinions = initial_opinions
        self.graph: nx.DiGraph = nx.DiGraph()
        self.opinions: np.ndarray = np.zeros(n_agents)
        self.opinion_history: List[np.ndarray] = []

        self.init()

    def render_tensnap_node(self, node_id: int) -> Dict[str, Any]:
        opinion = self.opinions[node_id]
        return {
            "id": node_id,
            "opinion": opinion,
            "color": (
                "#E74C3C"
                if opinion < -0.33
                else "#2ECC71" if opinion > 0.33 else "#F1C40F"
            ),
            "size": 0.5 + abs(opinion) * 2,
        }

    def render_tensnap_edge(self, edge: tuple[int, int]) -> Dict[str, Any]:
        source, target = edge
        return {
            "source": source,
            "target": target,
            "directed": True,
        }

    def init(self):
        if self.initial_opinions is None:
            self.opinions = np.random.uniform(-1, 1, self.n_agents)
        else:
            raw = np.asarray(self.initial_opinions, dtype=float)
            if raw.ndim == 0:
                raise ValueError(
                    "initial_opinions must be a 1D sequence; got scalar. "
                    "This usually happens when a scalar parameter value is applied "
                    "to the initial_opinions field."
                )
            if raw.size != self.n_agents:
                raise ValueError(
                    f"initial_opinions length mismatch: expected {self.n_agents}, got {raw.size}."
                )
            self.opinions = raw.reshape(-1)

        self.graph = nx.erdos_renyi_graph(self.n_agents, self.edge_prob, directed=True)
        self.opinion_history = [self.opinions.copy()]

    def get_neighbors(self, agent_id: int) -> List[int]:
        return list(self.graph.predecessors(agent_id))

    def get_out_neighbors(self, agent_id: int) -> List[int]:
        return list(self.graph.successors(agent_id))

    def calculate_opinion_influence(self, agent_id: int) -> float:
        current_opinion = self.opinions[agent_id]
        total_influence = 0.0
        influence_count = 0

        neighbors = self.get_neighbors(agent_id)
        for neighbor in neighbors:
            neighbor_opinion = self.opinions[neighbor]
            if abs(current_opinion - neighbor_opinion) <= self.confidence_bound:
                total_influence += neighbor_opinion
                influence_count += 1

        all_agents = list(range(self.n_agents))
        all_agents.remove(agent_id)

        k_random_agents = random.sample(all_agents, min(self.k_random, len(all_agents)))
        for random_agent in k_random_agents:
            random_opinion = self.opinions[random_agent]
            if abs(current_opinion - random_opinion) <= self.confidence_bound:
                total_influence += random_opinion
                influence_count += 1

        if influence_count > 0:
            average_influence = total_influence / influence_count
            new_opinion = current_opinion + self.influence_strength * (
                average_influence - current_opinion
            )
            return np.clip(new_opinion, -1, 1)
        return current_opinion

    def find_incompatible_connections(self, agent_id: int) -> List[int]:
        current_opinion = self.opinions[agent_id]
        out_neighbors = self.get_out_neighbors(agent_id)
        incompatible = []

        for neighbor in out_neighbors:
            if abs(current_opinion - self.opinions[neighbor]) > self.confidence_bound:
                incompatible.append(neighbor)

        return incompatible

    def find_compatible_agent(self, agent_id: int) -> int | None:
        current_opinion = self.opinions[agent_id]
        compatible_agents = []

        for other_agent in range(self.n_agents):
            if (
                other_agent != agent_id
                and abs(current_opinion - self.opinions[other_agent])
                <= self.confidence_bound
                and not self.graph.has_edge(agent_id, other_agent)
            ):
                compatible_agents.append(other_agent)

        if compatible_agents:
            return random.choice(compatible_agents)
        return None

    def rewire_connections(self) -> Dict[str, int]:
        rewire_stats = {"disconnections": 0, "new_connections": 0}

        for agent_id in range(self.n_agents):
            incompatible = self.find_incompatible_connections(agent_id)

            if incompatible and random.random() < self.rewire_prob:
                to_disconnect = random.choice(incompatible)
                self.graph.remove_edge(agent_id, to_disconnect)
                rewire_stats["disconnections"] += 1

                compatible_agent = self.find_compatible_agent(agent_id)
                if compatible_agent is not None:
                    self.graph.add_edge(agent_id, compatible_agent)
                    rewire_stats["new_connections"] += 1

        return rewire_stats

    def step(self) -> Dict[str, Any]:
        new_opinions = np.zeros(self.n_agents)
        for agent_id in range(self.n_agents):
            new_opinions[agent_id] = self.calculate_opinion_influence(agent_id)

        self.opinions = new_opinions
        rewire_stats = self.rewire_connections()
        self.opinion_history.append(self.opinions.copy())

        return {
            "step": len(self.opinion_history) - 1,
            "mean_opinion": np.mean(self.opinions),
            "opinion_variance": np.var(self.opinions),
            "num_edges": self.graph.number_of_edges(),
            "rewire_stats": rewire_stats,
        }
```

### Why this works

- `@agent_layer(...)` reads the graph's nodes and converts each one into a synchronized node payload with `render_tensnap_node`.
- `@edge_layer(...)` reads the graph's edges and converts each one into a synchronized edge payload with `render_tensnap_edge`.
- `@params(...)` marks a subset of model attributes as editable UI parameters, so you do not need a separate config object in this example.
- The resulting synchronized environment contains two layers: `agents` and `edges`.

## Step 2: Create the Visualization Entry Point

Create `hk_viz.py` with the following content:

```python
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


async def main() -> None:
    model.init()

    scenario.add_environment(model)
    scenario.add_parameters(model)
    scenario.add_charts(globals())

    await scenario.register_model_handler(
        model.init,
        model.step,
        model.init,
    )

    print(f"TenSnap HK Opinion Dynamics starting on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

If you copy this outside the repository after installing `tensnap`, remove the `import import_config` line.

If you are running outside the repository, also install the graph dependencies:

```bash
pip install tensnap numpy networkx
```

### Why this works

- `scenario.add_environment(model)` reads the `@env`, `@agent_layer`, and `@edge_layer` metadata from `DiscreteHKModel`.
- `scenario.add_parameters(model)` reads the `@params(...)` declaration and exposes only the selected model attributes.
- `scenario.add_charts(globals())` registers the three module-level chart functions.
- `register_model_handler(model.init, model.step, model.init)` gives the built-in `reset` control a deterministic graph rebuild path.

## Step 3: Run the Tutorial

### Option A: Run from this repository

In one terminal:

```bash
pnpm dev:web
```

In another terminal:

```bash
cd examples/python
TENSNAP_USE_SOURCE=1 python hk_viz.py
```

Or from the repository root:

```bash
pnpm dev:py:hk
```

### Option B: Run from a standalone directory

```bash
pip install tensnap numpy networkx
python hk_viz.py
```

Use either the local renderer from `pnpm dev:web` or the hosted app at `https://tensnap.netlify.app`.

## What You Should See

- a graph view with colored nodes and directed edges
- parameters for `n_agents`, `confidence_bound`, `influence_strength`, `k_random`, `rewire_prob`, and `edge_prob`
- charts for opinion variance, mean opinion, and network density

Node color encodes opinion bands:

- red for strongly negative opinions
- yellow for near-neutral opinions
- green for strongly positive opinions

Node size grows with the absolute value of the opinion.

## How to Read the Result

- lowering `confidence_bound` makes consensus harder because fewer neighbors count as compatible
- increasing `k_random` mixes in more random peer influence on every step
- increasing `rewire_prob` makes the network topology adapt more aggressively
- the density chart reflects structural changes in the graph as rewiring proceeds

This tutorial is a good reference whenever your natural source of truth is a graph structure rather than a 2D grid.

## Exercises

### Exercise 1: Track Connected Components

Add a chart for weakly connected components:

```python
@chart("weak_components", "Weak Components", color="#7C3AED")
def weak_components() -> float:
    return float(nx.number_weakly_connected_components(model.graph))
```

### Exercise 2: Seed the Model with Opinion Blocks

Pass a custom `initial_opinions` list when creating `DiscreteHKModel`, for example half negative and half positive, then compare how fast the network mixes under different confidence bounds.

### Exercise 3: Change the Node Encoding

Edit `render_tensnap_node` so color represents degree and size represents variance contribution, then compare which encoding makes polarization easier to spot.

## References

- `examples/python/hk.py`
- `examples/python/hk_viz.py`
- `packages/tensnap-python/README.md`
- `docs/api-reference/python-api.md`