from typing import (
    Any,
)

from tensnap.models.environment import (
    EnvironmentBinding,
    EnvironmentType,
)

# region Environment


class BindEnvironmentConfig:
    def __init__(
        self,
        id: str = "main",
        type: EnvironmentType = "2d",
    ) -> None:
        self.id: str = id
        self.type: EnvironmentType = type

    def __call__(self, cls: type[Any]) -> type[Any]:
        cls._tensnap_environment_binding_config = EnvironmentBinding(
            id=self.id, type=self.type
        )
        return cls


env = BindEnvironmentConfig

# endregion
