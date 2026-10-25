"""Public decorator exports must resolve to callables in CLI and editor checks."""

from typing_extensions import assert_type

from tensnap import (
    action as root_action,
    chart as root_chart,
    edge,
    monitor as root_monitor,
    trajectory_item,
)
from tensnap.bindings import BindParametersConfig, action, chart, monitor, param, params
from tensnap.bindings.mesa import prepare_mesa_model_reinit
from tensnap.bindings.mesa.utils import Cell, CellAgent, OrthogonalMooreGrid
from tensnap.models import Parameter


def prepare_mesa_model(model: object) -> None:
    assert_type(prepare_mesa_model_reinit(model), None)


def cell_space_types(grid: OrthogonalMooreGrid, agent: CellAgent) -> Cell:
    assert_type(grid[(0, 0)], Cell)
    assert_type(agent.cell.coordinate, tuple[int, ...])
    return agent.cell


def advance() -> bool:
    return True


def population() -> int:
    return 3


def status() -> dict[str, bool]:
    return {"ready": True}


assert_type(action("advance")(advance)(), bool)
assert_type(root_action("advance")(advance)(), bool)
chart("population")(population)
root_chart("population")(population)
monitor("status")(status)
root_monitor("status")(status)

assert_type(params(include_private=None), BindParametersConfig)
assert_type(param("number", min=0, max=10).metadata, Parameter)
assert_type(param("enum", options=lambda: ["a", "b"]).metadata, Parameter)

edge(data="details")
edge(data=lambda item: {"tick": item.tick})

trajectory_item(data="details")
