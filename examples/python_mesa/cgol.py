import json
from io import BytesIO
from typing import Any

import mesa
import numpy as np

from tensnap import (
    agent_layer,
    agent,
    bind_kwargs,
    chart,
    cleanup_mesa_model_step,
    env,
    grid_layer,
    monitor,
)


def _nested_tuple(value: Any) -> Any:
    """Rebuild tuple-based ``random.Random`` state after JSON decoding."""
    if isinstance(value, list):
        return tuple(_nested_tuple(item) for item in value)
    return value


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

    @property
    def data(self) -> dict[str, bool]:
        """Keep projected snapshots independent from presentation colors."""
        return {"alive": self.alive}

    def __init__(self, model: "GameOfLife"):
        super().__init__(model)

    # Kept for compatibility with Mesa-style staged activation.
    # The model step uses a vectorized update instead.
    def step(self) -> None:
        pass

    def advance(self) -> None:
        pass


@bind_kwargs(exclude=["seed"])
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
            "generation": int(self.steps),
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

    def _restore_time(self, steps: int, time: float) -> None:
        """Move Mesa's recurring step event alongside restored model time."""
        self._default_schedule.pause()
        self.steps = steps
        self.time = time
        self._default_schedule._execution_count = steps
        self._default_schedule.resume()

    def capture_checkpoint(self) -> bytes:
        """Capture exact model/RNG state in a pickle-free NumPy archive."""
        metadata = {
            "width": self.width,
            "height": self.height,
            "seed": self._seed,
            "steps": self.steps,
            "time": self._time,
            "agent_id_counter": self.agent_id_counter,
            "running": self.running,
            "rng_state": self.rng.bit_generator.state,
            "random_state": self.random.getstate(),
            "model_vars": self.datacollector.model_vars,
            "collection_steps": self.datacollector._collection_steps,
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
        self._restore_time(int(metadata["steps"]), float(metadata["time"]))
        self.agent_id_counter = int(metadata["agent_id_counter"])
        self.running = bool(metadata["running"])
        self.datacollector.model_vars = {
            key: list(values) for key, values in metadata["model_vars"].items()
        }
        self.datacollector._collection_steps = list(metadata["collection_steps"])

    def restore_scene(self, payload: dict[str, Any]) -> None:
        """Overlay a complete projected board for v0.3 scene restore."""
        dimensions = {"width": self.width, "height": self.height}
        for parameter in payload.get("parameters", []):
            parameter_id = parameter["id"]
            if parameter_id not in dimensions:
                raise ValueError(f"unknown Game of Life parameter: {parameter_id}")
            if int(parameter["value"]) != dimensions[parameter_id]:
                raise ValueError(
                    "projected Game of Life restore cannot change grid topology"
                )

        envs = payload.get("envs", [])
        if envs:
            if len(envs) != 1 or envs[0].get("id") != "cgol_grid":
                raise ValueError(
                    "Game of Life restore requires the complete 'cgol_grid' environment"
                )
            cell_layer = next(
                (
                    layer
                    for layer in envs[0].get("layers", [])
                    if layer.get("layer_id") == "cells"
                    and layer.get("layer_type") == "agent"
                ),
                None,
            )
            if cell_layer is None:
                raise ValueError("Game of Life restore is missing the 'cells' layer")

            items = cell_layer.get("items", [])
            if len(items) != self.width * self.height:
                raise ValueError("Game of Life restore requires every grid cell")
            alive = np.zeros((self.width, self.height), dtype=np.bool_)
            seen: set[tuple[int, int]] = set()
            for item in items:
                pos = (int(item["x"]), int(item["y"]))
                if pos in seen or not (
                    0 <= pos[0] < self.width and 0 <= pos[1] < self.height
                ):
                    raise ValueError(f"invalid or duplicate cell position: {pos}")
                data = item.get("data") or {}
                if not isinstance(data.get("alive"), bool):
                    raise ValueError(f"cell {pos} is missing boolean data.alive")
                seen.add(pos)
                alive[pos] = data["alive"]
            self.alive = alive
            self.alive_count = int(alive.sum())
            latest = {"Alive": self.alive_count, "Dead": self.dead_count}
            for key, value in latest.items():
                values = self.datacollector.model_vars[key]
                if values:
                    values[-1] = value
                else:
                    values.append(value)

        if "time" in payload:
            self._restore_time(int(payload["time"]), float(payload["time"]))

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
