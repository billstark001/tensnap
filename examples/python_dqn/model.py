# Reference:
# - Mesa documentation: https://mesa.readthedocs.io

from __future__ import annotations

from dataclasses import dataclass
import math
import random
from typing import Iterable

import torch
from mesa import Agent, Model
from mesa.space import MultiGrid

from .config import EnvConfig, Position

ACTION_TO_DELTA: dict[int, Position] = {
    0: (0, 0),
    1: (0, -1),
    2: (0, 1),
    3: (-1, 0),
    4: (1, 0),
}


@dataclass(slots=True)
class StepStats:
    evacuated_delta: int = 0
    dead_delta: int = 0
    congestion: int = 0
    guided_neighbors: int = 0


class GuideAgent(Agent):
    def __init__(self, model: "EvacuationModel", pos: Position) -> None:
        super().__init__(model)
        self.pos = pos


class EvacueeAgent(Agent):

    model: "EvacuationModel"

    def __init__(self, model: "EvacuationModel", pos: Position) -> None:
        super().__init__(model)
        self.pos = pos
        self.alive = True
        self.evacuated = False

    def step(self) -> None:
        if not self.alive or self.evacuated:
            return
        if self.pos in self.model.fire_cells:
            self.alive = False
            return
        candidates = self.model.get_movement_candidates(self.pos)
        if not candidates:
            return
        best_pos = self.model.rank_evacuee_moves(self, candidates)
        if best_pos != self.pos:
            self.model.grid.move_agent(self, best_pos)
            self.pos = best_pos
        if self.pos in self.model.exit_cells:
            self.evacuated = True
        elif self.pos in self.model.fire_cells:
            self.alive = False


class EvacuationModel(Model):

    def __init__(self, config: EnvConfig, seed: int | None = None) -> None:
        super().__init__(seed=seed)
        self.config = config
        self.width = config.width
        self.height = config.height
        self.grid = MultiGrid(self.width, self.height, torus=False)
        self.random = random.Random(seed)
        self.exit_cells: set[Position] = set(config.exits)
        self.wall_cells: set[Position] = set(config.walls)
        self.fire_cells: set[Position] = set(config.fire_sources)
        self.step_count = 0
        self.guide = GuideAgent(
            self,
            self._sample_spawn(
                exclude=self.exit_cells | self.wall_cells | self.fire_cells
            ),
        )
        self.grid.place_agent(self.guide, self.guide.pos)
        self.evacuees: list[EvacueeAgent] = []
        occupied: set[Position] = (
            {self.guide.pos} | self.exit_cells | self.wall_cells | self.fire_cells
        )
        for _ in range(config.num_evacuees):
            pos = self._sample_spawn(exclude=occupied)
            agent = EvacueeAgent(self, pos)
            self.grid.place_agent(agent, pos)
            self.evacuees.append(agent)
            occupied.add(pos)

    def reset(self, seed: int | None = None) -> "EvacuationModel":
        return EvacuationModel(self.config, seed=seed)

    @property
    def action_size(self) -> int:
        return len(ACTION_TO_DELTA)

    @property
    def state_size(self) -> int:
        return 16

    def env_step(self, action: int) -> tuple[torch.Tensor, float, bool, dict[str, float]]:
        self._move_guide(action)
        guided_neighbors = self.count_evacuees_near(
            self.guide.pos, self.config.guide_influence_radius
        )
        for evacuee in self.evacuees:
            evacuee.step()
        if self.step_count % self.config.fire_spread_interval == 0:
            self._spread_fire()
        stats = self._collect_step_stats(guided_neighbors)
        reward = self._compute_reward(stats)
        self.step_count += 1
        done = self.is_done()
        info = {
            "alive": float(self.alive_count),
            "evacuated": float(self.evacuated_count),
            "dead": float(self.dead_count),
            "congestion": float(stats.congestion),
        }
        return self.get_state(), reward, done, info

    def is_done(self) -> bool:
        everyone_resolved = (
            self.alive_count == 0
            or self.evacuated_count + self.dead_count == len(self.evacuees)
        )
        return everyone_resolved or self.step_count >= self.config.max_steps

    @property
    def alive_count(self) -> int:
        return sum(1 for a in self.evacuees if a.alive and not a.evacuated)

    @property
    def evacuated_count(self) -> int:
        return sum(1 for a in self.evacuees if a.evacuated)

    @property
    def dead_count(self) -> int:
        return sum(1 for a in self.evacuees if not a.alive and not a.evacuated)

    def get_state(self) -> torch.Tensor:
        gx, gy = self.guide.pos
        fx, fy = self.fire_centroid()
        nearest_exit = min(
            self._manhattan(self.guide.pos, exit_pos) for exit_pos in self.exit_cells
        )
        local_congestion = self.count_evacuees_near(self.guide.pos, radius=2)
        sector_counts = self._sector_counts_around_guide(max_radius=5)
        values = [
            gx / max(1, self.width - 1),
            gy / max(1, self.height - 1),
            fx / max(1, self.width - 1),
            fy / max(1, self.height - 1),
            self.alive_count / max(1, len(self.evacuees)),
            self.evacuated_count / max(1, len(self.evacuees)),
            self.dead_count / max(1, len(self.evacuees)),
            nearest_exit / max(1, self.width + self.height),
            local_congestion / max(1, len(self.evacuees)),
            len(self.fire_cells) / max(1, self.width * self.height),
            *[count / max(1, len(self.evacuees)) for count in sector_counts],
        ]
        return torch.tensor(values, dtype=torch.float32)

    def valid_position(self, pos: Position) -> bool:
        x, y = pos
        return (
            0 <= x < self.width and 0 <= y < self.height and pos not in self.wall_cells
        )

    def get_movement_candidates(self, pos: Position) -> list[Position]:
        candidates: list[Position] = []
        for dx, dy in ACTION_TO_DELTA.values():
            nxt = (pos[0] + dx, pos[1] + dy)
            if self.valid_position(nxt):
                candidates.append(nxt)
        return candidates

    def rank_evacuee_moves(
        self, agent: EvacueeAgent, candidates: Iterable[Position]
    ) -> Position:
        current = agent.pos
        best_score = -(10**9)
        best_positions: list[Position] = [current]
        for pos in candidates:
            score = 0.0
            if pos in self.fire_cells:
                score -= 100.0
            nearest_exit = min(
                self._manhattan(pos, exit_pos) for exit_pos in self.exit_cells
            )
            score -= 1.8 * nearest_exit
            fire_distance = self._distance_to_nearest_fire(pos)
            score += 1.3 * fire_distance
            occupancy = self._count_alive_evacuees_at(pos)
            if pos != current:
                score -= 0.9 * occupancy
            if (
                self._manhattan(pos, self.guide.pos)
                <= self.config.guide_influence_radius
            ):
                score += self.config.guide_follow_bias * self._guide_alignment_score(
                    pos
                )
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

    def _move_guide(self, action: int) -> None:
        dx, dy = ACTION_TO_DELTA.get(action, (0, 0))
        nxt = (self.guide.pos[0] + dx, self.guide.pos[1] + dy)
        if self.valid_position(nxt):
            self.grid.move_agent(self.guide, nxt)
            self.guide.pos = nxt

    def _spread_fire(self) -> None:
        new_fire: set[Position] = set(self.fire_cells)
        for x, y in list(self.fire_cells):
            for nx, ny in self._neighbors((x, y)):
                pos = (nx, ny)
                if pos in self.wall_cells or pos in self.exit_cells:
                    continue
                if self.random.random() < 0.25:
                    new_fire.add(pos)
        self.fire_cells = new_fire

    def _collect_step_stats(self, guided_neighbors: int) -> StepStats:
        evacuated_delta = sum(
            1
            for a in self.evacuees
            if a.evacuated and getattr(a, "_counted_evacuated", False) is False
        )
        dead_delta = sum(
            1
            for a in self.evacuees
            if (not a.alive and not a.evacuated)
            and getattr(a, "_counted_dead", False) is False
        )
        for evacuee in self.evacuees:
            if evacuee.evacuated:
                setattr(evacuee, "_counted_evacuated", True)
            if not evacuee.alive and not evacuee.evacuated:
                setattr(evacuee, "_counted_dead", True)
        congestion = 0
        for evacuee in self.evacuees:
            if not evacuee.alive or evacuee.evacuated:
                continue
            occupancy = self._count_alive_evacuees_at(evacuee.pos)
            if occupancy > 1:
                congestion += occupancy - 1
        return StepStats(
            evacuated_delta=evacuated_delta,
            dead_delta=dead_delta,
            congestion=congestion,
            guided_neighbors=guided_neighbors,
        )

    def _compute_reward(self, stats: StepStats) -> float:
        reward = 0.0
        reward += stats.evacuated_delta * self.config.evacuation_reward
        reward += stats.dead_delta * self.config.fire_reward_penalty
        reward += self.config.step_penalty
        reward += self.config.congestion_penalty * stats.congestion
        reward += self.config.clustering_bonus * stats.guided_neighbors
        return reward

    def _count_alive_evacuees_at(self, pos: Position) -> int:
        return sum(
            1 for a in self.evacuees if a.pos == pos and a.alive and not a.evacuated
        )

    def _distance_to_nearest_fire(self, pos: Position) -> int:
        if not self.fire_cells:
            return self.width + self.height
        return min(self._manhattan(pos, fire) for fire in self.fire_cells)

    def _guide_alignment_score(self, pos: Position) -> float:
        exit_distance = min(
            self._manhattan(pos, exit_pos) for exit_pos in self.exit_cells
        )
        guide_exit_distance = min(
            self._manhattan(self.guide.pos, exit_pos) for exit_pos in self.exit_cells
        )
        return float(guide_exit_distance - exit_distance)

    def _sector_counts_around_guide(self, max_radius: int) -> list[int]:
        gx, gy = self.guide.pos
        counts = [0] * 6
        for evacuee in self.evacuees:
            if not evacuee.alive or evacuee.evacuated:
                continue
            dx = evacuee.pos[0] - gx
            dy = evacuee.pos[1] - gy
            if abs(dx) + abs(dy) > max_radius:
                continue
            if dx == 0 and dy == 0:
                counts[0] += 1
            elif abs(dx) >= abs(dy) and dx < 0:
                counts[1] += 1
            elif abs(dx) >= abs(dy) and dx > 0:
                counts[2] += 1
            elif abs(dy) > abs(dx) and dy < 0:
                counts[3] += 1
            elif abs(dy) > abs(dx) and dy > 0:
                counts[4] += 1
            else:
                counts[5] += 1
        return counts

    def _neighbors(self, pos: Position) -> list[Position]:
        x, y = pos
        result: list[Position] = []
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nxt = (x + dx, y + dy)
            if self.valid_position(nxt):
                result.append(nxt)
        return result

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
