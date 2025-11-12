# tensnap/bindings/mesa/datacollector.py
"""Utility functions for working with Mesa 3 DataCollector"""

from typing import cast, TYPE_CHECKING, Any, List, Type, Dict, Set

from tensnap.bindings.basic.chart import (
    ChartGroupMetadata,
    ChartMetadata,
    ChartProperty,
)

if TYPE_CHECKING:
    from mesa import DataCollector, Model


def get_registered_collectors(datacollector: "DataCollector") -> list[str]:
    """
    Get a list of all registered collector names in the DataCollector.

    Args:
        datacollector: Mesa DataCollector instance

    Returns:
        List of collector names (both model and agent reporters)
    """
    collectors = []

    # Get model reporters
    if hasattr(datacollector, "model_reporters"):
        collectors.extend(datacollector.model_reporters.keys())

    return collectors


def get_registered_agent_collectors(datacollector: "DataCollector") -> list[str]:
    """
    Get a list of all registered agent collector names in the DataCollector.

    Args:
        datacollector: Mesa DataCollector instance

    Returns:
        List of agent collector names
    """
    collectors = []

    # Get agent reporters
    if hasattr(datacollector, "agent_reporters"):
        collectors.extend(datacollector.agent_reporters.keys())

    return collectors


def make_latest_data_accessor(
    reporter_keys: list[str],
    datacollector_key: str = "datacollector",
):
    _closure_datacollector_key = datacollector_key
    _closure_reporter_keys = reporter_keys.copy()

    if len(_closure_reporter_keys) == 1:
        key = _closure_reporter_keys[0]

        def f_single(self: "Model") -> Any:
            dc: "DataCollector" = cast(
                "DataCollector", getattr(self, _closure_datacollector_key)
            )
            values = dc.model_vars.get(key, None)
            if values:
                return values[-1]

            return None

        return f_single

    def f(self: "Model") -> Dict[str, Any]:
        dc: "DataCollector" = cast(
            "DataCollector", getattr(self, _closure_datacollector_key)
        )
        result: Dict[str, Any] = {}
        for key in _closure_reporter_keys:
            values = dc.model_vars.get(key, None)
            if values:
                result[key] = values[-1]
            else:
                result[key] = None
        return result

    return f


def _guess_name(id: str) -> str:
    return id.replace("_", " ").replace("-", " ").title().strip()


def _guess_id(name: str) -> str:
    return name.replace(" ", "_").replace("-", "_").lower()


class BindDataCollectorConfig:

    def __init__(
        self,
        collector_key: str = "datacollector",
        model_reporters: bool | List[str] = True,
        agent_reporters: bool | List[str] = False,
        groups: bool | Dict[str, List[str]] = False,
    ):
        self.collector_key = collector_key
        self.model_reporters = model_reporters
        self.agent_reporters = agent_reporters  # TODO this is unimplemented
        self.groups = groups
        self.bound_class: "Type[Model] | None" = None
        self.func_injected = False

    def __call__(self, cls):
        cast(Any, cls)._tensnap_bind_datacollector_config = self
        self.bound_class = cls
        return cls

    def inject_func(self, instance) -> None:

        if self.bound_class is None or not isinstance(instance, self.bound_class):
            raise TypeError("Instance is not of the bound class type")

        if self.func_injected:
            return

        if not hasattr(instance, self.collector_key):
            raise AttributeError(
                f"Instance does not have attribute '{self.collector_key}'"
            )

        model_reporters: List[str]
        if isinstance(self.model_reporters, list):
            model_reporters = self.model_reporters.copy()
        elif self.model_reporters is True:
            model_reporters = get_registered_collectors(
                getattr(instance, self.collector_key)
            )
        else:
            model_reporters = []

        if not model_reporters:
            # No model reporters to bind
            self.func_injected = True
            return

        # Determine groups
        model_groups: Dict[str, List[str]] = {}
        if self.groups is True:
            # Auto-generate groups based on reporter name prefixes
            model_groups["Model Parameters"] = model_reporters
        elif isinstance(self.groups, dict):
            reverse_groups: Dict[str, str] = {}
            if isinstance(self.groups, dict):
                for group_name, reporters in self.groups.items():
                    for reporter in reporters:
                        reverse_groups[reporter] = group_name
            for reporter in model_reporters:
                if reporter in reverse_groups:
                    group_name = reverse_groups[reporter]
                else:
                    group_name = _guess_name(reporter)
                if not group_name in model_groups:
                    model_groups[group_name] = []
                model_groups[group_name].append(reporter)
        else:
            for reporter in model_reporters:
                group_name = _guess_name(reporter)
                if group_name not in model_groups:
                    model_groups[group_name] = []
                model_groups[group_name].append(reporter)

        # Inject accessor functions
        func_id = 0
        for group_name, reporters in model_groups.items():
            func = make_latest_data_accessor(
                reporter_keys=reporters,
                datacollector_key=self.collector_key,
            )
            chart_group_metadata = ChartGroupMetadata(
                id=_guess_id(group_name),
                label=group_name,
                data_list=[
                    ChartMetadata(
                        id=_guess_id(field),
                        label=field,
                    )
                    for field in reporters
                ],
            )
            func._tensnap_chart = chart_group_metadata
            chart_property = ChartProperty(chart_group_metadata, func)

            func_name = f"get_tensnap_chart_data_{func_id}"
            setattr(self.bound_class, func_name, chart_property)
            func_id += 1

        self.func_injected = True


# name alias
bind_datacollector = BindDataCollectorConfig
