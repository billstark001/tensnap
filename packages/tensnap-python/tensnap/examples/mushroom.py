from typing import Tuple, List, cast

import random
import mesa
import numpy as np


class Hunter(mesa.Agent):

    model: "ForagingModel"
    pos: Tuple[float, float]

    def __init__(self, model):
        super().__init__(model)
        self.time_since_last_found = 999
        self.color = "yellow"
        self.size = 2
        self.direction = 0
        x, y = self.pos if self.pos else (0, 0)
        self.path = [(x, y)]

    def search(self):
        # rotate
        if self.time_since_last_found <= 20:
            self.direction += random.randint(-90, 90)
        else:
            self.direction += random.randint(-10, 10)

        # advance
        x, y = self.pos if self.pos else (0, 0)
        new_x = x + np.cos(np.radians(self.direction))
        new_y = y + np.sin(np.radians(self.direction))
        new_pos = (float(new_x), float(new_y))

        # move agent
        self.model.grid.move_agent(self, new_pos)
        self.path.append(self.pos)

        # 优化：直接使用model的patch_grid查找附近的patch
        grid_x = int(round(new_x)) % self.model.grid.width
        grid_y = int(round(new_y)) % self.model.grid.height

        # 检查周围9个格子是否有红色蘑菇
        cell_is_red = False
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                check_x = int((grid_x + dx) % self.model.grid.width)
                check_y = int((grid_y + dy) % self.model.grid.height)
                if self.model.patch_grid[check_x][check_y].color == "red":
                    # 计算距离，确保在范围内
                    patch_pos = (check_x, check_y)
                    distance = np.sqrt((new_x - check_x) ** 2 + (new_y - check_y) ** 2)
                    if distance <= 1 + 1e-8:
                        self.model.patch_grid[check_x][check_y].color = "yellow"
                        cell_is_red = True

        if cell_is_red:
            self.time_since_last_found = 0
        else:
            self.time_since_last_found += 1


class Patch(mesa.Agent):
    def __init__(self, model):
        super().__init__(model)
        self.color = "white"

    def step(self):
        pass


class ForagingModel(mesa.Model):
    def __init__(
        self, width=50, height=50, num_clusters=4, patches_per_cluster=20, num_turtles=2
    ):
        super().__init__()
        self.grid = mesa.space.ContinuousSpace(width, height, True)
        self.num_clusters = num_clusters
        self.running = True

        # 创建patch网格用于快速查找
        self.patch_grid: List[List[Patch]] = [
            [cast(Patch, None) for _ in range(height)] for _ in range(width)
        ]

        # create patches - 批量创建并存储在网格中
        for x in range(width):
            for y in range(height):
                p = Patch(self)
                self.grid.place_agent(p, (x, y))
                self.patch_grid[x][y] = p

        # plant mushrooms - 优化蘑菇种植
        for _ in range(num_clusters):
            center_x = random.randrange(width)
            center_y = random.randrange(height)

            # 收集半径5范围内的所有patches
            candidate_patches = []
            for x in range(max(0, center_x - 5), min(width, center_x + 6)):
                for y in range(max(0, center_y - 5), min(height, center_y + 6)):
                    distance = np.sqrt((x - center_x) ** 2 + (y - center_y) ** 2)
                    if distance <= 5:
                        candidate_patches.append(self.patch_grid[x][y])

            # 随机选择patches_per_cluster个patches种植蘑菇
            if len(candidate_patches) >= patches_per_cluster:
                selected_patches = np.random.choice(
                    candidate_patches, patches_per_cluster, replace=False
                )
                for patch in selected_patches:
                    patch.color = "red"

        # create hunters - 批量创建hunters
        for i in range(num_turtles):
            x = random.randrange(width)
            y = random.randrange(height)
            turtle = Hunter(self)
            turtle.direction = random.randint(0, 359)
            self.grid.place_agent(turtle, (x, y))

    def step(self):
        # 使用Mesa 3.0的AgentSet API进行高效的批量操作
        hunters = self.agents_by_type[Hunter]
        hunters.shuffle_do("search")
