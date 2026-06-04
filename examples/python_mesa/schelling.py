from __future__ import annotations
from typing import List, cast

from mesa import Model
from mesa.datacollection import DataCollector
from mesa.discrete_space import Cell, CellAgent, OrthogonalMooreGrid

DEFAULT_GRID_W = 50
DEFAULT_GRID_H = 50
DEFAULT_DENSITY = 0.8
DEFAULT_BALANCE = 0.5
DEFAULT_SIMILARITY_THRESHOLD = 0.7


class SchellingAgent(CellAgent):
    """One occupied cell in the Schelling grid."""

    cell: "Cell"
    model: "SchellingModel"

    def __init__(self, model: "SchellingModel", cell, group: int) -> None:
        super().__init__(model)
        self.cell = cell
        self.group = group  # 1 or 2; there are no group-0 agents in Mesa

    def is_satisfied(self: SchellingAgent, threshold: float | None = None) -> bool:
        if threshold is None:
            threshold = self.model.similarity_threshold

        same_group = 0
        occupied_neighbors = 0

        for neighbor in self.cell.get_neighborhood(radius=1).agents:
            if cast(SchellingAgent, neighbor).group == self.group:
                same_group += 1
            occupied_neighbors += 1

        if occupied_neighbors == 0:
            return True

        # Same as Go: float64(sameGroup) >= threshold * float64(occupiedNeighbors)
        return same_group >= threshold * occupied_neighbors


class SchellingModel(Model):
    """Mesa rewrite of the provided Go model, preserving the step dynamics."""

    agents: "List[SchellingAgent]"

    def __init__(
        self,
        *,
        width: int = DEFAULT_GRID_W,
        height: int = DEFAULT_GRID_H,
        density: float = DEFAULT_DENSITY,
        balance: float = DEFAULT_BALANCE,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        rng=None,
    ) -> None:
        if isinstance(rng, str):
            rng = int(rng) if rng.strip() else None
        super().__init__(rng=rng)

        self.width = width if width > 0 else DEFAULT_GRID_W
        self.height = height if height > 0 else DEFAULT_GRID_H
        self.density = density if 0 <= density <= 1 else DEFAULT_DENSITY
        self.balance = balance if 0 <= balance <= 1 else DEFAULT_BALANCE
        self.similarity_threshold = (
            similarity_threshold
            if 0 <= similarity_threshold <= 1
            else DEFAULT_SIMILARITY_THRESHOLD
        )

        self.grid = OrthogonalMooreGrid(
            (self.width, self.height),
            capacity=1,
            random=self.random,
            torus=False,
        )

        self.initialized = False
        self.last_swapped = 0
        self._populate()
        self.initialized = True

        self.datacollector = DataCollector(
            model_reporters={
                "SatisfiedPct": lambda m: m.satisfied_pct(),
                "SegregationIndex": lambda m: m.segregation_index(),
                "Swapped": "last_swapped",
                "Occupied": lambda m: len(m.agents),
            },
            agent_reporters={
                "group": "group",
                "x": lambda a: a.cell.coordinate[0],
                "y": lambda a: a.cell.coordinate[1],
            },
        )
        self.datacollector.collect(self)

    def _populate(self) -> None:
        """Same per-cell probability rule as the Go Populate method."""
        next_type1 = 0
        next_type2 = 0
        type1_threshold = self.density * self.balance

        # OrthogonalMooreGrid exposes all cells; each may hold at most one agent.
        for cell in self.grid.all_cells:
            value = self.random.random()

            if value < type1_threshold:
                SchellingAgent(self, cell, group=1)
                next_type1 += 1
            elif value < self.density:
                SchellingAgent(self, cell, group=2)
                next_type2 += 1

    def advance(self) -> bool:
        """Global, synchronous-ish selection + paired relocation, matching Go Step()."""

        unsatisfied = [agent for agent in self.agents if not agent.is_satisfied()]
        empty_cells = [cell for cell in self.grid.all_cells if cell.is_empty]

        self.random.shuffle(unsatisfied)
        self.random.shuffle(empty_cells)

        swapped = min(len(unsatisfied), len(empty_cells))
        for agent, new_cell in zip(unsatisfied[:swapped], empty_cells[:swapped]):
            agent.cell = new_cell

        self.last_swapped = swapped
        self.datacollector.collect(self)
        return swapped > 0

    def step(self) -> bool:
        return self.advance()

    def satisfied_pct(self) -> float:
        occupied = len(self.agents)
        if occupied == 0:
            return 0.0
        return sum(1 for a in self.agents if a.is_satisfied()) / occupied

    def segregation_index(self) -> float:
        total_ratio = 0.0
        count = 0

        for agent in self.agents:
            same = 0
            occupied_neighbors = 0

            for neighbor in agent.cell.get_neighborhood(radius=1).agents:
                occupied_neighbors += 1
                if cast(SchellingAgent, neighbor).group == agent.group:
                    same += 1

            if occupied_neighbors > 0:
                total_ratio += same / occupied_neighbors
                count += 1

        return 0.0 if count == 0 else total_ratio / count
