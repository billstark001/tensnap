from typing import cast

import mesa
import numpy as np

from tensnap import (
    agent_layer,
    agent,
    bind_datacollector,
    bind_kwargs,
    env,
    grid_layer,
)


@agent(icon="square")
class Cell(mesa.Agent):
    model: "GameOfLife"
    pos: "tuple[int, int]"

    @property
    def alive(self) -> bool:
        """Expose state for visualization and metadata consumers."""
        x, y = self.pos
        return bool(self.model.alive[x, y])

    @alive.setter
    def alive(self, value: bool) -> None:
        x, y = self.pos
        self.model.alive[x, y] = value

    @property
    def color(self) -> str:
        return "black" if self.alive else "white"

    def __init__(self, model: "GameOfLife"):
        super().__init__(model)

    # Kept for compatibility with Mesa-style staged activation.
    # The model step uses a vectorized update instead.
    def step(self) -> None:
        pass

    def advance(self) -> None:
        pass


@bind_kwargs(exclude=["seed"])
@bind_datacollector()
@agent_layer("cells", item_iterable_projector="agents")
@grid_layer()
@env(id="cgol_grid")
class GameOfLife(mesa.Model):

    def __init__(self, width: int = 50, height: int = 50, seed=None):
        super().__init__(seed=seed)

        self.width = width
        self.height = height
        self.grid = mesa.space.SingleGrid(width, height, torus=True)

        # Store the simulation state in a dense NumPy array.
        # This avoids per-agent neighbor lookups during each step.
        self.alive = self.rng.choice(
            np.array([False, False, False, True], dtype=np.bool_),
            size=(width, height),
        )
        self.alive_count = int(self.alive.sum())

        for x in range(width):
            for y in range(height):
                self.grid.place_agent(Cell(self), (x, y))

        self.datacollector = mesa.DataCollector(
            model_reporters={"Alive": "alive_count"}
        )

    def step(self) -> None:
        board = self.alive

        # Toroidal Moore-neighborhood count.
        neighbors = np.zeros_like(board, dtype=np.uint8)
        for dx, dy in (
            (-1, -1),
            (-1, 0),
            (-1, 1),
            (0, -1),
            (0, 1),
            (1, -1),
            (1, 0),
            (1, 1),
        ):
            neighbors += np.roll(np.roll(board, dx, axis=0), dy, axis=1)

        self.alive = (neighbors == 3) | (board & (neighbors == 2))
        self.alive_count = int(self.alive.sum())

        self.datacollector.collect(self)
