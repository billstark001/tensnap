from typing import List, Tuple, cast

from mesa import Agent, Model
from mesa.space import MultiGrid
# 移除 RandomActivation 导入，因为调度器已被弃用
import numpy as np
from tqdm import tqdm
import matplotlib.pyplot as plt


class SugarAgent(Agent):

  model: 'Sugarscape'
  pos: Tuple[int, int]

  def __init__(self, model: 'Sugarscape'):  # 移除 unique_id 参数
    super().__init__(model)  # 只传递 model，unique_id 现在自动分配
    # params
    self.metabolism = np.random.uniform(1, 4)
    self.vision = np.random.randint(1, 6)
    # state
    self.sugar = np.random.uniform(5, 25)

  def move(self):
    neighbors_sugar = list(self.model.grid.get_neighborhood(
        self.pos, moore=True, radius=self.vision))
    np.random.shuffle(neighbors_sugar)
    neighbors = self.model.grid.get_neighborhood(
        self.pos, moore=True, radius=1)
    max_sugar = max(
        neighbors_sugar, key=lambda x: self.model.sugar[x], default=None)
    if not max_sugar:
      return False

    possible_moves = [
        cell for cell in neighbors if cell in neighbors_sugar and self.model.grid.is_cell_empty(cell)]
    np.random.shuffle(possible_moves)
    if not possible_moves:
      return False
    new_pos = min(
        possible_moves, key=lambda x: abs(x[0] - max_sugar[0]) + abs(x[1] - max_sugar[1]))
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


class Sugarscape(Model):
  def __init__(self, width: int, height: int, agent_count: int, seed=None):
    super().__init__(seed=seed)  # 必须调用 super().__init__()
    self.grid = MultiGrid(width, height, True)
    # 移除 schedule 初始化，使用内置的 AgentSet
    self.sugar = sugar_field_circular(width, height)
    self.sugar_max = np.copy(self.sugar)
    self.create_agents(agent_count)

  def create_agents(self, agent_count):
    sequence = np.random.choice(
        self.grid.width * self.grid.height,
        (agent_count, ),
        replace=False
    )
    for w in sequence:
      x = w % self.grid.width
      y = (w - x) // self.grid.height
      agent = SugarAgent(self)  # 只传递 model，不传递 unique_id
      self.grid.place_agent(agent, (x, y))
      # 不需要手动添加到 schedule，agents 自动管理

  def step(self):
    # 使用 AgentSet 功能替代 schedule.step()
    self.agents.shuffle_do("step")  # 随机激活所有 agents
    # sugar grow
    self.sugar[self.sugar < self.sugar_max] += 1


def plot_model(model: Sugarscape):
  # Extracting sugar levels from the model
  sugar = model.sugar
  agent_positions = [cast('SugarAgent', agent).pos for agent in model.agents]

  # Creating a plot
  plt.figure(figsize=(8, 8))

  # Plotting sugar distribution
  plt.imshow(8 - sugar, vmin=0, vmax=8)

  # Plotting agent positions
  agents_x = [pos[0] for pos in agent_positions]
  agents_y = [pos[1] for pos in agent_positions]
  agents_colors = [cast('SugarAgent', agent).sugar for agent in model.agents]
  plt.scatter(agents_x, agents_y, c=agents_colors, marker='o',
              s=10, label='Agents', cmap='viridis')

  plt.title(f'Sugarscape Model at Step {model.steps}')  # 使用 model.steps
  plt.legend()
  plt.grid(True)
  plt.show()


# Example usage:
model = Sugarscape(50, 50, 400)
for i in tqdm(range(100 + 1)):
  model.step()
  if i % 10 == 0:
    plot_model(model)