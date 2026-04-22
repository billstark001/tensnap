#region Imports

from typing import Tuple, List, cast

import random
import mesa
import numpy as np

from tensnap import bind_mesa_grid_agent, bind_mesa_grid_environment

#endregion

#region Agents


@bind_mesa_grid_agent(heading=True, color=True, trajectory_length=True, icon=True)
class Hunter(mesa.Agent):

    icon = "arrow"
    trajectory_length = 10
    color = 'blue'

    model: "ForagingModel"
    pos: Tuple[float, float]

    def __init__(self, model, pos: Tuple[float, float]):
        super().__init__(model)
        self.pos = pos
        self.time_since_last_found = 999
        self.heading_arc = random.randint(0, 359)

    @property
    def heading(self) -> float:
        return self.heading_arc * np.pi / 180.0

    def search(self):
        # rotate
        if self.time_since_last_found <= 20:
            self.heading_arc += random.randint(-90, 90)
        else:
            self.heading_arc += random.randint(-10, 10)

        # advance
        x, y = self.pos
        new_x = x + np.cos(np.radians(self.heading_arc))
        new_y = y + np.sin(np.radians(self.heading_arc))
        self.pos = (float(new_x) % self.model.width, float(new_y) % self.model.height)

        # 优化：直接使用model的grid查找附近的patch
        grid_x = int(new_x) % self.model.width
        grid_y = int(new_y) % self.model.height

        # 检查周围9个格子是否有红色蘑菇
        patches = self.model.grid.get_neighbors(
            (grid_x, grid_y), moore=True, include_center=True
        )
        red_cells = [patch for patch in patches if patch.color == "red"]  # type: ignore
        if red_cells:
            self.time_since_last_found = 0
            np.random.choice(red_cells).color = "yellow"  # type: ignore
        else:
            self.time_since_last_found += 1


class Patch(mesa.Agent):
    icon = "square"
    size = 1.0

    def __init__(self, model):
        super().__init__(model)
        self.color = "white"

    def to_agent_state(self) -> dict[str, object]:
        assert self.pos is not None
        x, y = cast(Tuple[int, int], self.pos)
        return {
            "id": f"patch:{x}:{y}",
            "x": x,
            "y": y,
            "icon": self.icon,
            "size": self.size,
            "color": self.color,
            "data": {"mushroom_state": self.color},
        }


#endregion

#region Model


@bind_mesa_grid_environment(coord_offset=True)
class ForagingModel(mesa.Model):

    grid: "mesa.space.SingleGrid"
    
    coord_offset = 'float'

    def __init__(
        self, width=50, height=50, num_clusters=4, patches_per_cluster=20, num_turtles=2
    ):
        super().__init__()
        self.width = width
        self.height = height
        self.grid = mesa.space.SingleGrid(width, height, True)
        self.num_clusters = num_clusters
        self.running = True
        self.hunters: List[Hunter] = []

        # create patches - 批量创建并存储在网格中
        for x in range(width):
            for y in range(height):
                self.grid.place_agent(Patch(self), (x, y))

        # plant mushrooms - 优化蘑菇种植
        for _ in range(num_clusters):
            center_x = random.randrange(width)
            center_y = random.randrange(height)

            # 收集半径5范围内的所有patches
            candidate_patches = cast(
                List[Patch],
                self.grid.get_neighbors(
                    (center_x, center_y), moore=True, include_center=True, radius=5
                ),
            )
            selected_patches = np.random.choice(
                len(candidate_patches), patches_per_cluster, replace=False
            )
            for patch_id in selected_patches:
                candidate_patches[patch_id].color = "red"

        # create hunters - 批量创建hunters并添加到列表
        for i in range(num_turtles):
            x = random.randrange(width)
            y = random.randrange(height)
            turtle = Hunter(self, (float(x), float(y)))
            self.hunters.append(turtle)

    def step(self):
        hunters_copy = self.hunters.copy()
        random.shuffle(hunters_copy)
        for hunter in hunters_copy:
            hunter.search()

    def get_patch_layer_agents(self) -> list[dict[str, object]]:
        """Expose the patch field as a dedicated square-agent layer."""
        ret: list[dict[str, object]] = []
        for x in range(self.width):
            for y in range(self.height):
                patch: Patch = self.grid[x, y]  # type: ignore
                if patch:
                    ret.append(patch.to_agent_state())
        return ret

#endregion
