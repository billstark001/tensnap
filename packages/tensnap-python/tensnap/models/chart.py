"""Chart metadata models and grouped chart descriptors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional, Union, cast

from typing_extensions import NotRequired, TypedDict

from tensnap.utils.object import infer_id_from_func_name, infer_label_from_id

_TENSNAP_CHART_FIELD = "_tensnap_chart"


@dataclass
class ChartMetadata:
    """Metadata for one chart series."""

    id: str
    label: str = ""
    color: Optional[str] = None

    def refresh_label(self) -> None:
        if not self.label:
            self.label = infer_label_from_id(self.id)

    def to_dict(self) -> dict[str, Any]:
        data = {
            "id": self.id,
            "label": self.label,
        }
        if self.color is not None:
            data["color"] = self.color
        return data


@dataclass
class ChartGroupMetadata(ChartMetadata):
    """Metadata for a chart group."""

    data_list: list[ChartMetadata] | None = None

    def to_dict(self) -> dict[str, Any]:
        data = super().to_dict()
        data["dataList"] = (
            [chart.to_dict() for chart in self.data_list] if self.data_list else None
        )
        return data


class ChartMetadataDict(TypedDict):
    id: str
    label: NotRequired[str]
    color: NotRequired[str]


class ChartGroupMetadataDict(ChartMetadataDict):
    dataList: NotRequired[list[ChartMetadataDict]]


SimplifiedChartMetadata = Union[
    str,
    tuple[str, str],
    tuple[str, str, str],
    ChartMetadataDict,
]


class ChartProperty:
    """Chart descriptor that can behave like a read-only property."""

    def __init__(
        self,
        chart: ChartGroupMetadata,
        getter: Any,
        *,
        group_owner: "ChartProperty | None" = None,
    ) -> None:
        self.chart = chart
        setattr(self, _TENSNAP_CHART_FIELD, chart)

        self._property = getter if isinstance(getter, property) else None
        raw_getter = getter.fget if isinstance(getter, property) else getter
        if raw_getter is None:
            raise ValueError("@chart cannot wrap a property without fget")
        self.getter: Callable[..., Any] = cast(Callable[..., Any], raw_getter)

        self._group_owner = group_owner
        self._group_members: list[ChartProperty] = []

        self.__name__ = getattr(self.getter, "__name__", chart.id)
        self.__doc__ = getattr(self.getter, "__doc__", None)

        if group_owner is not None:
            group_owner._attach_group_member(self)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.getter(*args, **kwargs)

    def __get__(self, obj: Any, objtype: Optional[type] = None) -> Any:
        if obj is None:
            return self
        return self.getter(obj)

    @property
    def group_owner(self) -> "ChartProperty | None":
        return self._group_owner

    def has_group_members(self) -> bool:
        return bool(self._group_members)

    def group(
        self,
        id: Optional[str] = None,
        label: Optional[str] = None,
        color: Optional[str] = None,
    ):
        if self._group_owner is not None:
            raise ValueError("Only a root ChartProperty can own grouped series.")
        if self.chart.data_list:
            raise ValueError(
                "ChartProperty.group() cannot extend a chart that already defines "
                "data_list. Use one grouping style per chart."
            )

        def decorator(member: Any) -> "ChartProperty":
            raw_getter = member.fget if isinstance(member, property) else member
            if raw_getter is None:
                raise ValueError("@chart group cannot wrap a property without fget")

            member_id = id or infer_id_from_func_name(raw_getter.__name__)
            member_chart = ChartGroupMetadata(
                id=member_id,
                label=label or "",
                color=color,
            )
            chart_property = ChartProperty(
                member_chart,
                member,
                group_owner=self,
            )

            try:
                setattr(member, _TENSNAP_CHART_FIELD, member_chart)
            except Exception:
                pass
            setattr(chart_property, _TENSNAP_CHART_FIELD, member_chart)
            return chart_property

        return decorator

    def grouped_value(self, obj: Any) -> Any:
        if not self._group_members:
            return self.getter(obj)

        result = {self._owner_series_metadata().id: self.getter(obj)}
        for member in self._group_members:
            result[member.chart.id] = member.getter(obj)
        return result

    def _attach_group_member(self, member: "ChartProperty") -> None:
        seen_ids = {self._owner_series_metadata().id}
        seen_ids.update(grouped.chart.id for grouped in self._group_members)
        if member.chart.id in seen_ids:
            raise ValueError(
                f"Duplicate chart series id {member.chart.id!r} in grouped chart "
                f"{self.chart.id!r}."
            )
        self._group_members.append(member)
        self.chart.data_list = [
            self._owner_series_metadata(),
            *(grouped._member_series_metadata() for grouped in self._group_members),
        ]

    def _owner_series_metadata(self) -> ChartMetadata:
        metadata = ChartMetadata(
            id=self.chart.id,
            color=self.chart.color,
        )
        metadata.refresh_label()
        return metadata

    def _member_series_metadata(self) -> ChartMetadata:
        metadata = ChartMetadata(
            id=self.chart.id,
            label=self.chart.label,
            color=self.chart.color,
        )
        metadata.refresh_label()
        return metadata
