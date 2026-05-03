from typing import (
    Any,
    Type,
)

from tensnap.models.environment import (
    EnvironmentType,
    EnvironmentBinding,
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

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        cls._tensnap_environment_binding_config = EnvironmentBinding(
            id=self.id, type=self.type
        )
        return cls


env = BindEnvironmentConfig

# endregion
