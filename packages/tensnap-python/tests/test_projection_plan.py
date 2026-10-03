from __future__ import annotations

import ast

from tensnap.bindings.basic.agent_layers import map_agent_layer, matrix_agent_layer
from tensnap.bindings.basic.layer_utils import (
    ResolvedProjectorFieldSpec,
    attr,
    make_field_spec_projector,
    value,
)
from tensnap.utils.attr import make_attr_projector
from tensnap.utils.projection import ProjectionPlan


def test_inline_simple_lambda_and_preserve_method_call() -> None:
    class Model:
        def color(self, alive: bool) -> str:
            return "black" if alive else "white"

    plan = ProjectionPlan(("m", "row", "col", "alive"))
    plan.callable("color", lambda m, row, col, alive: m.color(alive))
    projector = plan.compile()
    assert projector.inline_diagnostics == {"color": "inlined"}
    assert projector(Model(), 0, 0, True) == {"color": "black"}


def test_external_binding_and_inner_scope_fall_back() -> None:
    shade = "black"
    plan = ProjectionPlan(("item",))
    plan.callable("color", lambda item: shade if item else "white")
    plan.callable("nested", lambda item: [x + item for x in range(2)])
    projector = plan.compile()
    assert (
        projector.inline_diagnostics["color"]
        == "closure binding requires a live lookup"
    )
    assert (
        projector.inline_diagnostics["nested"]
        == "expression has an inner scope or assignment"
    )
    shade = "green"
    assert projector(1) == {"color": "green", "nested": [1, 2]}


def test_literal_object_is_injected_without_repr() -> None:
    class Unrepresentable:
        def __repr__(self) -> str:
            return "this is not Python syntax"

    literal = Unrepresentable()
    projector = make_field_spec_projector(
        {
            "data": ResolvedProjectorFieldSpec("literal", literal),
        }
    )
    assert projector(object())["data"] is literal


def test_same_line_lambdas_use_positions_or_fall_back() -> None:
    first, second = (lambda item: item + 1), (lambda item: item + 2)
    plan = ProjectionPlan(("item",))
    plan.callable("first", first)
    plan.callable("second", second)
    projector = plan.compile()
    assert projector(3) == {"first": 4, "second": 5}
    assert set(projector.inline_diagnostics.values()) <= {
        "inlined",
        "lambda source is ambiguous",
    }
    if not hasattr(first.__code__, "co_positions"):
        assert projector.inline_diagnostics == {
            "first": "lambda source is ambiguous",
            "second": "lambda source is ambiguous",
        }


def test_hashable_nonliteral_default_uses_object_identity() -> None:
    class Value:
        def __repr__(self) -> str:
            return "not valid Python source"

    value = Value()
    projector = make_attr_projector([], default_values={"token": value})
    assert projector(object())["token"] is value


def test_unused_projection_local_is_not_evaluated() -> None:
    plan = ProjectionPlan(("value",))
    plan.local(
        "key",
        ast.Call(func=ast.Name(id="missing", ctx=ast.Load()), args=[], keywords=[]),
    )
    plan.expression("value", ast.Name(id="value", ctx=ast.Load()))
    assert plan.compile()(7) == {"value": 7}


def test_matrix_key_selector_and_callable_fallback_keep_key() -> None:
    prefix = "cell:"

    class Model:
        def __init__(self) -> None:
            self.cells = [[False], [True]]

    config = matrix_agent_layer(
        "cells",
        source="cells",
        fields={
            "cell": "key",
            "row": "row",
            "col": "col",
            "label": lambda _model, key, _value: prefix + str(key),
        },
    )
    projector = config._source_factory(Model).project
    assert projector(Model(), (1, 0), True) == {
        "cell": (1, 0),
        "row": 1,
        "col": 0,
        "label": "cell:(1, 0)",
        "icon": "square",
        "size": 1.0,
        "x": 0,
        "y": 0,
        "data": {"value": True},
    }
    prefix = "new:"
    assert projector(Model(), (0, 0), False)["label"] == "new:(0, 0)"


def test_source_fields_accept_literal_and_explicit_selector() -> None:
    class Model:
        def __init__(self) -> None:
            self.cells = [[True]]

    config = matrix_agent_layer(
        "cells",
        source="cells",
        fields={"color": value("black"), "heading": 0, "alive": attr("value")},
    )
    projector = config._source_factory(Model).project
    item = projector(Model(), (0, 0), True)
    assert (item["color"], item["heading"], item["alive"]) == ("black", 0, True)

    class MapModel:
        def __init__(self) -> None:
            self.flags = {"a": type("Flag", (), {"alive": True, "levels": [3]})()}

    map_model = MapModel()
    map_config = map_agent_layer(
        "flags", source="flags", fields={"alive": "alive", "level": "levels[0]"}
    )
    map_projector = map_config._source_factory(MapModel).project
    expected_level = 3
    projected = map_projector(map_model, "a", map_model.flags["a"])
    assert projected["level"] == expected_level
