# Reference:
# - Mesa documentation: https://mesa.readthedocs.io

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass
import math
import random
from typing import Iterable

import torch
from torch import Tensor
from mesa import Agent, Model
from mesa.datacollection import DataCollector
from mesa.space import MultiGrid
import tensnap as t

from .config import EnvConfig, Position

ACTION_TO_DELTA: dict[int, Position] = {
    0: (0, 0),
    1: (0, -1),
    2: (0, 1),
    3: (-1, 0),
    4: (1, 0),
}

WALL_COLOR = "#374151"
EXIT_COLOR = "#16A34A"
FIRE_COLOR = "#DC2626"
EVACUEE_ALIVE_COLOR = "#F59E0B"
EVACUEE_EVACUATED_COLOR = "#16A34A"
EVACUEE_DEAD_COLOR = "#9CA3AF"
GUIDE_COLOR = "#2563EB"


@dataclass(slots=True)
class StepStats:
    evacuated_delta: int = 0
    dead_delta: int = 0
    congestion: int = 0
    guided_redirects: int = 0
    movement_progress: int = 0
    valid_guide_action: bool = True


@t.agent(icon="circle", color=GUIDE_COLOR)
class GuideAgent(Agent):
    pos: Position

    def __init__(self, model: "EvacuationModel", pos: Position) -> None:
        super().__init__(model)
        self.spawn_pos = pos
        self.preferred_exit: Position | None = None

    @property
    def data(self):
        return {
            "preferred_exit": self.preferred_exit,
        }


@t.agent(icon="circle", size=0.6)
class EvacueeAgent(Agent):
    model: "EvacuationModel"
    pos: Position

    def __init__(self, model: "EvacuationModel", pos: Position) -> None:
        super().__init__(model)
        self.spawn_pos = pos
        self.alive = True
        self.evacuated = False
        self.target_exit = model.default_exit_for(pos)

    def step(self) -> int:
        """Advance one civilian step and return bounded route progress."""
        if not self.alive or self.evacuated:
            return 0
        if self.pos in self.model.fire_cells:
            self.alive = False
            return 0

        before_distance = self.model.route_distance(self.pos, self.target_exit)
        candidates = self.model.get_movement_candidates(self.pos)
        if not candidates:
            return 0
        best_pos = self.model.rank_evacuee_moves(self, candidates)
        if best_pos != self.pos:
            self.model.grid.move_agent(self, best_pos)
            self.pos = best_pos

        if self.pos in self.model.exit_cells:
            self.evacuated = True
        elif self.pos in self.model.fire_cells:
            self.alive = False

        after_distance = self.model.route_distance(self.pos, self.target_exit)
        if before_distance is None or after_distance is None:
            return 0
        return max(-1, min(1, before_distance - after_distance))

    @property
    def color(self) -> str:
        if self.evacuated:
            return EVACUEE_EVACUATED_COLOR
        if not self.alive:
            return EVACUEE_DEAD_COLOR
        return EVACUEE_ALIVE_COLOR

    @property
    def data(self):
        return {
            "alive": self.alive,
            "evacuated": self.evacuated,
            "target_exit": self.target_exit,
        }


def _make_cell_projector(color: str) -> t.AttrProjector:
    _color = color

    def f(pos: Position):
        return dict(
            id=str(pos), x=pos[0], y=pos[1], color=_color, icon="square", size=1
        )

    return f


@t.agent_layer("guides")
@t.trajectory_layer("evacuee_trails", agent_layer_id="evacuees", length=3, width=0.1)
@t.agent_layer("evacuees")
@t.agent_layer("exit_cells", item_projector=_make_cell_projector(EXIT_COLOR))
@t.agent_layer("wall_cells", item_projector=_make_cell_projector(WALL_COLOR))
@t.agent_layer("fire_cells", item_projector=_make_cell_projector(FIRE_COLOR))
@t.grid_layer()
@t.env(id="evacuation")
@t.bind_kwargs(exclude=".*")
class EvacuationModel(Model):
    def __init__(self, config: EnvConfig, seed: int | None = None) -> None:
        super().__init__(rng=seed)
        self.config = config
        self.width = config.width
        self.height = config.height
        self.grid = MultiGrid(self.width, self.height, torus=False)
        self.random = random.Random(seed)
        self.exit_cells: set[Position] = set(config.exits)
        self.wall_cells: set[Position] = set(config.walls)
        source_candidates = tuple(config.fire_sources)
        if config.sample_fire_source and len(source_candidates) > 1:
            self.fire_cells: set[Position] = {self.random.choice(source_candidates)}
        else:
            self.fire_cells = set(source_candidates)
        self.initial_fire_source = (
            next(iter(self.fire_cells)) if self.fire_cells else None
        )
        self.step_count = 0
        self.running = True
        self._route_distance_cache: dict[Position, dict[Position, int]] = {}

        guide_pos = self._guide_spawn()
        self.guide = GuideAgent(self, guide_pos)
        self.grid.place_agent(self.guide, self.guide.spawn_pos)

        self.evacuees: list[EvacueeAgent] = []
        occupied: set[Position] = (
            {self.guide.pos} | self.exit_cells | self.wall_cells | self.fire_cells
        )
        for _ in range(config.num_evacuees):
            pos = self._sample_evacuee_spawn(exclude=occupied)
            agent = EvacueeAgent(self, pos)
            self.grid.place_agent(agent, agent.spawn_pos)
            self.evacuees.append(agent)
            occupied.add(pos)

        self.datacollector = DataCollector(
            model_reporters={
                "Alive": lambda model: model.alive_count,
                "Evacuated": lambda model: model.evacuated_count,
                "Dead": lambda model: model.dead_count,
                "Fire Size": lambda model: model.fire_size,
            }
        )
        self.datacollector.collect(self)

    @property
    def guides(self):
        return [self.guide]

    @property
    def action_size(self) -> int:
        return len(ACTION_TO_DELTA)

    @property
    def state_size(self) -> int:
        return 16

    @property
    def left_exit(self) -> Position:
        return min(self.exit_cells, key=lambda pos: pos[0])

    @property
    def right_exit(self) -> Position:
        return max(self.exit_cells, key=lambda pos: pos[0])

    @property
    def burnable_cells(self) -> set[Position]:
        return {
            (x, y)
            for x in range(self.width)
            for y in range(self.height)
            if (x, y) not in self.wall_cells and (x, y) not in self.exit_cells
        }

    @property
    def burnable_cell_count(self) -> int:
        return len(self.burnable_cells)

    @property
    def fire_fully_spread(self) -> bool:
        return self.burnable_cells.issubset(self.fire_cells)

    @property
    def everyone_resolved(self) -> bool:
        return self.evacuated_count + self.dead_count == len(self.evacuees)

    @property
    def truncated(self) -> bool:
        return self.step_count >= self.config.max_steps and not self.everyone_resolved

    def env_step(
        self, action: int
    ) -> tuple[torch.Tensor, float, bool, dict[str, float]]:
        if self.is_done():
            self.running = False
            return self.get_state(), 0.0, True, self._step_info(congestion=0)

        self._route_distance_cache.clear()
        valid_guide_action = self._move_guide(action)
        guided_redirects = self._apply_guide_signal()
        movement_progress = sum(evacuee.step() for evacuee in self.evacuees)

        if (self.step_count + 1) % self.config.fire_spread_interval == 0:
            self._spread_fire()
            self._resolve_fire_exposure()
        self._route_distance_cache.clear()

        stats = self._collect_step_stats(
            guided_redirects=guided_redirects,
            movement_progress=movement_progress,
            valid_guide_action=valid_guide_action,
        )
        self.step_count += 1
        done = self.is_done()
        reward = self._compute_reward(stats, terminal=done)
        self.running = not done
        self.datacollector.collect(self)
        info = self._step_info(congestion=stats.congestion)
        info.update(
            {
                "guided_redirects": float(guided_redirects),
                "valid_guide_action": 1.0 if valid_guide_action else 0.0,
                "truncated": 1.0 if self.truncated else 0.0,
            }
        )
        return self.get_state(), reward, done, info

    def is_done(self) -> bool:
        return self.everyone_resolved or self.step_count >= self.config.max_steps

    @t.chart("alive", "Evacuation Outcomes", color=EVACUEE_ALIVE_COLOR)
    def alive_count(self) -> int:
        return sum(
            1 for evacuee in self.evacuees if evacuee.alive and not evacuee.evacuated
        )

    @alive_count.group("evacuated", "Evacuated", color=EVACUEE_EVACUATED_COLOR)
    def evacuated_count(self) -> int:
        return sum(1 for evacuee in self.evacuees if evacuee.evacuated)

    @alive_count.group("dead", "Dead", color=EVACUEE_DEAD_COLOR)
    def dead_count(self) -> int:
        return sum(
            1
            for evacuee in self.evacuees
            if not evacuee.alive and not evacuee.evacuated
        )

    @t.chart("fire_size", "Fire Size", color=FIRE_COLOR)
    def fire_size(self) -> int:
        return len(self.fire_cells)

    def get_state(self) -> Tensor:
        gx, gy = self.guide.pos
        fx, fy = self.fire_centroid()
        evacuee_count = max(1, len(self.evacuees))
        center_x = (self.width - 1) / 2
        fire_left = sum(1 for x, _ in self.fire_cells if x < center_x)
        fire_right = sum(1 for x, _ in self.fire_cells if x > center_x)
        target_left = sum(
            1
            for agent in self.evacuees
            if agent.alive
            and not agent.evacuated
            and agent.target_exit == self.left_exit
        )
        target_right = sum(
            1
            for agent in self.evacuees
            if agent.alive
            and not agent.evacuated
            and agent.target_exit == self.right_exit
        )
        guided_neighbors = self.count_evacuees_near(
            self.guide.pos, self.config.guide_influence_radius
        )
        nearest_fire = self._distance_to_nearest_fire(self.guide.pos)
        preferred_exit = 0.5
        if self.guide.preferred_exit == self.left_exit:
            preferred_exit = 0.0
        elif self.guide.preferred_exit == self.right_exit:
            preferred_exit = 1.0

        values = [
            gx / max(1, self.width - 1),
            gy / max(1, self.height - 1),
            fx / max(1, self.width - 1),
            fy / max(1, self.height - 1),
            self.alive_count / evacuee_count,
            self.evacuated_count / evacuee_count,
            self.dead_count / evacuee_count,
            self.step_count / max(1, self.config.max_steps),
            preferred_exit,
            fire_left / max(1, self.burnable_cell_count),
            fire_right / max(1, self.burnable_cell_count),
            target_left / evacuee_count,
            target_right / evacuee_count,
            guided_neighbors / evacuee_count,
            nearest_fire / max(1, self.width + self.height),
            len(self.fire_cells) / max(1, self.burnable_cell_count),
        ]
        return torch.tensor(values, dtype=torch.float32)

    def valid_position(self, pos: Position) -> bool:
        x, y = pos
        return (
            0 <= x < self.width and 0 <= y < self.height and pos not in self.wall_cells
        )

    def valid_guide_position(self, pos: Position) -> bool:
        return self.valid_position(pos) and pos not in self.fire_cells

    def get_movement_candidates(self, pos: Position) -> list[Position]:
        candidates: list[Position] = []
        for dx, dy in ACTION_TO_DELTA.values():
            nxt = (pos[0] + dx, pos[1] + dy)
            if self.valid_position(nxt) and nxt not in self.fire_cells:
                candidates.append(nxt)
        return candidates

    def default_exit_for(self, pos: Position) -> Position:
        distances = {
            exit_pos: self._manhattan(pos, exit_pos) for exit_pos in self.exit_cells
        }
        best = min(distances.values())
        choices = [
            exit_pos for exit_pos, distance in distances.items() if distance == best
        ]
        return self.random.choice(choices)

    def route_distance(self, pos: Position, target: Position) -> int | None:
        distance_map = self._route_distance_cache.get(target)
        if distance_map is None:
            distance_map = self._build_route_distance_map(target)
            self._route_distance_cache[target] = distance_map
        return distance_map.get(pos)

    def rank_evacuee_moves(
        self, agent: EvacueeAgent, candidates: Iterable[Position]
    ) -> Position:
        current = agent.pos
        best_score = -(10**9)
        best_positions: list[Position] = [current]
        for pos in candidates:
            distance = self.route_distance(pos, agent.target_exit)
            if distance is None:
                score = -1000.0 + 1.2 * self._distance_to_nearest_fire(pos)
            else:
                score = -3.0 * distance
                score += 0.35 * self._distance_to_nearest_fire(pos)
            occupancy = self._count_alive_evacuees_at(pos)
            if pos != current:
                score -= 0.9 * occupancy
            if self.random.random() < self.config.random_move_bias:
                score += self.random.uniform(-0.5, 0.5)
            if score > best_score:
                best_score = score
                best_positions = [pos]
            elif math.isclose(score, best_score, rel_tol=1e-6, abs_tol=1e-6):
                best_positions.append(pos)
        return self.random.choice(best_positions)

    def count_evacuees_near(self, pos: Position, radius: int) -> int:
        return sum(
            1
            for evacuee in self.evacuees
            if evacuee.alive
            and not evacuee.evacuated
            and self._manhattan(evacuee.pos, pos) <= radius
        )

    def fire_centroid(self) -> tuple[float, float]:
        if not self.fire_cells:
            return (0.0, 0.0)
        total_x = sum(x for x, _ in self.fire_cells)
        total_y = sum(y for _, y in self.fire_cells)
        n = len(self.fire_cells)
        return (total_x / n, total_y / n)

    def _move_guide(self, action: int) -> bool:
        if action not in ACTION_TO_DELTA:
            return False
        if action == 3:
            self.guide.preferred_exit = self.left_exit
        elif action == 4:
            self.guide.preferred_exit = self.right_exit

        dx, dy = ACTION_TO_DELTA[action]
        nxt = (self.guide.pos[0] + dx, self.guide.pos[1] + dy)
        if not self.valid_guide_position(nxt):
            return action == 0
        if nxt != self.guide.pos:
            self.grid.move_agent(self.guide, nxt)
            self.guide.pos = nxt
        return True

    def _apply_guide_signal(self) -> int:
        preferred_exit = self.guide.preferred_exit
        if preferred_exit is None:
            return 0
        redirected = 0
        for evacuee in self.evacuees:
            if not evacuee.alive or evacuee.evacuated:
                continue
            if (
                self._manhattan(evacuee.pos, self.guide.pos)
                > self.config.guide_influence_radius
            ):
                continue
            if evacuee.target_exit == preferred_exit:
                continue
            if self.random.random() <= self.config.guide_follow_bias:
                evacuee.target_exit = preferred_exit
                redirected += 1
        return redirected

    def _spread_fire(self) -> None:
        new_fire: set[Position] = set(self.fire_cells)
        for x, y in list(self.fire_cells):
            for nx, ny in self._neighbors((x, y)):
                pos = (nx, ny)
                if pos in self.wall_cells or pos in self.exit_cells:
                    continue
                if self.random.random() < self.config.fire_spread_probability:
                    new_fire.add(pos)
        self.fire_cells = new_fire

    def _resolve_fire_exposure(self) -> None:
        for evacuee in self.evacuees:
            if (
                evacuee.alive
                and not evacuee.evacuated
                and evacuee.pos in self.fire_cells
            ):
                evacuee.alive = False

    def _collect_step_stats(
        self,
        guided_redirects: int,
        movement_progress: int,
        valid_guide_action: bool,
    ) -> StepStats:
        evacuated_delta = sum(
            1
            for agent in self.evacuees
            if agent.evacuated and getattr(agent, "_counted_evacuated", False) is False
        )
        dead_delta = sum(
            1
            for agent in self.evacuees
            if (not agent.alive and not agent.evacuated)
            and getattr(agent, "_counted_dead", False) is False
        )
        for evacuee in self.evacuees:
            if evacuee.evacuated:
                setattr(evacuee, "_counted_evacuated", True)
            if not evacuee.alive and not evacuee.evacuated:
                setattr(evacuee, "_counted_dead", True)

        occupancy = Counter(
            evacuee.pos
            for evacuee in self.evacuees
            if evacuee.alive and not evacuee.evacuated
        )
        congestion = sum(max(0, count - 1) for count in occupancy.values())
        return StepStats(
            evacuated_delta=evacuated_delta,
            dead_delta=dead_delta,
            congestion=congestion,
            guided_redirects=guided_redirects,
            movement_progress=movement_progress,
            valid_guide_action=valid_guide_action,
        )

    def _compute_reward(self, stats: StepStats, terminal: bool) -> float:
        reward = 0.0
        reward += stats.evacuated_delta * self.config.evacuation_reward
        reward += stats.dead_delta * self.config.fire_reward_penalty
        reward += self.config.step_penalty
        reward += self.config.congestion_penalty * stats.congestion
        reward += self.config.progress_reward * stats.movement_progress
        if not stats.valid_guide_action:
            reward += self.config.invalid_action_penalty
        if terminal and self.alive_count:
            reward += self.config.unresolved_penalty * self.alive_count
        return reward

    def _step_info(self, congestion: int) -> dict[str, float]:
        return {
            "alive": float(self.alive_count),
            "evacuated": float(self.evacuated_count),
            "dead": float(self.dead_count),
            "congestion": float(congestion),
        }

    def _build_route_distance_map(self, target: Position) -> dict[Position, int]:
        distances = {target: 0}
        frontier: deque[Position] = deque([target])
        while frontier:
            current = frontier.popleft()
            for neighbor in self._neighbors(current):
                if neighbor in self.fire_cells or neighbor in distances:
                    continue
                distances[neighbor] = distances[current] + 1
                frontier.append(neighbor)
        return distances

    def _count_alive_evacuees_at(self, pos: Position) -> int:
        return sum(
            1
            for agent in self.evacuees
            if agent.pos == pos and agent.alive and not agent.evacuated
        )

    def _distance_to_nearest_fire(self, pos: Position) -> int:
        if not self.fire_cells:
            return self.width + self.height
        return min(self._manhattan(pos, fire) for fire in self.fire_cells)

    def _neighbors(self, pos: Position) -> list[Position]:
        x, y = pos
        result: list[Position] = []
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nxt = (x + dx, y + dy)
            if self.valid_position(nxt):
                result.append(nxt)
        return result

    def _guide_spawn(self) -> Position:
        center = (self.width // 2, self.height // 2)
        if self.valid_guide_position(center) and center not in self.exit_cells:
            return center
        return self._sample_spawn(
            exclude=self.exit_cells | self.wall_cells | self.fire_cells
        )

    def _sample_evacuee_spawn(self, exclude: set[Position]) -> Position:
        barrier_xs = sorted({x for x, _ in self.wall_cells})
        if len(barrier_xs) >= 2:
            left_x = barrier_xs[0] + 1
            right_x = barrier_xs[-1] - 1
        else:
            left_x = max(0, self.width // 3)
            right_x = min(self.width - 1, (2 * self.width) // 3)
        center_y = self.height // 2
        y_min = max(0, center_y - 3)
        y_max = min(self.height - 1, center_y + 3)
        candidates = [
            (x, y)
            for x in range(left_x, right_x + 1)
            for y in range(y_min, y_max + 1)
            if (x, y) not in exclude
        ]
        if not candidates:
            return self._sample_spawn(exclude)
        return self.random.choice(candidates)

    def _sample_spawn(self, exclude: set[Position]) -> Position:
        candidates = [
            (x, y)
            for x in range(self.width)
            for y in range(self.height)
            if (x, y) not in exclude
        ]
        if not candidates:
            raise ValueError("No valid spawn cells left.")
        return self.random.choice(candidates)

    @staticmethod
    def _manhattan(a: Position, b: Position) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
