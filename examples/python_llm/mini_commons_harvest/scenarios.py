"""Commons conditions and landscape generation, independent of model objects."""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .model import CommonsConfig

COMMONS_RULES = ("greedy", "conserve", "signal")
MOVES = {"north": (0, -1), "south": (0, 1), "west": (-1, 0), "east": (1, 0)}
DEFAULT_DROUGHT_START = 40
DEFAULT_DROUGHT_DURATION = 40


@dataclass
class CommonsEnvironment:
    habitat: list[list[bool]]
    resources: list[list[int]]
    components: list[list[tuple[int, int]]]
    positions: list[tuple[int, int]]


def initialize_environment(
    config: CommonsConfig, capacity: int, rng: random.Random
) -> CommonsEnvironment:
    """Generate fertile patches, full stock, connected components and starts.

    Placement consumes only the supplied model-owned environmental RNG, in the
    same order on initialization, reset and checkpoint reconstruction.
    """
    w, h = config.width, config.height
    centers = [(w // 4, h // 3), (3 * w // 4, h // 3), (w // 2, 2 * h // 3)]
    habitat = [
        [any(abs(x - cx) + abs(y - cy) <= 2 for cx, cy in centers) for x in range(w)]
        for y in range(h)
    ]
    resources = [[capacity if habitat[y][x] else 0 for x in range(w)] for y in range(h)]
    remaining = {(x, y) for y in range(h) for x in range(w) if habitat[y][x]}
    components = []
    while remaining:
        start = min(remaining)
        remaining.remove(start)
        component, todo = [start], [start]
        while todo:
            x, y = todo.pop()
            for dx, dy in MOVES.values():
                neighbor = (x + dx, y + dy)
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.append(neighbor)
                    todo.append(neighbor)
        components.append(sorted(component))
    starts = [(x, y) for y in range(h) for x in range(w) if habitat[y][x]]
    if config.agents > len(starts):
        raise ValueError("Too many agents for the initial fertile cells")
    rng.shuffle(starts)
    return CommonsEnvironment(habitat, resources, components, starts[: config.agents])


def drought_active(config: CommonsConfig, round_number: int) -> bool:
    return bool(
        config.drought_duration
        and config.drought_start
        <= round_number
        < config.drought_start + config.drought_duration
    )


@dataclass(frozen=True)
class CommonsScenario:
    rule: str
    delivery: str
    drought: bool

    def configure(self, config: CommonsConfig) -> CommonsConfig:
        return replace(
            config,
            rule=self.rule,
            message_delivery=self.delivery,
            drought_start=config.drought_start or DEFAULT_DROUGHT_START,
            drought_duration=(config.drought_duration or DEFAULT_DROUGHT_DURATION)
            if self.drought
            else 0,
        )

    def matches(self, config: CommonsConfig) -> bool:
        return (
            config.rule,
            config.message_delivery,
            bool(config.drought_duration),
        ) == (
            self.rule,
            self.delivery,
            self.drought,
        )


COMMONS_SCENARIOS = {
    f"{rule}-{delivery}-{'drought' if drought else 'normal'}": CommonsScenario(
        rule, delivery, drought
    )
    for rule in COMMONS_RULES
    for delivery in ("off", "on")
    for drought in (False, True)
}
