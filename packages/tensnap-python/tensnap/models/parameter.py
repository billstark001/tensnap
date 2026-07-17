from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, TypeAlias

from typing_extensions import NotRequired, TypedDict

from tensnap.utils.object import infer_label_from_id

ParameterType: TypeAlias = Literal["number", "enum", "boolean", "string"]


class ParameterState(TypedDict):
    """Parameter state for communication"""

    id: str
    type: ParameterType
    label: str
    allow_runtime_change: bool

    value: NotRequired[Any]  # last value cached by the renderer
    min: NotRequired[float]
    max: NotRequired[float]
    step: NotRequired[float]
    options: NotRequired[list[str]]
    labels: NotRequired[dict[str, str]]


# region Parameter Classes


@dataclass
class ParameterBinding:
    id: str
    type: ParameterType
    label: str = ""
    allow_runtime_change: bool = True

    setter: Callable[..., Any] | None = None
    getter: Callable[..., Any] | None = None

    def refresh_label(self) -> None:
        if not self.label:
            self.label = infer_label_from_id(self.id)

    def __post_init__(self) -> None:
        self.refresh_label()

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for communication without getter/setter."""
        d = asdict(self)
        d.pop("setter", None)
        d.pop("getter", None)
        # A v0.3 binding emits canonical snake_case only.  In particular, do
        # not leak dataclass ``None`` values: protocol optional fields must be
        # omitted rather than encoded as JSON null.
        return {key: value for key, value in d.items() if value is not None}

    def instantiate(
        self,
        getter: Callable[..., Any] | None = None,
        setter: Callable[..., Any] | None = None,
    ) -> "Parameter":
        ret = create_parameter(**asdict(self))
        ret.getter = getter
        ret.setter = setter
        return ret

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ParameterBinding":
        """Deserialize from dict"""
        return cls(**data)


@dataclass
class NumberParameter(ParameterBinding):
    type: ParameterType = "number"
    value: float = 0.0
    min: float = 0.0
    max: float = 100.0
    step: float = 1.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "NumberParameter":
        return cls(**data)


@dataclass
class EnumParameter(ParameterBinding):
    type: ParameterType = "enum"
    value: str = ""
    options: list[str] = field(default_factory=list)
    labels: dict[str, str] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EnumParameter":
        return cls(**data)


@dataclass
class BooleanParameter(ParameterBinding):
    type: ParameterType = "boolean"
    value: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BooleanParameter":
        return cls(**data)


@dataclass
class StringParameter(ParameterBinding):
    type: ParameterType = "string"
    value: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StringParameter":
        return cls(**data)


Parameter: TypeAlias = (
    NumberParameter | EnumParameter | BooleanParameter | StringParameter
)


def create_parameter(
    id: str,
    type: ParameterType,
    label: str | None = None,
    value: float | str | None = None,
    min: float | None = None,
    max: float | None = None,
    step: float | None = None,
    options: list[str] | None = None,
    labels: dict[str, str] | None = None,
    setter: Callable[..., Any] | None = None,
    getter: Callable[..., Any] | None = None,
    allow_runtime_change: bool = True,
) -> Parameter:
    """Create a parameter object based on the provided dictionary data."""

    common_data = {
        "id": id,
        "label": label or "",
        "allow_runtime_change": allow_runtime_change,
        "setter": setter,
        "getter": getter,
    }

    if type == "number":
        return NumberParameter.from_dict(
            {
                **common_data,
                "value": value if value is not None else 0.0,
                "min": min,
                "max": max,
                "step": step,
            }
        )
    elif type == "enum":
        return EnumParameter.from_dict(
            {
                **common_data,
                "value": str(value) if value is not None else "",
                "options": options or [],
                "labels": labels,
            }
        )
    elif type == "boolean":
        return BooleanParameter.from_dict(
            {
                **common_data,
                "value": bool(value) if value is not None else False,
            }
        )
    elif type == "string":
        return StringParameter.from_dict(
            {
                **common_data,
                "value": str(value) if value is not None else "",
            }
        )
    else:
        raise ValueError(f"Unknown parameter type: {type}")


# endregion
