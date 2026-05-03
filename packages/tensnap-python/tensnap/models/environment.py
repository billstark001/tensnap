from typing import TypeAlias, Literal, TypedDict

from dataclasses import dataclass

# region Types

EnvironmentType: TypeAlias = Literal["uniform", "2d"]


class EnvCreatePayload(TypedDict):
    id: str
    type: EnvironmentType


class EnvDeletePayload(TypedDict):
    id: str


# endregion

# region Models


@dataclass(slots=True)
class EnvironmentBinding:
    env_id: str
    env_type: EnvironmentType

    def build_create_payload(self) -> EnvCreatePayload:
        return EnvCreatePayload(
            id=self.env_id,
            type=self.env_type,
        )

    def build_delete_payload(self) -> EnvDeletePayload:
        return EnvDeletePayload(id=self.env_id)


# endregion
