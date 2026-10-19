"""Seeded contact networks, separate from contact and policy random streams."""

from __future__ import annotations

import random

import networkx as nx


class ContactNetwork:
    """Own a simple, connected graph and a treatment-independent partition.

    Graph operations and connectivity belong to NetworkX. The explicit swap
    sampler retains the factorial-v1 proposal order and random draws, including
    rejected proposals, so existing tapes keep exactly the same contact graph.
    """

    def __init__(self, agent_ids, *, seed: int, topology: str, degree: int = 4):
        self.agent_ids = tuple(agent_ids)
        n = len(self.agent_ids)
        if n < 2 or len(set(self.agent_ids)) != n:
            raise ValueError("A contact network needs at least two unique agents")
        if topology not in ("complete", "ring", "mixed", "community"):
            raise ValueError("Unknown contact topology")
        if topology in ("mixed", "community") and (
            n % 2 or degree < 2 or degree % 2 or degree >= n // 2
        ):
            raise ValueError("Regular networks need even N, even degree, degree < N/2")
        self.topology, self.degree = topology, degree
        self._rng = random.Random(seed ^ 0x6A09)
        self._order = list(range(n))
        self._rng.shuffle(self._order)
        self.communities = {
            self.agent_ids[node]: int(i >= n // 2) for i, node in enumerate(self._order)
        }
        self.graph = nx.Graph()
        self.graph.add_nodes_from(range(n))
        self._build()
        nx.freeze(self.graph)
        self.adjacency = [sorted(self.graph.neighbors(i)) for i in range(n)]

    def _ring(self, group, degree):
        self.graph.add_edges_from(
            (node, group[(i + offset) % len(group)])
            for i, node in enumerate(group)
            for offset in range(1, degree // 2 + 1)
        )

    def _build(self):
        n, order = len(self.agent_ids), self._order
        if self.topology == "complete":
            self.graph.add_edges_from((i, j) for i in range(n) for j in range(i + 1, n))
        elif self.topology == "ring":
            self._ring(list(range(n)), 2)
        elif self.topology == "community":
            self._ring(order[: n // 2], self.degree)
            self._ring(order[n // 2 :], self.degree)
            a, b, c, d = order[0], order[1], order[n // 2], order[n // 2 + 1]
            self.graph.remove_edges_from(((a, b), (c, d)))
            self.graph.add_edges_from(((a, c), (b, d)))
        else:
            self._ring(order, self.degree)
            self._mix(20 * n * self.degree)

    def _mix(self, proposals):
        for _ in range(proposals):
            edges = sorted((min(a, b), max(a, b)) for a, b in self.graph.edges)
            (a, b), (c, d) = self._rng.sample(edges, 2)
            if self._rng.random() < 0.5:
                c, d = d, c
            if (
                len({a, b, c, d}) < 4
                or self.graph.has_edge(a, d)
                or self.graph.has_edge(c, b)
            ):
                continue
            self.graph.remove_edges_from(((a, b), (c, d)))
            self.graph.add_edges_from(((a, d), (c, b)))
            if not nx.is_connected(self.graph):
                self.graph.remove_edges_from(((a, d), (c, b)))
                self.graph.add_edges_from(((a, b), (c, d)))

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
