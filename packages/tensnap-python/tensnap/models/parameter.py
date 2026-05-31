from typing import (
    Any,
    Callable,
    Optional,
    List,
    Union,
    Literal,
    Dict,
    TypeAlias,
)
from typing_extensions import NotRequired, TypedDict

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


from dataclasses import dataclass, asdict, field

# region Parameter Classes


@dataclass
class ParameterBinding:
    id: str
    type: ParameterType
    label: str = ""
    allow_runtime_change: bool = True

    setter: Optional[Callable] = None
    getter: Optional[Callable] = None

    def refresh_label(self):
        if not self.label:
            self.label = self.id.replace("_", " ").title().strip()

    def __post_init__(self):
        self.refresh_label()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict for communication. Note that getter/setter are not included."""
        d = asdict(self)
        if "setter" in d:
            del d["setter"]
        if "getter" in d:
            del d["getter"]
        if "allow_runtime_change" in d:
            val = d["allow_runtime_change"]
            del d["allow_runtime_change"]
            d["allowRuntimeChange"] = val
        return d

    def instantiate(
        self, getter: Callable | None = None, setter: Callable | None = None
    ) -> "Parameter":
        ret = create_parameter(**asdict(self))
        ret.getter = getter
        ret.setter = setter
        return ret

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
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
    def from_dict(cls, data: Dict[str, Any]) -> "NumberParameter":
        return cls(**data)


@dataclass
class EnumParameter(ParameterBinding):
    type: ParameterType = "enum"
    value: str = ""
    options: List[str] = field(default_factory=list)
    labels: Optional[Dict[str, str]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EnumParameter":
        return cls(**data)


@dataclass
class BooleanParameter(ParameterBinding):
    type: ParameterType = "boolean"
    value: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BooleanParameter":
        return cls(**data)


@dataclass
class StringParameter(ParameterBinding):
    type: ParameterType = "string"
    value: str = ""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StringParameter":
        return cls(**data)


Parameter: TypeAlias = Union[
    NumberParameter, EnumParameter, BooleanParameter, StringParameter
]


def create_parameter(
    id: str,
    type: ParameterType,
    label: Optional[str] = None,
    value: Optional[Union[float, str]] = None,
    min: Optional[float] = None,
    max: Optional[float] = None,
    step: Optional[float] = None,
    options: Optional[List[str]] = None,
    labels: Optional[Dict[str, str]] = None,
    setter: Optional[Callable] = None,
    getter: Optional[Callable] = None,
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
