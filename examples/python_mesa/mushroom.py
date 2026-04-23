# region Imports

from typing import Tuple, List, cast
import math
import random
import mesa
import numpy as np

from tensnap import bind_mesa_grid_agent, bind_mesa_grid_environment

# endregion

# region Agents


@bind_mesa_grid_agent(heading=True, color=True, trajectory_length=True, icon=True)
class Hunter(mesa.Agent):

    icon = "arrow"
    trajectory_length = 10
    trajectory_color = "#1D4ED8"
    color = "blue"

    model: "ForagingModel"
    pos: Tuple[float, float]

    # 优化1：Moore 邻域偏移量作为类变量，只计算一次
    _NEIGHBOR_OFFSETS: List[Tuple[int, int]] = [
        (dx, dy) for dx in range(-1, 2) for dy in range(-1, 2)
    ]

    def __init__(self, model, pos: Tuple[float, float]):
        super().__init__(model)
        self.pos = pos
        self.time_since_last_found = 999
        self.heading_arc = random.randint(0, 359)

    @property
    def heading(self) -> float:
        # 优化2：math.pi 替代 np.pi，避免 numpy 属性查找
        return self.heading_arc * math.pi / 180.0

    def search(self):
        # rotate — 同时对角度取模，防止整数无限增长
        if self.time_since_last_found <= 20:
            self.heading_arc = (self.heading_arc + random.randint(-90, 90)) % 360
        else:
            self.heading_arc = (self.heading_arc + random.randint(-10, 10)) % 360

        # advance
        # 优化3：math.cos/sin/radians 对标量比 numpy 快约 3-5 倍
        x, y = self.pos
        rad = math.radians(self.heading_arc)
        w, h = self.model.width, self.model.height
        new_x = (x + math.cos(rad)) % w
        new_y = (y + math.sin(rad)) % h
        self.pos = (new_x, new_y)

        # 优化4：直接使用 patch_map 字典进行 O(1) 坐标→Patch 查找，
        # 完全替代每步调用 grid.get_neighbors() 的 Mesa 内部遍历开销
        grid_x = int(new_x)
        grid_y = int(new_y)
        patch_map = self.model.patch_map

        red_cells = []
        for dx, dy in Hunter._NEIGHBOR_OFFSETS:
            patch = patch_map[((grid_x + dx) % w, (grid_y + dy) % h)]
            if patch.color == "red":
                red_cells.append(patch)

        if red_cells:
            self.time_since_last_found = 0
            # 优化5：random.choice 替代 np.random.choice，
            # 对小列表避免 numpy 的类型转换开销
            random.choice(red_cells).color = "yellow"
        else:
            self.time_since_last_found += 1


class Patch(mesa.Agent):
    icon = "square"
    size = 1.0

    def __init__(self, model):
        super().__init__(model)
        self._color = "white"
        # 优化6：_state 字典只在初始化时构建一次，后续就地更新
        self._state: dict[str, object] = {}

    @property
    def color(self) -> str:
        return self._color

    @color.setter
    def color(self, value: str) -> None:
        if self._color != value:
            self._color = value
            # 就地更新已有字典，而非重新创建
            self._state["color"] = value
            cast(dict, self._state["data"])["mushroom_state"] = value

    def _init_state(self) -> None:
        """在 Mesa 完成 pos 赋值后，一次性构建状态字典。"""
        assert self.pos is not None
        x, y = cast(Tuple[int, int], self.pos)
        self._state = {
            "id": f"patch:{x}:{y}",
            "x": x,
            "y": y,
            "icon": self.icon,
            "size": self.size,
            "color": self._color,
            "data": {"mushroom_state": self._color},
        }

    def to_agent_state(self) -> dict[str, object]:
        # 直接返回引用，每步节省 2500 次字典构建
        return self._state


# endregion

# region Model


@bind_mesa_grid_environment(coord_offset=True)
class ForagingModel(mesa.Model):

    grid: "mesa.space.SingleGrid"

    coord_offset = "float"

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
        self.patches: List[Patch] = []
        # 优化6 配套：坐标到 Patch 的 O(1) 查找表
        self.patch_map: dict[Tuple[int, int], Patch] = {}

        # 创建 patches，同步维护查找表与状态缓存
        for x in range(width):
            for y in range(height):
                patch = Patch(self)
                self.grid.place_agent(patch, (x, y))
                patch._init_state()  # grid.place_agent 已完成 pos 赋值
                self.patches.append(patch)
                self.patch_map[(x, y)] = patch

        # 种植蘑菇（仅在初始化时调用一次，get_neighbors 开销可接受）
        for _ in range(num_clusters):
            center_x = random.randrange(width)
            center_y = random.randrange(height)
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

        # 创建猎人
        for _ in range(num_turtles):
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
        return [patch.to_agent_state() for patch in self.patches]


# endregion
