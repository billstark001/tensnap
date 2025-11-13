"""Mesa 3-compatible accessor TypedDict definitions"""

from typing import Any

from tensnap.models.environment import (
    make_grid_environment_accessor,
)
from tensnap.bindings.basic.accessor import (
    BindUniformAgentConfig,
    BindGridAgentConfig,
    BindGridEnvironmentConfig,
    UniformAgentAccessorDict,
    GridAgentAccessorDict,
    GridEnvironmentAccessorDict,
)


class BindMesaUniformAgentConfig(BindUniformAgentConfig):

    def __init__(
        self,
        id: str = "unique_id",
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
    ) -> None:
        self.accessor_dict: UniformAgentAccessorDict = {
            "id": id,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
        }


bind_mesa_agent = BindMesaUniformAgentConfig


class BindMesaGridAgentConfig(BindGridAgentConfig):

    def __init__(
        self,
        id: str = "unique_id",
        x: str = "pos[0]",
        y: str = "pos[1]",
        heading: str | bool | None = None,
        color: str | bool | None = None,
        icon: str | bool | None = None,
        size: str | bool | None = None,
        data: str | bool | None = None,
        trajectory_length: str | bool | None = None,
        trajectory_color: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GridAgentAccessorDict = {
            "id": id,
            "x": x,
            "y": y,
            "heading": heading,
            "color": color,
            "icon": icon,
            "size": size,
            "data": data,
            "trajectory_length": trajectory_length,
            "trajectory_color": trajectory_color,
        }


bind_mesa_grid_agent = BindMesaGridAgentConfig


class BindMesaGridEnvironmentConfig(BindGridEnvironmentConfig):

    def __init__(
        self,
        width: str = "grid.width",
        height: str = "grid.height",
        coord_offset: str | bool | None = None,
        background: str | bool | None = None,
        trajectory_length: str | bool | None = None,
        trajectory_color: str | bool | None = None,
    ) -> None:
        self.accessor_dict: GridEnvironmentAccessorDict = {
            "id": "id",
            "width": width,
            "height": height,
            "coord_offset": coord_offset,
            "background": background,
            "trajectory_length": trajectory_length,
            "trajectory_color": trajectory_color,
        }

    def get_accessor(self, id: str) -> Any:
        self.accessor_dict["id"] = id
        return make_grid_environment_accessor(**self.accessor_dict)


bind_mesa_grid_environment = BindMesaGridEnvironmentConfig
