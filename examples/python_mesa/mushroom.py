# region Imports

from typing import Tuple, List, cast
import math
import random
import mesa

from tensnap import (
    agent,
    env,
    agent_layer,
    bind_kwargs,
    grid_layer,
    trajectory_layer,
)

# endregion

# region Agents


@agent(heading=True)
class Hunter(mesa.Agent):

    icon = "arrow"
    color = "blue"

    model: "ForagingModel"
    pos: Tuple[float, float]

    _NEIGHBOR_OFFSETS: List[Tuple[int, int]] = [
        (dx, dy) for dx in range(-1, 2) for dy in range(-1, 2)
    ]

    def __init__(self, model: "ForagingModel", pos: Tuple[float, float]) -> None:
        super().__init__(model)
        self.pos = pos
        self.time_since_last_found = 999
        self.heading_arc = random.randint(0, 359)

    @property
    def heading(self) -> float:
        return self.heading_arc * math.pi / 180.0

    def search(self) -> None:
        # rotate — 同时对角度取模，防止整数无限增长
        if self.time_since_last_found <= 20:
            self.heading_arc = (self.heading_arc + random.randint(-90, 90)) % 360
        else:
            self.heading_arc = (self.heading_arc + random.randint(-10, 10)) % 360

        # advance
        x, y = self.pos
        rad = math.radians(self.heading_arc)
        w, h = self.model.width, self.model.height
        new_x = (x + math.cos(rad)) % w
        new_y = (y + math.sin(rad)) % h
        self.pos = (new_x, new_y)

        grid_x = int(new_x)
        grid_y = int(new_y)
        patch_map = self.model.patch_map

        red_cells = []
        for dx, dy in Hunter._NEIGHBOR_OFFSETS:
            coord = ((grid_x + dx) % w, (grid_y + dy) % h)
            patch = patch_map.get(coord)
            if patch and patch.color == "red":
                red_cells.append(patch)

        if red_cells:
            self.time_since_last_found = 0
            # 优化5：random.choice 替代 np.random.choice，
            # 对小列表避免 numpy 的类型转换开销
            random.choice(red_cells).color = "yellow"
        else:
            self.time_since_last_found += 1


class Patch(mesa.Agent):  # type: ignore[misc]
    icon = "square"
    size = 1.0

    def __init__(self, model: "ForagingModel") -> None:
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
            cast(dict[str, object], self._state["data"])["mushroom_state"] = value

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
        # Keep the cached shape/id fields, but return a detached snapshot so
        # layer diffing never retains mutable nested state from the model.
        state = dict(self._state)
        state["data"] = dict(cast(dict[str, object], self._state["data"]))
        return state


# endregion

# region Model


@trajectory_layer(
    width=False,
    agent_layer_id="hunters",
    z_index="z_trace",
)
@agent_layer(
    "patches",
    item_iterable_projector="get_patch_layer_agents",
    z_index="z_patch",
    coord_offset="c_patch",
)
@agent_layer("hunters", item_iterable_projector="hunters", coord_offset="c_hunter")
@grid_layer(width="width", height="height")
@env()
@bind_kwargs()
class ForagingModel(mesa.Model):  # type: ignore[misc]

    length: int = 10
    color: str = "#1D4ED8"

    grid: "mesa.space.SingleGrid"

    z_patch = 35
    z_trace = 36
    c_patch = "int"
    c_hunter = "float"

    def __init__(
        self,
        width: int = 50,
        height: int = 50,
        num_clusters: int = 4,
        patches_per_cluster: int = 20,
        num_turtles: int = 2,
    ) -> None:
        super().__init__()
        self.width = width
        self.height = height
        self.grid = mesa.space.SingleGrid(width, height, True)
        self.num_clusters = num_clusters
        self.running = True
        self.hunters: List[Hunter] = []
        self.patches: List[Patch] = []
        self.patch_map: dict[Tuple[int, int], Patch] = {}

        # 创建 patches，同步维护查找表与状态缓存
        for x in range(width):
            for y in range(height):
                patch = Patch(self)
                self.grid.place_agent(patch, (x, y))
                patch._init_state()  # grid.place_agent 已完成 pos 赋值
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
            selected_patches = random.sample(candidate_patches, patches_per_cluster)
            for patch in selected_patches:
                patch.color = "red"

        # 删除不参与运算的 agent 列表，避免不必要的迭代开销
        for (x, y), patch in list(self.patch_map.items()):
            if patch.color == "white":
                self.grid.remove_agent(patch)
                del self.patch_map[(x, y)]
            else:
                self.patches.append(patch)

        # 创建猎人
        for _ in range(num_turtles):
            x = random.randrange(width)
            y = random.randrange(height)
            turtle = Hunter(self, (float(x), float(y)))
            self.hunters.append(turtle)

    def step(self) -> None:
        hunters_copy = self.hunters.copy()
        random.shuffle(hunters_copy)
        for hunter in hunters_copy:
            hunter.search()

    def get_patch_layer_agents(self) -> list[dict[str, object]]:
        """Expose the patch field as a dedicated square-agent layer."""
        return [patch.to_agent_state() for patch in self.patches]


# endregion
