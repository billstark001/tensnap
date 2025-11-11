# tensnap/examples/flock.py
"""Pure flocking simulation without any visualization dependencies"""

import random
import math
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from tensnap import bind_grid_agent, bind_grid_environment


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


@bind_grid_agent(size=True, icon=True, color=True, data=True, heading=True)
class Bird:
    """A single bird agent in the flock"""

    size = 5
    icon = "arrow"
    color = "#3498DB"

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

    def get_speed(self) -> float:
        """Get current speed of the bird"""
        return math.sqrt(self.vx * self.vx + self.vy * self.vy)

    def update_position(self, world_width: float, world_height: float):
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


@bind_grid_environment(coord_offset=True, trajectory_length=True)
class FlockSimulation:
    """Main flocking simulation class"""

    coord_offset = "float"
    trajectory_length = 5

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
