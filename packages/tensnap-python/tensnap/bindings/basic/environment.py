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
        env_id: str = "main",
        env_type: EnvironmentType = "2d",
    ) -> None:
        self.env_id: str = env_id
        self.env_type: EnvironmentType = env_type

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        cls._tensnap_environment_binding_config = EnvironmentBinding(
            env_id=self.env_id, env_type=self.env_type
        )
        return cls


env = BindEnvironmentConfig

# endregion
