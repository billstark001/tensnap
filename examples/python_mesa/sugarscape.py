from typing import Tuple, cast

from mesa import Agent, Model, DataCollector
from mesa.space import MultiGrid

import numpy as np

from tensnap import bind_mesa_grid_agent, bind_datacollector, bind_mesa_grid_environment


@bind_mesa_grid_agent(color=True)
class SugarAgent(Agent):

    model: "Sugarscape"
    pos: Tuple[int, int]

    @property
    def color(self) -> str:
        sugar_level = min(max(self.sugar, 0), 50)  # Clamp between 0 and 50
        # Interpolate color from red (low sugar) to green (high sugar)
        red = int(255 * (1 - sugar_level / 50.0))
        green = int(255 * (sugar_level / 50.0))
        color = f"#{red:02x}{green:02x}00"
        return color

    def __init__(self, model: "Sugarscape"):
        super().__init__(model)
        # 使用模型中配置的范围参数
        self.metabolism = float(np.random.uniform(*model.metabolism_range))
        self.vision = int(np.random.randint(*model.vision_range))
        self.sugar = float(np.random.uniform(*model.initial_sugar_range))

    def move(self):
        neighbors_sugar = list(
            self.model.grid.get_neighborhood(self.pos, moore=True, radius=self.vision)
        )
        np.random.shuffle(neighbors_sugar)
        neighbors = self.model.grid.get_neighborhood(self.pos, moore=True, radius=1)
        max_sugar = max(
            neighbors_sugar, key=lambda x: self.model.sugar[x], default=None
        )
        if not max_sugar:
            return False

        possible_moves = [
            cell
            for cell in neighbors
            if cell in neighbors_sugar and self.model.grid.is_cell_empty(cell)
        ]
        np.random.shuffle(possible_moves)
        if not possible_moves:
            return False
        new_pos = min(
            possible_moves,
            key=lambda x: abs(x[0] - max_sugar[0]) + abs(x[1] - max_sugar[1]),
        )
        self.model.grid.move_agent(self, new_pos)
        return True

    def dig(self):
        self.sugar += self.model.sugar[self.pos]
        self.model.sugar[self.pos] = 0
        self.sugar -= self.metabolism

    def starve(self):
        if self.sugar <= 0:  # die
            self.remove()  # 使用 self.remove() 而不是 schedule.remove()

    def step(self):
        self.move()
        self.dig()
        self.starve()


def sugar_field_random(width: int, height: int):
    return np.random.choice([4, 3, 2, 1], size=(width, height))


def sugar_field_circular(width: int, height: int):
    x_coord = np.arange(width)
    x_coord = np.stack([x_coord] * height, axis=1) / width
    y_coord = np.arange(height)
    y_coord = np.stack([y_coord] * width, axis=0) / height
    ret = np.zeros((width, height), dtype=int) + 1
    c1 = ((x_coord - 0.25) ** 2 + (y_coord - 0.75) ** 2) ** 0.5
    c2 = ((x_coord - 0.75) ** 2 + (y_coord - 0.25) ** 2) ** 0.5
    c = np.copy(c1)
    c[c1 > c2] = c2[c1 > c2]
    ret[c < 0.54] = 2
    ret[c < 0.36] = 3
    ret[c < 0.18] = 4
    return ret


@bind_datacollector()
@bind_mesa_grid_environment(background=True, trajectory_length=True)
class Sugarscape(Model):

    trajectory_length = 2

    def __init__(
        self,
        width: int,
        height: int,
        agent_count: int,
        seed=None,
        grid_type: str = "circular",
        sugar_growth_rate: int = 1,
        metabolism_range: Tuple[float, float] = (1.0, 4.0),
        vision_range: Tuple[int, int] = (1, 6),
        initial_sugar_range: Tuple[float, float] = (5.0, 25.0),
        torus: bool = True,
    ):
        super().__init__(seed=seed)
        self.grid = MultiGrid(width, height, torus)

        # 根据grid_type选择糖田生成方式
        if grid_type == "random":
            self.sugar = sugar_field_random(width, height)
        elif grid_type == "circular":
            self.sugar = sugar_field_circular(width, height)
        else:
            raise ValueError(
                f"Unknown grid_type: {grid_type}. Must be 'random' or 'circular'"
            )

        self.sugar_max = np.copy(self.sugar)
        self.sugar_growth_rate = sugar_growth_rate

        # 保存智能体属性范围，供创建智能体时使用
        self.metabolism_range = metabolism_range
        self.vision_range = vision_range
        self.initial_sugar_range = initial_sugar_range

        self.create_agents(agent_count)

        self.datacollector = DataCollector(
            model_reporters={
                "Population": lambda m: m.get_population(),
                "Average Sugar": lambda m: m.get_average_sugar(),
                "Average Vision": lambda m: m.get_average_vision(),
            }
        )

    def create_agents(self, agent_count):
        gw, gh = self.grid.width, self.grid.height
        sequence = np.random.choice(
            gw * gh, (agent_count,), replace=False
        )
        for w in sequence:
            x = w % gw
            y = (w - x) // gw
            agent = SugarAgent(self)
            self.grid.place_agent(agent, (x, y))

    def step(self):
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

    @property
    def background(self):
        img = np.zeros((self.grid.height, self.grid.width, 3), dtype=np.uint8)
        img[(self.sugar == 0).T] = [109, 59, 19]  # Brown for no sugar
        img[(self.sugar == 1).T] = [92, 104, 135]  # Light brown for low sugar
        img[(self.sugar == 2).T] = [85, 160, 107]  # Light green for medium sugar
        img[(self.sugar == 3).T] = [34, 200, 54]  # Green for high sugar
        img[(self.sugar >= 4).T] = [0, 255, 0]  # Bright green for max sugar
        return img
