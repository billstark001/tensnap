from __future__ import annotations

import linecache
import traceback
from dataclasses import dataclass
from typing import Any

import pytest

from tensnap.utils.attr import (
    make_attr_getter,
    make_attr_getter_and_setter,
    make_attr_projector,
    make_dict_getter_and_setter,
    make_dict_projector,
    make_raw_attr_projector,
    make_raw_dict_projector,
    validate_attr_path,
)

# region fixtures


@dataclass
class Position:
    x: int
    y: int


@dataclass
class Agent:
    name: str
    pos: Position
    items: list[Position]


# endregion


# region validation tests


def test_validate_attr_path_accepts_nested_paths() -> None:
    assert validate_attr_path("name")
    assert validate_attr_path("pos.x")
    assert validate_attr_path("items[0]")
    assert validate_attr_path("items[0].x")


def test_validate_attr_path_rejects_unsafe_paths() -> None:
    assert not validate_attr_path("class")
    assert not validate_attr_path("x.__dict__")
    assert not validate_attr_path("name; import os")
    assert not validate_attr_path("items[-1]")


# endregion


# region raw source tests


def test_raw_dict_projector_uses_custom_function_name() -> None:
    source = make_raw_dict_projector(
        ["name"],
        {"x": "pos.x"},
        {"kind": "agent"},
        function_name="project_agent_dict",
    )
    assert "def project_agent_dict(obj):" in source
    assert "# field: x, source: pos.x" in source


def test_raw_attr_projector_uses_custom_function_name() -> None:
    source = make_raw_attr_projector(
        ["name"],
        {"x": "pos.x"},
        {"kind": "agent"},
        function_name="project_agent_attr",
    )
    assert "def project_agent_attr(obj):" in source
    assert "obj.pos.x" in source


# endregion


# region projector behavior tests


def test_dict_projector_projects_nested_paths_and_defaults() -> None:
    obj: dict[str, Any] = {
        "name": "alice",
        "pos": {"x": 1, "y": 2},
        "items": [{"x": 10, "y": 20}],
    }
    projector = make_dict_projector(
        ["name", "items[0].x"],
        {"x": "pos.x"},
        {"kind": "agent"},
        function_name="project_agent_dict",
        filename="<test dict projector>",
    )

    assert projector(obj) == {
        "kind": "agent",
        "name": "alice",
        "items[0].x": 10,
        "x": 1,
    }


def test_attr_projector_projects_nested_paths_and_defaults() -> None:
    agent = Agent("alice", Position(1, 2), [Position(10, 20)])
    projector = make_attr_projector(
        ["name", "items[0].x"],
        {"x": "pos.x"},
        {"kind": "agent"},
        function_name="project_agent_attr",
        filename="<test attr projector>",
    )

    assert projector(agent) == {
        "kind": "agent",
        "name": "alice",
        "items[0].x": 10,
        "x": 1,
    }


def test_projector_factory_is_cached_for_same_signature() -> None:
    first = make_attr_projector(
        ["name"],
        function_name="project_cached_agent",
        filename="<test cached projector>",
    )
    second = make_attr_projector(
        ["name"],
        function_name="project_cached_agent",
        filename="<test cached projector>",
    )
    assert first is second


# endregion


# region traceback and linecache tests


def test_custom_filename_appears_in_traceback() -> None:
    agent = Agent("alice", Position(1, 2), [])
    projector = make_attr_projector(
        ["missing"],
        function_name="project_missing_attr",
        filename="<custom readable projector>",
    )

    with pytest.raises(AttributeError) as exc_info:
        projector(agent)

    rendered = "".join(
        traceback.format_exception(
            type(exc_info.value),
            exc_info.value,
            exc_info.value.__traceback__,
        )
    )
    assert "<custom readable projector>" in rendered
    assert "'missing': obj.missing" in rendered
    assert "# field: missing" in rendered


def test_generated_source_is_registered_in_linecache() -> None:
    filename = "<linecache projector>"
    make_dict_projector(
        ["name"],
        function_name="project_linecache_dict",
        filename=filename,
    )

    lines = linecache.getlines(filename)
    assert any("def project_linecache_dict(obj):" in line for line in lines)
    assert any("# field: name" in line for line in lines)


# endregion


# region getter and setter tests


def test_attr_getter_and_setter_work_unbound() -> None:
    agent = Agent("alice", Position(1, 2), [])
    getter, setter = make_attr_getter_and_setter(
        "pos.x",
        getter_function_name="read_x",
        setter_function_name="write_x",
        getter_filename="<getter x>",
        setter_filename="<setter x>",
    )

    assert getter(agent) == 1
    setter(agent, 42)
    assert agent.pos.x == 42
    assert getter.__name__ == "read_x"
    assert setter.__name__ == "write_x"


def test_attr_getter_works_bound() -> None:
    agent = Agent("alice", Position(1, 2), [])
    getter = make_attr_getter(
        "name",
        bind_target=agent,
        function_name="read_bound_name",
        filename="<bound name getter>",
    )

    assert getter() == "alice"  # type: ignore[call-arg]
    assert getter.__name__ == "read_bound_name"


def test_dict_getter_and_setter_support_quoted_keys() -> None:
    obj = {'a"b': 1}
    getter, setter = make_dict_getter_and_setter(
        'a"b',
        getter_function_name="read_quoted_key",
        setter_function_name="write_quoted_key",
        getter_filename="<quoted dict getter>",
        setter_filename="<quoted dict setter>",
    )

    assert getter(obj) == 1
    setter(obj, 7)
    assert obj['a"b'] == 7


# endregion


# region error tests


def test_invalid_function_name_is_rejected() -> None:
    with pytest.raises(ValueError, match="Invalid function name"):
        make_attr_projector(["name"], function_name="not-a-name")


def test_unhashable_default_value_is_rejected_for_cache_safety() -> None:
    with pytest.raises(TypeError, match="not hashable"):
        make_dict_projector(["name"], default_values={"tags": []})


# endregion
