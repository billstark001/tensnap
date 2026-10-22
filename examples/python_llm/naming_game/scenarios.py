"""Naming conditions and environment generation, independent of model objects."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

import networkx as nx

from .network import ContactNetwork, add_regular_ring, mix_edges

if TYPE_CHECKING:
    from .model import NamingConfig

NAMING_LABEL_ORDERS = ("QM", "MQ")
TOPOLOGIES = ("complete", "ring", "mixed", "community", "barbell")
INITIAL_NAMES = ("unassigned", "all-q", "all-m", "balanced", "polarized")
LAYOUTS = ("circle", "communities", "spring", "grid")


def validate_topology(topology: str, agents: int, degree: int) -> None:
    if topology not in TOPOLOGIES:
        raise ValueError("Unknown contact topology")
    if topology in ("mixed", "community") and (
        agents % 2 or degree < 2 or degree % 2 or degree >= agents // 2
    ):
        raise ValueError("Regular networks need even N, even degree, degree < N/2")
    if topology == "barbell" and (agents < 4 or agents % 2):
        raise ValueError("Barbell networks need an even population of at least four")


def create_contact_network(agent_ids, config: NamingConfig) -> ContactNetwork:
    """Generate the selected topology without consuming the model's RNGs."""
    agent_ids = tuple(agent_ids)
    n = len(agent_ids)
    if n < 2 or len(set(agent_ids)) != n:
        raise ValueError("A contact network needs at least two unique agents")
    validate_topology(config.topology, n, config.degree)
    rng = random.Random(config.seed ^ 0x6A09)
    order = list(range(n))
    rng.shuffle(order)
    communities = {agent_ids[node]: int(i >= n // 2) for i, node in enumerate(order)}
    graph = nx.Graph()
    graph.add_nodes_from(range(n))
    if config.topology == "complete":
        graph = nx.complete_graph(n)
    elif config.topology == "ring":
        graph = nx.cycle_graph(n)
    elif config.topology == "community":
        left, right = order[: n // 2], order[n // 2 :]
        add_regular_ring(graph, left, config.degree)
        add_regular_ring(graph, right, config.degree)
        graph.remove_edges_from(((left[0], left[1]), (right[0], right[1])))
        graph.add_edges_from(((left[0], right[0]), (left[1], right[1])))
    elif config.topology == "barbell":
        graph = nx.relabel_nodes(nx.barbell_graph(n // 2, 0), dict(enumerate(order)))
    else:
        add_regular_ring(graph, order, config.degree)
        mix_edges(graph, rng, 20 * n * config.degree)
    return ContactNetwork(
        agent_ids,
        graph,
        topology=config.topology,
        degree=config.degree,
        communities=communities,
    )


@dataclass
class NamingEnvironment:
    positions: list[tuple[str, float, float]]
    network: ContactNetwork
    minority_order: list[int]
    names: dict[str, str | None]


def initial_positions(config: NamingConfig, network: ContactNetwork):
    """Keep placement independent of contacts and decision RNG consumption."""
    ids = network.agent_ids
    if config.layout == "circle":
        return [
            (
                identity,
                6 + 5 * math.cos(2 * math.pi * i / len(ids)),
                6 + 5 * math.sin(2 * math.pi * i / len(ids)),
            )
            for i, identity in enumerate(ids)
        ]
    if config.layout == "communities":
        positions = {}
        for community in (0, 1):
            members = sorted(
                identity
                for identity in ids
                if network.communities[identity] == community
            )
            for i, identity in enumerate(members):
                angle = 2 * math.pi * i / len(members) - math.pi / 2
                positions[identity] = (
                    5 + 12 * community + 4 * math.cos(angle),
                    6 + 4.5 * math.sin(angle),
                )
        return [(identity, *positions[identity]) for identity in ids]
    if config.layout == "grid":
        columns = math.ceil(math.sqrt(len(ids)))
        return [
            (identity, 1 + 1.5 * (i % columns), 1 + 1.5 * (i // columns))
            for i, identity in enumerate(ids)
        ]
    positions = nx.spring_layout(
        network.graph, seed=config.seed, scale=5, center=(6, 6)
    )
    return [(identity, *map(float, positions[i])) for i, identity in enumerate(ids)]


def initial_names(config: NamingConfig, network: ContactNetwork):
    ids = network.agent_ids
    if config.initial_names == "unassigned":
        return dict.fromkeys(ids)
    if config.initial_names in ("all-q", "all-m"):
        return dict.fromkeys(ids, "Q" if config.initial_names == "all-q" else "M")
    if config.initial_names == "polarized":
        return {
            identity: "Q" if network.communities[identity] == 0 else "M"
            for identity in ids
        }
    order = list(ids)
    random.Random(config.seed ^ 0x1A17).shuffle(order)
    return {
        identity: "Q" if i < len(ids) // 2 else "M" for i, identity in enumerate(order)
    }


def initialize_environment(config: NamingConfig) -> NamingEnvironment:
    """Return positions, contacts and the treatment-independent minority order."""
    network = create_contact_network(
        [f"agent_{i}" for i in range(config.agents)], config
    )
    minority_order = list(range(config.agents))
    random.Random(config.seed ^ 0xC01117).shuffle(minority_order)
    return NamingEnvironment(
        initial_positions(config, network),
        network,
        minority_order,
        initial_names(config, network),
    )


@dataclass(frozen=True)
class NamingScenario:
    topology: str
    minority: bool = False
    agents: int | None = None
    initial_names: str = "unassigned"
    layout: str = "circle"
    degree: int | None = None

    def configure(
        self, config: NamingConfig, *, minority: int = 4, target: str | None = None
    ) -> NamingConfig:
        return replace(
            config,
            topology=self.topology,
            agents=config.agents if self.agents is None else self.agents,
            initial_names=self.initial_names,
            layout=self.layout,
            degree=config.degree if self.degree is None else self.degree,
            committed=minority if self.minority else 0,
            committed_name=config.committed_name if target is None else target,
        )

    def matches(self, config: NamingConfig) -> bool:
        return (
            (
                config.topology,
                bool(config.committed),
                config.initial_names,
                config.layout,
            )
            == (self.topology, self.minority, self.initial_names, self.layout)
            and (self.agents is None or config.agents == self.agents)
            and (self.degree is None or config.degree == self.degree)
        )


NAMING_EXPERIMENT_SCENARIOS = {
    "mixed-control": NamingScenario("mixed"),
    "mixed-minority": NamingScenario("mixed", minority=True),
    "community-control": NamingScenario("community"),
    "community-minority": NamingScenario("community", minority=True),
}
NAMING_SCENARIOS = {
    "small-population": NamingScenario("ring", agents=12),
    "large-population": NamingScenario("mixed", agents=64, degree=4),
    "all-q": NamingScenario("mixed", agents=24, degree=4, initial_names="all-q"),
    "all-m": NamingScenario("mixed", agents=24, degree=4, initial_names="all-m"),
    "balanced": NamingScenario("mixed", agents=24, degree=4, initial_names="balanced"),
    "two-communities": NamingScenario(
        "community",
        agents=24,
        degree=4,
        initial_names="polarized",
        layout="communities",
    ),
    "barbell-polarized": NamingScenario(
        "barbell", agents=24, initial_names="polarized", layout="communities"
    ),
    "spring-network": NamingScenario("mixed", agents=24, degree=4, layout="spring"),
    "grid-network": NamingScenario("mixed", agents=24, degree=4, layout="grid"),
    "complete": NamingScenario("complete"),
    "complete-minority": NamingScenario("complete", minority=True),
    "ring": NamingScenario("ring"),
    "ring-minority": NamingScenario("ring", minority=True),
    "barbell": NamingScenario("barbell", layout="communities"),
    **NAMING_EXPERIMENT_SCENARIOS,
}
