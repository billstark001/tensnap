# tensnap/examples/flock.py
"""Synchronous Boids-inspired dynamics on a torus; see README.md for the rules."""

import json
import math
import random
from dataclasses import asdict, dataclass, fields
from typing import Any

from tensnap import (
    NumberParameter,
    agent,
    agent_layer,
    checkpoint,
    env,
    grid_layer,
    layer_restore,
    monitor,
    params,
    scene_restore,
    trajectory_layer,
)


def _nested_tuple(value: Any) -> Any:
    """Rebuild tuple-based ``random.Random`` state after JSON decoding."""
    if isinstance(value, list):
        return tuple(_nested_tuple(item) for item in value)
    return value


@params(
    exclude=r"world_.+",
    custom_bindings={
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
        "num_agents": NumberParameter("", step=1, allow_runtime_change=False),
        "spawn_radius": NumberParameter("", allow_runtime_change=False),
    },
)
@dataclass
class FlockConfig:
    """Configuration for flocking simulation"""

    separation_distance: float = 2.0
    alignment_distance: float = 5.0
    cohesion_distance: float = 8.0
    max_speed: float = 0.8
    num_agents: int = 50
    world_width: float = 40.0
    world_height: float = 40.0
    spawn_radius: float = 10.0
    seed: int = 7

    def __post_init__(self):
        """Optional model-side checks for direct Python and restored configuration."""
        for name in ("world_width", "world_height"):
            value = getattr(self, name)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        for name in (
            "separation_distance",
            "alignment_distance",
            "cohesion_distance",
            "max_speed",
            "spawn_radius",
        ):
            value = getattr(self, name)
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and nonnegative")
        for name in ("num_agents", "seed"):
            value = getattr(self, name)
            if (
                isinstance(value, bool)
                or not math.isfinite(value)
                or value < 0
                or int(value) != value
            ):
                raise ValueError(f"{name} must be a nonnegative integer")
            setattr(self, name, int(value))


@agent(size=0.5, icon="arrow", color="#3498DB")
class Bird:
    """A single bird agent in the flock"""

    def __init__(self, bird_id: str, x: float, y: float, rng: random.Random):
        self.id = bird_id
        self.x = x
        self.y = y
        self.heading = rng.uniform(0, 2 * math.pi)
        speed = rng.uniform(0.2, 0.6)
        self.vx = math.cos(self.heading) * speed
        self.vy = math.sin(self.heading) * speed

    @classmethod
    def from_snapshot(
        cls,
        bird_id: str,
        x: float,
        y: float,
        heading: float,
        vx: float,
        vy: float,
    ) -> "Bird":
        """Rebuild a bird without consuming RNG state during restore."""
        bird = cls.__new__(cls)
        bird.id = bird_id
        bird.x = x
        bird.y = y
        bird.heading = heading
        bird.vx = vx
        bird.vy = vy
        return bird

    def get_speed(self) -> float:
        """Get current speed of the bird"""
        return math.sqrt(self.vx * self.vx + self.vy * self.vy)

    def update_position(self, world_width: float, world_height: float) -> None:
        """Update bird position with boundary wrapping"""
        self.x = (self.x + self.vx) % world_width
        self.y = (self.y + self.vy) % world_height

        # Update heading based on velocity
        speed = self.get_speed()
        if speed > 0.01:
            self.heading = math.atan2(self.vy, self.vx)

    @property
    def data(self) -> dict[str, Any]:
        return {
            "vx": self.vx,
            "vy": self.vy,
            "speed": self.get_speed(),
        }


@checkpoint(capture="capture_checkpoint", restore="restore_checkpoint")
@scene_restore(time="restore_time")
@layer_restore(
    replace="restore_trajectory",
    metadata="restore_trajectory_metadata",
    layer_id="trails",
)
@layer_restore(
    create="create_bird",
    update="update_bird_from_item",
    delete="delete_bird",
    metadata="restore_space_metadata",
    layer_id="birds",
)
@layer_restore(metadata="restore_space_metadata", layer_id="grid")
@trajectory_layer(
    agent_layer_id="birds",
    width=False,
    length=5,
    color="#2563EB",
    on_agent_delete="retain",
    on_state_sync="preserve",
    on_reset="clear",
)
@agent_layer("birds", coord_offset="float")
@grid_layer()
@env()
class FlockSimulation:
    """Main flocking simulation class"""

    def __init__(self, config: FlockConfig | None = None):
        self.config = config or FlockConfig()
        self.rng = random.Random(self.config.seed)
        self.birds: list[Bird] = []
        self.time_step = 0

    @property
    def width(self) -> int:
        return int(self.config.world_width)

    @property
    def height(self) -> int:
        return int(self.config.world_height)

    def initialize(self) -> None:
        """Initialize the simulation with birds"""
        self.config.__post_init__()
        self.birds.clear()
        self.time_step = 0

        self.rng.seed(self.config.seed)
        # Create birds in the center area
        center_x = self.config.world_width / 2
        center_y = self.config.world_height / 2
        spawn_radius = self.config.spawn_radius

        for i in range(self.config.num_agents):
            x = (
                center_x + self.rng.uniform(-spawn_radius, spawn_radius)
            ) % self.config.world_width
            y = (
                center_y + self.rng.uniform(-spawn_radius, spawn_radius)
            ) % self.config.world_height
            bird = Bird(f"bird_{i}", x, y, self.rng)
            self.birds.append(bird)

    @monitor("flock_status", "Flock Status", render_hint="tree")
    def flock_status(self) -> dict[str, Any]:
        """Expose the latest model-wide diagnostics without chart history."""
        return {
            "step": self.time_step,
            "birds": len(self.birds),
            "average_speed": self.get_average_speed(),
            "order_parameter": self.get_order_parameter(),
        }

    def capture_checkpoint(self) -> bytes:
        """Capture exact model-private state for v0.3 snapshot restore."""
        checkpoint = {
            "config": asdict(self.config),
            "time_step": self.time_step,
            "birds": [
                {
                    "id": bird.id,
                    "x": bird.x,
                    "y": bird.y,
                    "heading": bird.heading,
                    "vx": bird.vx,
                    "vy": bird.vy,
                }
                for bird in self.birds
            ],
            "random_state": self.rng.getstate(),
        }
        return json.dumps(checkpoint, separators=(",", ":")).encode("utf-8")

    def restore_checkpoint(self, checkpoint: bytes) -> None:
        """Restore a checkpoint produced by :meth:`capture_checkpoint`."""
        if not isinstance(checkpoint, (bytes, bytearray, memoryview)):
            raise TypeError("flock checkpoint must be bytes")

        state = json.loads(bytes(checkpoint).decode("utf-8"))
        config = FlockConfig(**state["config"])
        rng = random.Random()
        rng.setstate(_nested_tuple(state["random_state"]))
        time_step = state["time_step"]
        if isinstance(time_step, bool) or int(time_step) != time_step or time_step < 0:
            raise ValueError("flock time must be nonnegative")

        birds: list[Bird] = []
        seen_ids: set[str] = set()
        for item in state["birds"]:
            bird_id = str(item["id"])
            if bird_id in seen_ids:
                raise ValueError(f"duplicate bird id in checkpoint: {bird_id}")
            seen_ids.add(bird_id)
            bird = Bird.from_snapshot(
                bird_id,
                float(item["x"]),
                float(item["y"]),
                float(item["heading"]),
                float(item["vx"]),
                float(item["vy"]),
            )
            if not all(
                math.isfinite(value)
                for value in (bird.x, bird.y, bird.heading, bird.vx, bird.vy)
            ):
                raise ValueError("bird state must be finite")
            birds.append(bird)

        self.birds = birds
        for field in fields(FlockConfig):
            setattr(self.config, field.name, getattr(config, field.name))
        self.time_step = int(time_step)
        self.rng = rng

    def restore_space_metadata(self, metadata: dict[str, Any]) -> None:
        """Grid and agent dimensions are derived from the restored config."""
        for key, expected in (("width", self.width), ("height", self.height)):
            if key in metadata and metadata[key] != expected:
                raise ValueError(f"flock {key} disagrees with the restored config")

    def restore_trajectory_metadata(self, metadata: dict[str, Any]) -> None:
        """The trajectory definition is static; its trace lives in the renderer."""
        if metadata.get("length", 5) != 5:
            raise ValueError("flock trajectory length is fixed at 5")

    def restore_trajectory(self, items: list[dict[str, Any]]) -> None:
        if items:
            raise ValueError("flock trajectory has no model-owned items")

    @staticmethod
    def _bird_from_item(item: dict[str, Any]) -> Bird:
        data = item.get("data") or {}
        return Bird.from_snapshot(
            str(item["id"]),
            float(item["x"]),
            float(item["y"]),
            float(item["heading"]),
            float(data["vx"]),
            float(data["vy"]),
        )

    def create_bird(self, item: dict[str, Any]) -> None:
        self.birds.append(self._bird_from_item(item))

    def update_bird_from_item(self, item: dict[str, Any]) -> None:
        replacement = self._bird_from_item(item)
        for index, bird in enumerate(self.birds):
            if bird.id == replacement.id:
                self.birds[index] = replacement
                return
        raise ValueError(f"unknown bird: {replacement.id}")

    def delete_bird(self, key: dict[str, Any]) -> None:
        self.birds = [bird for bird in self.birds if bird.id != key["id"]]

    def restore_time(self, time: float) -> None:
        self.time_step = int(time)

    def next_velocity(self, bird: Bird) -> tuple[float, float]:
        """Read the old population using minimum-image displacements on the torus."""
        sep_x = sep_y = align_x = align_y = coh_x = coh_y = 0.0
        separation_neighbors = alignment_neighbors = cohesion_neighbors = 0
        width, height = self.config.world_width, self.config.world_height
        for other in self.birds:
            if other.id == bird.id:
                continue
            dx = (other.x - bird.x + width / 2) % width - width / 2
            dy = (other.y - bird.y + height / 2) % height - height / 2
            dist = math.hypot(dx, dy)
            if 0 < dist < self.config.separation_distance:
                separation_neighbors += 1
                sep_x -= dx / dist
                sep_y -= dy / dist
            if 0 < dist < self.config.alignment_distance:
                alignment_neighbors += 1
                align_x += other.vx
                align_y += other.vy
            if 0 < dist < self.config.cohesion_distance:
                cohesion_neighbors += 1
                coh_x += dx
                coh_y += dy
        if separation_neighbors:
            sep_x /= separation_neighbors
            sep_y /= separation_neighbors
        if alignment_neighbors:
            align_x /= alignment_neighbors
            align_y /= alignment_neighbors
        if cohesion_neighbors:
            coh_x /= cohesion_neighbors
            coh_y /= cohesion_neighbors
        vx = bird.vx + (1.5 * sep_x + align_x + coh_x) * 0.1
        vy = bird.vy + (1.5 * sep_y + align_y + coh_y) * 0.1
        speed = math.hypot(vx, vy)
        if speed > self.config.max_speed:
            vx *= self.config.max_speed / speed
            vy *= self.config.max_speed / speed
        return vx, vy

    def step(self) -> None:
        """Compute every velocity before moving any bird (a synchronous tick)."""
        velocities = [self.next_velocity(bird) for bird in self.birds]
        for bird, (vx, vy) in zip(self.birds, velocities):
            bird.vx, bird.vy = vx, vy
            bird.update_position(self.config.world_width, self.config.world_height)
        self.time_step += 1

    def get_average_speed(self) -> float:
        """Calculate average speed of all birds"""
        if not self.birds:
            return 0.0

        speeds = [bird.get_speed() for bird in self.birds]
        return sum(speeds) / len(speeds)

    def get_order_parameter(self) -> float:
        """Measure flock alignment (0=random, 1=aligned)"""
        if not self.birds:
            return 0.0

        # Average velocity
        avg_vx = sum(bird.vx for bird in self.birds) / len(self.birds)
        avg_vy = sum(bird.vy for bird in self.birds) / len(self.birds)
        avg_speed = math.sqrt(avg_vx**2 + avg_vy**2)

        # Average individual speed
        individual_avg = self.get_average_speed()

        return avg_speed / individual_avg if individual_avg > 0 else 0.0
