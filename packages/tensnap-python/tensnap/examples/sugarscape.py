from typing import List, Tuple, cast

from mesa import Agent, Model, DataCollector
from mesa.space import MultiGrid

# 移除 RandomActivation 导入，因为调度器已被弃用
import numpy as np
from tqdm import tqdm
import matplotlib.pyplot as plt

from tensnap import bind_mesa_grid_agent, bind_datacollector, bind_mesa_grid_environment
from tensnap.utils import img_to_npy_bytes

@bind_mesa_grid_agent(color=True, x="x", y="y")
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
      
    @property
    def x(self) -> int: # to convert non-serializable np.int64
        return int(self.pos[0])

    @property
    def y(self) -> int:
        return int(self.pos[1])

    def __init__(self, model: "Sugarscape"):
        super().__init__(model)
        self.metabolism = float(np.random.uniform(1, 4))
        self.vision = int(np.random.randint(1, 6))
        self.sugar = float(np.random.uniform(5, 25))

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
@bind_mesa_grid_environment(background=True)
class Sugarscape(Model):
    def __init__(self, width: int, height: int, agent_count: int, seed=None):
        super().__init__(seed=seed)  # 必须调用 super().__init__()
        self.grid = MultiGrid(width, height, True)
        self.sugar = sugar_field_circular(width, height)
        self.sugar_max = np.copy(self.sugar)
        self.create_agents(agent_count)

        self.datacollector = DataCollector(
            model_reporters={
                "Population": lambda m: m.get_population(),
                "Average Sugar": lambda m: m.get_average_sugar(),
                "Average Vision": lambda m: m.get_average_vision(),
            }
        )

    def create_agents(self, agent_count):
        sequence = np.random.choice(
            self.grid.width * self.grid.height, (agent_count,), replace=False
        )
        for w in sequence:
            x = w % self.grid.width
            y = (w - x) // self.grid.height
            agent = SugarAgent(self)
            self.grid.place_agent(agent, (x, y))

    def step(self):
        self.agents.shuffle_do("step")
        self.sugar[self.sugar < self.sugar_max] += 1
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
        img[self.sugar == 0] = [139, 69, 19]  # Brown for no sugar
        img[self.sugar == 1] = [222, 184, 135]  # Light brown for low sugar
        img[self.sugar == 2] = [345, 222, 107]  # Light green for medium sugar
        img[self.sugar == 3] = [34, 139, 34]  # Green for high sugar
        img[self.sugar >= 4] = [0, 255, 0]  # Bright green for max sugar
        return img_to_npy_bytes(img)


def plot_model(model: Sugarscape):
    # Extracting sugar levels from the model
    sugar = model.sugar
    agent_positions = [cast("SugarAgent", agent).pos for agent in model.agents]

    # Creating a plot
    plt.figure(figsize=(8, 8))

    # Plotting sugar distribution
    plt.imshow(8 - sugar, vmin=0, vmax=8)

    # Plotting agent positions
    agents_x = [pos[0] for pos in agent_positions]
    agents_y = [pos[1] for pos in agent_positions]
    agents_colors = [cast("SugarAgent", agent).sugar for agent in model.agents]
    plt.scatter(
        agents_x,
        agents_y,
        c=agents_colors,
        marker="o",
        s=10,
        label="Agents",
        cmap="viridis",
    )

    plt.title(f"Sugarscape Model at Step {model.steps}")  # 使用 model.steps
    plt.legend()
    plt.grid(True)
    plt.show()
