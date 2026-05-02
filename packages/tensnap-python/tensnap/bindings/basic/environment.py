from typing import (
    Any,
    Type,
)

from tensnap.models.environment import (
    CanonicalEnvironmentType,
    EnvironmentBindingConfig,
)

# region Environment


class BindEnvironmentConfig:

    def __init__(
        self,
        environment_type: CanonicalEnvironmentType = "2d",
    ) -> None:
        self.environment_type: CanonicalEnvironmentType = environment_type

    def __call__(self, cls: Type[Any]) -> Type[Any]:
        cls._tensnap_environment_binding_config = EnvironmentBindingConfig(
            environment_type=self.environment_type
        )
        return cls


bind_env = BindEnvironmentConfig

# endregion
