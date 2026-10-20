from __future__ import annotations

from typing import cast

from _mesa_space import Cell, CellAgent, OrthogonalMooreGrid
from mesa import Model
from mesa.datacollection import DataCollector

DEFAULT_GRID_W = 50
DEFAULT_GRID_H = 50
DEFAULT_DENSITY = 0.8
DEFAULT_BALANCE = 0.5
DEFAULT_SIMILARITY_THRESHOLD = 0.7
SCHELLING_DYNAMICS_VERSION = 1


class SchellingAgent(CellAgent):
    """One occupied cell in the Schelling grid."""

    cell: Cell
    model: SchellingModel

    @property
    def cell(self):
        return CellAgent.cell.fget(self)

    @cell.setter
    def cell(self, value):
        # Delegate occupancy bookkeeping to Mesa; invalidate only derived analysis.
        CellAgent.cell.fset(self, value)
        self.model._neighbor_counts.clear()

    @property
    def group(self):
        return self._group

    @group.setter
    def group(self, value):
        self._group = value
        self.model._neighbor_counts.clear()

    def __init__(self, model: SchellingModel, cell: Cell, group: int) -> None:
        super().__init__(model)
        self.cell = cell
        self.group = group

    def is_satisfied(self: SchellingAgent, threshold: float | None = None) -> bool:
        if threshold is None:
            threshold = cast(float, self.model.similarity_threshold)

        same_group, occupied_neighbors = self.model.neighbor_counts(self)
        return occupied_neighbors == 0 or same_group >= threshold * occupied_neighbors


class SchellingModel(Model):
    """Batch-relocation Schelling variant on a bounded Moore grid.

    Dissatisfaction is read from the old state; shuffled unhappy agents are paired
    with shuffled cells that were empty at tick start. No moves may mean jamming.
    """

    agents: list[SchellingAgent]

    def __init__(
        self,
        *,
        width: int = DEFAULT_GRID_W,
        height: int = DEFAULT_GRID_H,
        density: float = DEFAULT_DENSITY,
        balance: float = DEFAULT_BALANCE,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        collect_data: bool = True,
        seed: int = 7,
    ) -> None:
        super().__init__(rng=seed)
        self.seed = seed

        self.width = width if width > 0 else DEFAULT_GRID_W
        self.height = height if height > 0 else DEFAULT_GRID_H
        self.density = density if 0 <= density <= 1 else DEFAULT_DENSITY
        self.balance = balance if 0 <= balance <= 1 else DEFAULT_BALANCE
        self._similarity_threshold = (
            similarity_threshold
            if 0 <= similarity_threshold <= 1
            else DEFAULT_SIMILARITY_THRESHOLD
        )
        self.grid = OrthogonalMooreGrid(
            (self.width, self.height), capacity=1, random=self.random, torus=False
        )
        self.initialized = False
        self.last_swapped = 0
        self.tick = 0
        self.collect_data = collect_data
        self._neighbor_counts: dict[SchellingAgent, tuple[int, int]] = {}
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
        if self.collect_data:
            self.datacollector.collect(self)

    @property
    def similarity_threshold(self) -> float:
        return self._similarity_threshold

    @similarity_threshold.setter
    def similarity_threshold(self, value: float) -> None:
        self._similarity_threshold = max(0.0, min(1.0, float(value)))

    def _populate(self) -> None:
        type1_threshold = self.density * self.balance
        for cell in self.grid.all_cells:
            value = self.random.random()
            if value < type1_threshold:
                SchellingAgent(self, cell, group=1)
            elif value < self.density:
                SchellingAgent(self, cell, group=2)

    def advance(self) -> bool:
        unsatisfied = [agent for agent in self.agents if not agent.is_satisfied()]
        empty_cells = [cell for cell in self.grid.all_cells if cell.is_empty]
        self.random.shuffle(unsatisfied)
        self.random.shuffle(empty_cells)

        swapped = min(len(unsatisfied), len(empty_cells))
        for agent, new_cell in zip(unsatisfied[:swapped], empty_cells[:swapped]):
            agent.cell = new_cell

        self.last_swapped = swapped
        self.tick += 1
        if self.collect_data:
            self.datacollector.collect(self)
        return swapped > 0

    def step(self) -> None:
        """Use Mesa's normal step contract; last_swapped reports movement."""
        self.advance()

    def satisfied_pct(self) -> float:
        occupied = len(self.agents)
        if occupied == 0:
            return 0.0
        return sum(1 for agent in self.agents if agent.is_satisfied()) / occupied

    def neighbor_counts(self, agent: SchellingAgent) -> tuple[int, int]:
        counts = self._neighbor_counts.get(agent)
        if counts is None:
            same, occupied = 0, 0
            for neighbor in agent.cell.get_neighborhood(radius=1).agents:
                occupied += 1
                if cast(SchellingAgent, neighbor).group == agent.group:
                    same += 1
            counts = (same, occupied)
            self._neighbor_counts[agent] = counts
        return counts

    def segregation_index(self) -> float:
        total_ratio = 0.0
        count = 0
        for agent in self.agents:
            same, occupied_neighbors = self.neighbor_counts(agent)
            if occupied_neighbors > 0:
                total_ratio += same / occupied_neighbors
                count += 1
        return 0.0 if count == 0 else total_ratio / count
