import json
from io import BytesIO
from typing import Any

import mesa
import numpy as np
from _mesa_space import (
    Cell as MesaCell,
)
from _mesa_space import (
    CellAgent,
    OrthogonalMooreGrid,
)
from tensnap import (
    agent,
    agent_layer,
    bind_kwargs,
    chart,
    checkpoint,
    cleanup_mesa_model_step,
    env,
    grid_layer,
    layer_restore,
    mesa_model_time,
    monitor,
    restore_mesa_model_time,
    scene_restore,
)
from tensnap.bindings.mesa import mesa_clock_restore


def _nested_tuple(value: Any) -> Any:
    """Rebuild tuple-based ``random.Random`` state after JSON decoding."""
    if isinstance(value, list):
        return tuple(_nested_tuple(item) for item in value)
    return value


@agent(
    id="cell_id", x="cell.coordinate[0]", y="cell.coordinate[1]", icon="square"
)
class Cell(CellAgent):
    model: "GameOfLife"
    cell: MesaCell

    @property
    def alive(self) -> bool:
        """Expose state for visualization and metadata consumers."""
        x, y = self.cell.coordinate
        return bool(self.model.alive[x, y])

    @alive.setter
    def alive(self, value: bool) -> None:
        x, y = self.cell.coordinate
        self.model.alive[x, y] = value

    @property
    def color(self) -> str:
        return "black" if self.alive else "white"

    @property
    def data(self) -> dict[str, bool]:
        """Keep projected snapshots independent from presentation colors."""
        return {"alive": self.alive}

    def __init__(self, model: "GameOfLife", cell: MesaCell):
        super().__init__(model)
        self.cell = cell
        x, y = cell.coordinate
        self.cell_id = f"{x}:{y}"


@bind_kwargs(exclude=["seed"])
@checkpoint(capture="capture_checkpoint", restore="restore_checkpoint")
@scene_restore(time=mesa_clock_restore)
@layer_restore(
    replace="restore_cells",
    validate="validate_cells",
    metadata="restore_grid_metadata",
    layer_id="cells",
)
@layer_restore(metadata="restore_grid_metadata", layer_id="grid")
@agent_layer("cells", item_iterable_projector="agents")
@grid_layer()
@env(id="cgol_grid")
class GameOfLife(mesa.Model):
    def __init__(self, width: int = 50, height: int = 50, seed=None):
        super().__init__(rng=seed)

        self.seed = seed
        self.width = width
        self.height = height
        self.grid = OrthogonalMooreGrid(
            (width, height), torus=True, capacity=1, random=self.random
        )

        # Store the simulation state in a dense NumPy array.
        # This avoids per-agent neighbor lookups during each step.
        self.alive = self.rng.choice(
            np.array([False, False, False, True], dtype=np.bool_),
            size=(width, height),
        )
        self.alive_count = int(self.alive.sum())

        for x in range(width):
            for y in range(height):
                Cell(self, self.grid[(x, y)])

        self.datacollector = mesa.DataCollector(
            model_reporters={"Alive": "alive_count", "Dead": "dead_count"}
        )
        self.datacollector.collect(self)

    @property
    def dead_count(self) -> int:
        return self.width * self.height - self.alive_count

    @monitor("board_status", "Board Status", render_hint="tree")
    def board_status(self) -> dict[str, int | float]:
        total = self.width * self.height
        return {
            "generation": int(mesa_model_time(self)),
            "alive": self.alive_count,
            "dead": self.dead_count,
            "density": self.alive_count / total if total else 0.0,
        }

    @chart(
        "cell_population",
        "Cell Population",
        data_list=[
            ("alive", "#111827", "Alive"),
            ("dead", "#E5E7EB", "Dead"),
        ],
    )
    def cell_population(self) -> dict[str, int]:
        return {"alive": self.alive_count, "dead": self.dead_count}

    def capture_checkpoint(self) -> bytes:
        """Capture exact model/RNG state in a pickle-free NumPy archive."""
        metadata = {
            "width": self.width,
            "height": self.height,
            "seed": self.seed,
            "time": mesa_model_time(self),
            "running": self.running,
            "rng_state": self.rng.bit_generator.state,
            "random_state": self.random.getstate(),
            "model_vars": self.datacollector.model_vars,
        }
        buffer = BytesIO()
        np.savez_compressed(
            buffer,
            alive=self.alive,
            metadata=np.asarray(json.dumps(metadata, separators=(",", ":"))),
        )
        return buffer.getvalue()

    def restore_checkpoint(self, checkpoint: bytes) -> None:
        """Restore a checkpoint produced by :meth:`capture_checkpoint`."""
        if not isinstance(checkpoint, (bytes, bytearray, memoryview)):
            raise TypeError("Game of Life checkpoint must be bytes")

        with np.load(BytesIO(bytes(checkpoint)), allow_pickle=False) as archive:
            alive = np.asarray(archive["alive"], dtype=np.bool_).copy()
            metadata = json.loads(str(archive["metadata"].item()))

        width = int(metadata["width"])
        height = int(metadata["height"])
        if alive.shape != (width, height):
            raise ValueError("checkpoint board shape does not match its dimensions")

        cleanup_mesa_model_step(self)
        type(self).__init__(self, width=width, height=height, seed=metadata["seed"])
        self.alive = alive
        self.alive_count = int(alive.sum())
        self.rng.bit_generator.state = metadata["rng_state"]
        self.random.setstate(_nested_tuple(metadata["random_state"]))
        restore_mesa_model_time(self, metadata["time"])
        self.running = bool(metadata["running"])
        self.datacollector.model_vars = {
            key: list(values) for key, values in metadata["model_vars"].items()
        }

    def restore_grid_metadata(self, metadata: dict[str, Any]) -> None:
        for key, expected in (("width", self.width), ("height", self.height)):
            if key in metadata and metadata[key] != expected:
                raise ValueError(f"Game of Life {key} disagrees with the board")

    def validate_cells(self, layer: dict[str, Any]) -> None:
        items = layer.get("items", [])
        if len(items) != self.width * self.height:
            raise ValueError("Game of Life restore requires every grid cell")
        seen: set[tuple[int, int]] = set()
        for item in items:
            pos = (item.get("x"), item.get("y"))
            if (
                pos in seen
                or not all(
                    isinstance(value, int) and not isinstance(value, bool)
                    for value in pos
                )
                or not (0 <= pos[0] < self.width and 0 <= pos[1] < self.height)
            ):
                raise ValueError(f"invalid or duplicate cell position: {pos}")
            if not isinstance((item.get("data") or {}).get("alive"), bool):
                raise TypeError(f"cell {pos} is missing boolean data.alive")
            seen.add(pos)

    def restore_cells(self, items: list[dict[str, Any]]) -> None:
        alive = np.zeros((self.width, self.height), dtype=np.bool_)
        for item in items:
            alive[item["x"], item["y"]] = item["data"]["alive"]
        self.alive = alive
        self.alive_count = int(alive.sum())
        for key, value in (("Alive", self.alive_count), ("Dead", self.dead_count)):
            values = self.datacollector.model_vars[key]
            if values:
                values[-1] = value
            else:
                values.append(value)

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
