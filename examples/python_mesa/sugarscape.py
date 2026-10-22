"""Sugarscape-inspired gradient foraging: one-cell moves on a renewable field."""

from typing import cast

import numpy as np
from mesa import DataCollector, Model
from tensnap import (
    EnumParameter,
    NumberParameter,
    agent,
    agent_layer,
    bind_datacollector,
    bind_kwargs,
    env,
    grid_layer,
    matrix_agent_layer,
    trajectory_layer,
)
from tensnap.bindings.mesa.utils import Cell, CellAgent, OrthogonalMooreGrid


@agent(x="cell.coordinate[0]", y="cell.coordinate[1]")
class SugarAgent(CellAgent):
    model: "Sugarscape"
    cell: Cell

    @property
    def color(self) -> str:
        sugar_level = min(max(self.sugar, 0), 50)  # Clamp between 0 and 50
        # Interpolate color from red (low sugar) to green (high sugar)
        red = int(255 * (1 - sugar_level / 50.0))
        green = int(255 * (sugar_level / 50.0))
        color = f"#{red:02x}{green:02x}00"
        return color

    def __init__(self, model: "Sugarscape", cell: Cell):
        super().__init__(model)
        self.cell = cell
        # 使用模型中配置的范围参数
        self.metabolism = float(
            model.rng.uniform(model.metabolism_min, model.metabolism_max)
        )
        self.vision = int(model.rng.integers(model.vision_min, model.vision_max))
        self.sugar = float(
            model.rng.uniform(model.initial_sugar_min, model.initial_sugar_max)
        )

    @property
    def data(self):
        return {
            "metabolism": self.metabolism,
            "vision": self.vision,
            "sugar": self.sugar,
        }

    def move(self):
        """Head one Moore-neighbor step toward the richest available visible cell.

        This gradient rule is a deliberate variant of the classic direct jump.
        Staying is allowed when the current cell wins; ties are randomized.
        """
        visible = [
            cell
            for cell in self.cell.get_neighborhood(radius=self.vision).cells
            if cell.is_empty
        ]
        visible.append(self.cell)
        self.model.random.shuffle(visible)
        target = max(visible, key=lambda cell: self.model.sugar[cell.coordinate])
        if target is self.cell:
            return False
        possible_moves = [
            cell for cell in self.cell.neighborhood.cells if cell.is_empty
        ]
        self.model.random.shuffle(possible_moves)
        if not possible_moves:
            return False
        self.cell = min(
            possible_moves,
            key=lambda cell: self.model.distance(cell.coordinate, target.coordinate),
        )
        return True

    def dig(self):
        pos = self.cell.coordinate
        self.sugar += self.model.sugar[pos]
        self.model.sugar[pos] = 0
        self.sugar -= self.metabolism

    def starve(self):
        if self.sugar <= 0:  # die
            self.remove()  # 使用 self.remove() 而不是 schedule.remove()

    def step(self):
        self.move()
        self.dig()
        self.starve()


def sugar_color(amount: int) -> str:
    return ("#6d3b13", "#5c6887", "#55a06b", "#22c836", "#00ff00")[
        min(max(int(amount), 0), 4)
    ]


def sugar_field_random(width: int, height: int, rng: np.random.Generator):
    return rng.choice([4, 3, 2, 1], size=(width, height))


def sugar_field_circular(width: int, height: int):
    x_coord = np.stack([np.arange(width)] * height, axis=1) / width
    y_coord = np.stack([np.arange(height)] * width, axis=0) / height
    ret = np.zeros((width, height), dtype=int) + 1
    c1 = ((x_coord - 0.25) ** 2 + (y_coord - 0.75) ** 2) ** 0.5
    c2 = ((x_coord - 0.75) ** 2 + (y_coord - 0.25) ** 2) ** 0.5
    c = np.copy(c1)
    c[c1 > c2] = c2[c1 > c2]
    ret[c < 0.54] = 2
    ret[c < 0.36] = 3
    ret[c < 0.18] = 4
    return ret


@env("sugarscape_env")
@agent_layer("agents", z_index="z_agents")
@matrix_agent_layer(
    "sugar",
    source="sugar_rows",
    fields={
        "data": lambda model, key, amount: {
            "sugar": int(amount),
            "capacity": int(model.sugar_max[key[1], model.height - 1 - key[0]]),
        }
    },
    color=lambda _model, _row, _col, amount: sugar_color(amount),
    icon="square",
    size=1.0,
    z_index=0,
    restore=False,
)
@grid_layer()
@trajectory_layer(agent_layer_id="agents", width=False, length=10)
@bind_kwargs(
    custom_bindings={
        "width": NumberParameter(
            "", min=1, max=None, step=1, allow_runtime_change=False
        ),
        "height": NumberParameter(
            "", min=1, max=None, step=1, allow_runtime_change=False
        ),
        "agent_count": NumberParameter(
            "", min=0, max=None, step=1, allow_runtime_change=False
        ),
        "sugar_growth_rate": NumberParameter(
            "", min=0, max=None, step=1, allow_runtime_change=False
        ),
        "vision_min": NumberParameter(
            "", min=1, max=None, step=1, allow_runtime_change=False
        ),
        "vision_max": NumberParameter(
            "", min=2, max=None, step=1, allow_runtime_change=False
        ),
        "grid_type": EnumParameter(
            "", options=["circular", "random"], allow_runtime_change=False
        ),
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
    }
)
@bind_datacollector()
class Sugarscape(Model):
    z_agents = 50
    z_sugar = 0
    t_length = 2

    def __init__(
        self,
        width: int,
        height: int,
        agent_count: int,
        seed: int = 7,
        grid_type: str = "circular",
        sugar_growth_rate: int = 1,
        metabolism_min: float = 1.0,
        metabolism_max: float = 4.0,
        vision_min: int = 1,
        vision_max: int = 6,
        initial_sugar_min: float = 5.0,
        initial_sugar_max: float = 25.0,
        torus: bool = True,
    ):
        super().__init__(rng=seed)
        self.agent_count = agent_count
        self.grid_type = grid_type
        self.seed = seed
        self.torus = torus
        self.width = width
        self.height = height
        self.grid = OrthogonalMooreGrid(
            (width, height), torus=torus, capacity=1, random=self.random
        )

        # 根据grid_type选择糖田生成方式
        if grid_type == "random":
            self.sugar = sugar_field_random(width, height, self.rng)
        elif grid_type == "circular":
            self.sugar = sugar_field_circular(width, height)
        else:
            raise ValueError(
                f"Unknown grid_type: {grid_type}. Must be 'random' or 'circular'"
            )

        self.sugar_max = np.copy(self.sugar)
        self.sugar_growth_rate = sugar_growth_rate

        # 保存智能体属性范围，供创建智能体时使用
        if not (
            0 < metabolism_min <= metabolism_max
            and 1 <= vision_min < vision_max
            and 0 <= initial_sugar_min <= initial_sugar_max
        ):
            raise ValueError("invalid metabolism, vision or initial sugar bounds")
        self.metabolism_min, self.metabolism_max = metabolism_min, metabolism_max
        self.vision_min, self.vision_max = vision_min, vision_max
        self.initial_sugar_min, self.initial_sugar_max = (
            initial_sugar_min,
            initial_sugar_max,
        )

        self.create_agents(agent_count)

        self.datacollector = DataCollector(
            model_reporters={
                "Population": lambda m: m.get_population(),
                "Average Sugar": lambda m: m.get_average_sugar(),
                "Average Vision": lambda m: m.get_average_vision(),
            }
        )

    @property
    def sugar_rows(self):
        """Expose existing x/y storage as renderer rows/columns without wrapper agents."""
        return self.sugar.T[::-1]

    def distance(self, source, target):
        dx, dy = abs(source[0] - target[0]), abs(source[1] - target[1])
        if self.torus:
            dx, dy = min(dx, self.width - dx), min(dy, self.height - dy)
        return dx + dy

    def create_agents(self, agent_count):
        sequence = self.rng.choice(
            self.width * self.height, (agent_count,), replace=False
        )
        for w in sequence:
            x = int(w % self.width)
            y = int((w - x) // self.width)
            position = (x, y)
            SugarAgent(self, self.grid[position])

    def step(self):
        # Random sequential activation, then field regrowth and data collection.
        self.agents.shuffle_do("step")
        # 使用配置的糖增长速率
        self.sugar[self.sugar < self.sugar_max] += self.sugar_growth_rate
        # 确保糖值不超过最大值
        self.sugar = np.minimum(self.sugar, self.sugar_max)
        self.datacollector.collect(self)

    def get_population(self) -> float:
        """Get current agent population"""
        return float(len(self.agents))

    def get_average_sugar(self) -> float:
        """Get average sugar level across all agents"""
        if len(self.agents) > 0:
            total_sugar = sum(cast(SugarAgent, a).sugar for a in self.agents)
            return float(total_sugar / len(self.agents))
        return 0.0

    def get_average_vision(self) -> float:
        """Get average vision across all agents"""
        if len(self.agents) > 0:
            total_vision = sum(cast(SugarAgent, a).vision for a in self.agents)
            return float(total_vision / len(self.agents))
        return 0.0
