"""Area-restricted search versus a persistent random-search control on a torus."""

# region Imports

import math
from enum import Enum
from typing import ClassVar, cast

import mesa
from tensnap import (
    NumberParameter,
    agent,
    agent_layer,
    bind_kwargs,
    env,
    grid_layer,
    map_agent_layer,
    trajectory_layer,
    xy_key_codec,
)
from tensnap.bindings.mesa.utils import Cell, CellAgent, OrthogonalMooreGrid

# endregion

# region Agents


class MushroomState(str, Enum):
    EMPTY = "empty"
    AVAILABLE = "available"
    COLLECTED = "collected"


@agent(icon="arrow", color="blue")
class Hunter(mesa.Agent):
    model: "ForagingModel"
    pos: tuple[float, float]

    _NEIGHBOR_OFFSETS: ClassVar[list[tuple[int, int]]] = [
        (dx, dy) for dx in range(-1, 2) for dy in range(-1, 2)
    ]

    def __init__(self, model: "ForagingModel", pos: tuple[float, float]) -> None:
        super().__init__(model)
        self.pos = pos
        self.time_since_last_found = 0
        self.has_found = False
        self.collected = 0
        self.heading_arc = self.model.random.randint(0, 359)

    @property
    def heading(self) -> float:
        return self.heading_arc * math.pi / 180.0

    def search(self) -> None:
        # rotate — 同时对角度取模，防止整数无限增长
        if (
            self.model.area_restricted
            and self.has_found
            and self.time_since_last_found <= 20
        ):
            self.heading_arc = (
                self.heading_arc + self.model.random.randint(-90, 90)
            ) % 360
        else:
            self.heading_arc = (
                self.heading_arc + self.model.random.randint(-10, 10)
            ) % 360

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
            if patch and patch.state == MushroomState.AVAILABLE:
                red_cells.append(patch)

        if red_cells:
            self.time_since_last_found = 0
            self.has_found = True
            self.collected += 1
            self.model.random.choice(red_cells).state = MushroomState.COLLECTED
        else:
            self.time_since_last_found += 1


class Patch(CellAgent):
    cell: Cell

    def __init__(self, model: "ForagingModel", cell: Cell) -> None:
        super().__init__(model)
        self.cell = cell
        self.state = MushroomState.EMPTY

    @property
    def color(self):
        return {
            MushroomState.EMPTY: "white",
            MushroomState.AVAILABLE: "red",
            MushroomState.COLLECTED: "yellow",
        }[self.state]


# endregion

# region Model


@trajectory_layer(
    width=False,
    agent_layer_id="hunters",
    z_index=36,
    length=10,
    color="#1D4ED8",
    on_agent_delete="retain",
)
@map_agent_layer(
    "patches",
    source="patch_map",
    key_codec=xy_key_codec("patch"),
    fields={
        "x": lambda _model, coord, _patch: coord[0],
        "y": lambda _model, coord, _patch: coord[1],
        "data": lambda _model, _coord, patch: {"mushroom_state": patch.state.value},
    },
    color=lambda _model, _coord, patch: patch.color,
    icon="square",
    size=1.0,
    z_index=35,
    coord_offset="int",
    restore=False,
)
@agent_layer("hunters", coord_offset="float")
@grid_layer()
@env()
@bind_kwargs(
    custom_bindings={
        "width": NumberParameter(
            "", min=1, max=None, step=1, allow_runtime_change=False
        ),
        "height": NumberParameter(
            "", min=1, max=None, step=1, allow_runtime_change=False
        ),
        "num_clusters": NumberParameter(
            "", min=0, max=None, step=1, allow_runtime_change=False
        ),
        "patches_per_cluster": NumberParameter(
            "", min=0, max=None, step=1, allow_runtime_change=False
        ),
        "num_turtles": NumberParameter(
            "", min=0, max=None, step=1, allow_runtime_change=False
        ),
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
    }
)
class ForagingModel(mesa.Model):  # type: ignore[misc]
    def __init__(
        self,
        width: int = 50,
        height: int = 50,
        num_clusters: int = 4,
        patches_per_cluster: int = 20,
        num_turtles: int = 2,
        seed: int = 7,
        area_restricted: bool = True,
    ) -> None:
        super().__init__(rng=seed)
        self.seed = seed
        self.area_restricted = area_restricted
        self.width = width
        self.height = height
        self.grid = OrthogonalMooreGrid(
            (width, height), torus=True, capacity=1, random=self.random
        )
        self.num_clusters = num_clusters
        self.patches_per_cluster = patches_per_cluster
        self.num_turtles = num_turtles
        self.running = True
        self.hunters: list[Hunter] = []
        self.patches: list[Patch] = []
        self.patch_map: dict[tuple[int, int], Patch] = {}

        # 创建 patches，同步维护查找表
        for x in range(width):
            for y in range(height):
                patch = Patch(self, self.grid[(x, y)])
                self.patch_map[(x, y)] = patch

        # 种植蘑菇，只在初始化时查找环形邻域。
        for _ in range(num_clusters):
            center_x = self.random.randrange(width)
            center_y = self.random.randrange(height)
            candidate_patches = cast(
                list[Patch],
                list(
                    self.grid[(center_x, center_y)]
                    .get_neighborhood(radius=5, include_center=True)
                    .agents
                ),
            )
            selected_patches = self.random.sample(
                candidate_patches, patches_per_cluster
            )
            for patch in selected_patches:
                patch.state = MushroomState.AVAILABLE

        # 删除不参与运算的 agent 列表，避免不必要的迭代开销
        for position, patch in list(self.patch_map.items()):
            if patch.state == MushroomState.EMPTY:
                patch.remove()
                del self.patch_map[position]
            else:
                self.patches.append(patch)

        # 创建猎人
        for _ in range(num_turtles):
            x = self.random.randrange(width)
            y = self.random.randrange(height)
            turtle = Hunter(self, (float(x), float(y)))
            self.hunters.append(turtle)

    def step(self) -> None:
        hunters_copy = self.hunters.copy()
        self.random.shuffle(hunters_copy)
        for hunter in hunters_copy:
            hunter.search()


# endregion
