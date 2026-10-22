"""Contact graph storage and reusable degree-preserving graph operations."""

from __future__ import annotations

import networkx as nx


class ContactNetwork:
    """Own a simple, connected graph and a treatment-independent partition.

    Graph operations and connectivity belong to NetworkX. The explicit swap
    sampler retains the factorial-v1 proposal order and random draws, including
    rejected proposals, so existing tapes keep exactly the same contact graph.
    """

    def __init__(self, agent_ids, graph, *, topology: str, degree: int, communities):
        self.agent_ids = tuple(agent_ids)
        self.topology, self.degree = topology, degree
        self.communities = dict(communities)
        self.graph = nx.freeze(graph)
        self.adjacency = [
            sorted(self.graph.neighbors(i)) for i in range(len(self.agent_ids))
        ]

    def summary(self):
        return {
            "topology": self.topology,
            "degrees": [len(peers) for peers in self.adjacency],
            "edges": self.graph.number_of_edges(),
            "cross_community_edges": sum(
                self.communities[self.agent_ids[a]]
                != self.communities[self.agent_ids[b]]
                for a, b in self.graph.edges
            ),
            "communities": dict(self.communities),
            "adjacency": {
                identity: [self.agent_ids[j] for j in self.adjacency[i]]
                for i, identity in enumerate(self.agent_ids)
            },
        }


def add_regular_ring(graph, group: list[int], degree: int) -> None:
    """Join each node to degree/2 neighbors in each direction."""
    graph.add_edges_from(
        (node, group[(i + offset) % len(group)])
        for i, node in enumerate(group)
        for offset in range(1, degree // 2 + 1)
    )


def mix_edges(graph, rng, proposals: int) -> None:
    """Propose simple edge swaps; undo those that disconnect the graph.

    NetworkX also provides connected_double_edge_swap. This explicit loop fixes
    proposal count, edge ordering and random consumption for existing tapes.
    """
    for _ in range(proposals):
        edges = sorted((min(a, b), max(a, b)) for a, b in graph.edges)
        (a, b), (c, d) = rng.sample(edges, 2)
        if rng.random() < 0.5:
            c, d = d, c
        if len({a, b, c, d}) < 4 or graph.has_edge(a, d) or graph.has_edge(c, b):
            continue
        graph.remove_edges_from(((a, b), (c, d)))
        graph.add_edges_from(((a, d), (c, b)))
        if not nx.is_connected(graph):
            graph.remove_edges_from(((a, d), (c, b)))
            graph.add_edges_from(((a, b), (c, d)))
