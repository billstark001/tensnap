from unittest.mock import AsyncMock

import pytest

import tensnap.bindings as binding_api
from tensnap import SimulationScenario
from tensnap.bindings import chart
from tensnap.server import ServerToClientMessageType as MT


def test_chart_property_group_keeps_properties_readable_and_registers_one_group():
    class Model:
        def __init__(self):
            self.alive_count_value = 4
            self.evacuated_count_value = 2
            self.dead_count_value = 1

        @chart("alive", "Evacuation Counts", color="#F59E0B")
        @property
        def alive_count(self) -> int:
            return self.alive_count_value

        @alive_count.group("evacuated", "Evacuated", color="#16A34A")
        @property
        def evacuated_count(self) -> int:
            return self.evacuated_count_value

        @alive_count.group("dead", "Dead", color="#9CA3AF")
        @property
        def dead_count(self) -> int:
            return self.dead_count_value

    model = Model()

    assert model.alive_count == 4
    assert model.evacuated_count == 2
    assert model.dead_count == 1

    discovered = binding_api.charts(model)

    assert len(discovered) == 1
    name, getter, metadata = discovered[0]
    assert name == "alive_count"
    assert getter() == {"alive": 4, "evacuated": 2, "dead": 1}
    assert metadata.id == "alive"
    assert metadata.label == "Evacuation Counts"
    assert metadata.data_list is not None
    assert [series.id for series in metadata.data_list] == [
        "alive",
        "evacuated",
        "dead",
    ]
    assert [series.label for series in metadata.data_list] == [
        "Alive",
        "Evacuated",
        "Dead",
    ]


@pytest.mark.asyncio
async def test_scenario_broadcasts_all_grouped_chart_series():
    class Model:
        def __init__(self):
            self.alive_count_value = 3
            self.evacuated_count_value = 1

        @chart("alive", "Evacuation Counts", color="#F59E0B")
        @property
        def alive_count(self) -> int:
            return self.alive_count_value

        @alive_count.group("evacuated", "Evacuated", color="#16A34A")
        @property
        def evacuated_count(self) -> int:
            return self.evacuated_count_value

    scenario = SimulationScenario()
    scenario.server.broadcast = AsyncMock()
    changes = scenario.add_charts(Model())

    assert changes == {"charts": ["alive"]}

    await scenario.broadcast_charts(step=7)

    scenario.server.broadcast.assert_awaited_once()
    await_args = scenario.server.broadcast.await_args
    assert await_args is not None
    message_type, payload = await_args.args
    assert message_type == MT.CHART_UPDATE
    assert payload == {
        "updates": [
            {"id": "alive", "value": 3, "time": 7},
            {"id": "evacuated", "value": 1, "time": 7},
        ]
    }


def test_chart_property_group_rejects_duplicate_series_ids():
    with pytest.raises(ValueError, match="Duplicate chart series id"):

        class BadModel:
            @chart("alive", "Evacuation Counts", color="#F59E0B")
            @property
            def alive_count(self) -> int:
                return 1

            @alive_count.group("alive", "Alive Again", color="#16A34A")
            @property
            def duplicate_alive_count(self) -> int:
                return 2


def test_existing_data_list_grouped_chart_still_discovers_one_chart():
    class Model:
        @chart(
            "counts",
            "Counts",
            data_list=[
                ("alive", "#F59E0B", "Alive"),
                ("evacuated", "#16A34A", "Evacuated"),
            ],
        )
        def counts(self):
            return {"alive": 5, "evacuated": 2}

    discovered = binding_api.charts(Model())

    assert len(discovered) == 1
    _, getter, metadata = discovered[0]
    assert getter() == {"alive": 5, "evacuated": 2}
    assert metadata.id == "counts"
    assert metadata.data_list is not None
    assert [series.id for series in metadata.data_list] == ["alive", "evacuated"]


def test_chart_infers_id_and_supports_both_property_decorator_orders():
    class Model:
        def __init__(self):
            self.population_value = 11
            self.alive_value = 7
            self.evacuated_value = 2

        @chart()
        def get_population(self):
            return self.population_value

        @chart()
        @property
        def alive_count(self) -> int:
            return self.alive_value

        @property
        @chart()
        def get_evacuated_count(self) -> int:
            return self.evacuated_value

    model = Model()
    discovered = {metadata.id: getter for _, getter, metadata in binding_api.charts(model)}

    assert model.alive_count == 7
    assert model.get_evacuated_count == 2
    assert set(discovered) == {"population", "alive_count", "evacuated_count"}
    assert discovered["population"]() == 11
    assert discovered["alive_count"]() == 7
    assert discovered["evacuated_count"]() == 2


def test_model_metadata_exports_are_available_from_new_and_compat_paths():
    import tensnap.bindings as bindings_module
    import tensnap.bindings.basic as basic_bindings
    import tensnap.models as model_types

    assert model_types.ChartGroupMetadata is not None
    assert model_types.ActionMetadata is not None

    with pytest.warns(
        DeprecationWarning, match="import ChartGroupMetadata from tensnap.models"
    ):
        assert basic_bindings.ChartGroupMetadata is model_types.ChartGroupMetadata

    with pytest.warns(
        DeprecationWarning, match="import ActionMetadata from tensnap.models"
    ):
        assert basic_bindings.ActionMetadata is model_types.ActionMetadata

    with pytest.warns(
        DeprecationWarning, match="import ChartGroupMetadata from tensnap.models"
    ):
        assert bindings_module.ChartGroupMetadata is model_types.ChartGroupMetadata

    with pytest.warns(
        DeprecationWarning, match="import ActionMetadata from tensnap.models"
    ):
        assert bindings_module.ActionMetadata is model_types.ActionMetadata
