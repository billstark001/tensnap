# tensnap/examples/flock.py
"""Pure flocking simulation without any visualization dependencies."""

import json
import math
import random
from dataclasses import asdict, dataclass, fields
from typing import Any, Dict, List, Optional

from tensnap import (
    agent,
    agent_layer,
    env,
    grid_layer,
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


@params(exclude=r"world_.+")
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


@agent(size=0.5, icon="arrow", color="#3498DB")
class Bird:
    """A single bird agent in the flock"""

    def __init__(
        self, bird_id: str, x: float, y: float, heading: Optional[float] = None
    ):
        self.id = bird_id
        self.x = x
        self.y = y
        self.heading = (
            heading if heading is not None else random.uniform(0, 2 * math.pi)
        )
        self.vx = math.cos(self.heading) * random.uniform(0.2, 0.6)
        self.vy = math.sin(self.heading) * random.uniform(0.2, 0.6)

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
    def data(self) -> Dict[str, Any]:
        return {
            "vx": self.vx,
            "vy": self.vy,
            "speed": self.get_speed(),
        }


@scene_restore(
    "restore_scene",
    checkpoint_capture="capture_checkpoint",
    checkpoint_restore="restore_checkpoint",
)
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

    def __init__(self, config: Optional[FlockConfig] = None):
        self.config = config or FlockConfig()
        self.birds: List[Bird] = []
        self.time_step = 0

    @property
    def width(self) -> int:
        return int(self.config.world_width)

    @property
    def height(self) -> int:
        return int(self.config.world_height)

    def initialize(self) -> None:
        """Initialize the simulation with birds"""
        self.birds.clear()
        self.time_step = 0

        # Create birds in the center area
        center_x = self.config.world_width / 2
        center_y = self.config.world_height / 2
        spawn_radius = self.config.spawn_radius

        for i in range(int(self.config.num_agents + 0.5)):
            x = center_x + random.uniform(-spawn_radius, spawn_radius)
            y = center_y + random.uniform(-spawn_radius, spawn_radius)
            bird = Bird(f"bird_{i}", x, y)
            self.birds.append(bird)

    @monitor("flock_status", "Flock Status", render_hint="tree")
    def flock_status(self) -> Dict[str, Any]:
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
            "random_state": random.getstate(),
        }
        return json.dumps(checkpoint, separators=(",", ":")).encode("utf-8")

    def restore_checkpoint(self, checkpoint: bytes) -> None:
        """Restore a checkpoint produced by :meth:`capture_checkpoint`."""
        if not isinstance(checkpoint, (bytes, bytearray, memoryview)):
            raise TypeError("flock checkpoint must be bytes")

        state = json.loads(bytes(checkpoint).decode("utf-8"))
        config_state = state["config"]
        for field in fields(FlockConfig):
            setattr(self.config, field.name, config_state[field.name])

        birds: List[Bird] = []
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
            birds.append(bird)

        self.birds = birds
        self.time_step = int(state["time_step"])
        random.setstate(_nested_tuple(state["random_state"]))

    def restore_scene(self, payload: Dict[str, Any]) -> None:
        """Overlay complete renderer-visible v0.3 projected snapshot state."""
        parameter_fields = {field.name for field in fields(FlockConfig)}
        for parameter in payload.get("parameters", []):
            parameter_id = parameter["id"]
            if parameter_id not in parameter_fields:
                raise ValueError(f"unknown flock parameter: {parameter_id}")
            setattr(self.config, parameter_id, parameter["value"])

        envs = payload.get("envs", [])
        if envs:
            if len(envs) != 1 or envs[0].get("id") != "main":
                raise ValueError(
                    "flock restore requires the complete 'main' environment"
                )
            bird_layer = next(
                (
                    layer
                    for layer in envs[0].get("layers", [])
                    if layer.get("layer_id") == "birds"
                    and layer.get("layer_type") == "agent"
                ),
                None,
            )
            if bird_layer is None:
                raise ValueError("flock restore is missing the 'birds' agent layer")

            birds: List[Bird] = []
            seen_ids: set[str] = set()
            for item in bird_layer.get("items", []):
                bird_id = str(item["id"])
                if bird_id in seen_ids:
                    raise ValueError(f"duplicate bird id in snapshot: {bird_id}")
                seen_ids.add(bird_id)
                data = item.get("data") or {}
                bird = Bird.from_snapshot(
                    bird_id,
                    float(item["x"]),
                    float(item["y"]),
                    float(item["heading"]),
                    float(data["vx"]),
                    float(data["vy"]),
                )
                birds.append(bird)
            self.birds = birds

        if "time" in payload:
            self.time_step = int(payload["time"])

    def update_bird(self, bird: Bird) -> None:
        """Update a single bird using flocking rules"""
        sep_x = sep_y = align_x = align_y = coh_x = coh_y = 0.0
        neighbors = 0

        for other in self.birds:
            if other.id == bird.id:
                continue

            dx = bird.x - other.x
            dy = bird.y - other.y
            dist = math.sqrt(dx * dx + dy * dy)

            if 0 < dist < self.config.cohesion_distance:
                neighbors += 1

                # Separation: avoid crowding
                if dist < self.config.separation_distance:
                    sep_x += dx / dist
                    sep_y += dy / dist

                # Alignment: match neighbors
                if dist < self.config.alignment_distance:
                    align_x += other.vx
                    align_y += other.vy

                # Cohesion: move toward center
                coh_x += other.x
                coh_y += other.y

        if neighbors > 0:
            # Combine forces
            sep_x /= neighbors
            sep_y /= neighbors
            align_x /= neighbors
            align_y /= neighbors
            coh_x = (coh_x / neighbors) - bird.x
            coh_y = (coh_y / neighbors) - bird.y

            # Update velocity
            force_x = sep_x * 1.5 + align_x + coh_x
            force_y = sep_y * 1.5 + align_y + coh_y

            bird.vx += force_x * 0.1
            bird.vy += force_y * 0.1

            # Speed limit
            speed = math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy)
            if speed > self.config.max_speed:
                bird.vx = (bird.vx / speed) * self.config.max_speed
                bird.vy = (bird.vy / speed) * self.config.max_speed

    def step(self) -> None:
        """Perform one simulation step"""
        # Update all birds
        for bird in self.birds:
            self.update_bird(bird)

        # Update positions
        for bird in self.birds:
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
