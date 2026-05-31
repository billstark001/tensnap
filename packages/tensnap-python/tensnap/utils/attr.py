from __future__ import annotations

import keyword
import linecache
import re
import textwrap
from collections.abc import Callable, Hashable, Mapping
from functools import lru_cache
from types import FunctionType
from typing import Any, TypeAlias, TypeVar, cast

TObj = TypeVar("TObj")
T = TypeVar("T", bound=str)

AttrGetter: TypeAlias = Callable[[TObj], Any]
AttrSetter: TypeAlias = Callable[[TObj, Any], None]
AttrProjector: TypeAlias = Callable[[TObj], dict[T, Any]]
DictProjector: TypeAlias = AttrProjector[dict[str, Any], T]
AttrPathMap: TypeAlias = Mapping[T, str]

# region constants

# Supports: id, id.id, id[0], id.id[0], id[0].id, etc.
PYTHON_IDENTIFIER_PATTERN = re.compile(
    r"^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$"
)

SAFE_FUNCTION_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

_DEFAULT_PROJECTOR_FUNC_NAME = "f"
_DEFAULT_GETTER_PREFIX = "get"
_DEFAULT_SETTER_PREFIX = "set"
_DEFAULT_CACHE_SIZE = 4096

# endregion


# region validation


def validate_attr_path(attr_path: str) -> bool:
    """Return whether *attr_path* is a safe dotted / indexed Python path."""
    if not isinstance(attr_path, str):
        return False
    if not PYTHON_IDENTIFIER_PATTERN.match(attr_path):
        return False

    # Validate every identifier segment, not just the first one. This rejects
    # paths such as ``x.class`` and blocks dunder traversal like ``x.__dict__``.
    identifiers = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", attr_path)
    for identifier in identifiers:
        if keyword.iskeyword(identifier):
            return False
        if identifier.startswith("__") and identifier.endswith("__"):
            return False
    return True


def _validate_attr_path_or_raise(attr_path: str, label: str) -> None:
    if not validate_attr_path(attr_path):
        raise ValueError(
            f"Invalid {label}: {attr_path!r}. "
            "Expected a safe Python identifier path such as 'name', 'pos.x', "
            "'items[0]', or 'items[0].value'."
        )


def _validate_function_name_or_raise(function_name: str) -> None:
    if not SAFE_FUNCTION_NAME_PATTERN.match(function_name):
        raise ValueError(
            f"Invalid function name: {function_name!r}. "
            "Expected a valid Python identifier."
        )
    if keyword.iskeyword(function_name):
        raise ValueError(f"Invalid function name: {function_name!r}; it is a keyword.")


def _safe_func_suffix(name: str) -> str:
    """Create a stable, readable identifier suffix from a user supplied path/key."""
    suffix = re.sub(r"\W+", "_", name).strip("_")
    if not suffix:
        suffix = "field"
    if suffix[0].isdigit():
        suffix = f"_{suffix}"
    return suffix


# endregion


# region source installation and compilation


def _install_generated_source(filename: str, source: str) -> None:
    """Register generated source in linecache so tracebacks show useful code."""
    lines = source.splitlines(keepends=True)
    linecache.cache[filename] = (len(source), None, lines, filename)


def _compile_function(
    source: str,
    *,
    function_name: str,
    filename: str,
    globals_ns: dict[str, Any] | None = None,
) -> FunctionType:
    """Compile generated source and return the named function.

    The compiled code is registered in ``linecache`` before execution. This keeps
    runtime tracebacks fast and readable without wrapping the generated function.
    """
    _validate_function_name_or_raise(function_name)

    normalized_source = textwrap.dedent(source).lstrip()
    _install_generated_source(filename, normalized_source)

    ns: dict[str, Any] = {} if globals_ns is None else dict(globals_ns)
    try:
        code = compile(normalized_source, filename, "exec")
        exec(code, ns)
    except SyntaxError as exc:
        pointer = ""
        if exc.offset is not None:
            pointer = f"\n{' ' * max(exc.offset - 1, 0)}^"
        line_text = exc.text.rstrip() if exc.text else ""
        raise ValueError(
            f"Failed to compile generated function {function_name!r} "
            f"from {filename!r}.\nLine {exc.lineno}: {line_text}{pointer}"
        ) from exc

    func = ns.get(function_name)
    if not isinstance(func, FunctionType):
        raise ValueError(
            f"Generated source did not define function {function_name!r} "
            f"from {filename!r}."
        )
    return func


def _default_filename(kind: str, function_name: str, signature: str) -> str:
    return f"<generated {kind} {function_name} {signature}>"


# endregion


# region path conversion


def _attr_path_to_dict_access(attr_path: str) -> str:
    """Convert ``a.b[0]`` into ``[\"a\"][\"b\"][0]``."""
    parts: list[str] = []
    current = ""
    i = 0

    while i < len(attr_path):
        ch = attr_path[i]
        if ch == ".":
            if current:
                parts.append(f"[{current!r}]")
                current = ""
            i += 1
        elif ch == "[":
            if current:
                parts.append(f"[{current!r}]")
                current = ""
            j = attr_path.index("]", i)
            parts.append(attr_path[i : j + 1])
            i = j + 1
        else:
            current += ch
            i += 1

    if current:
        parts.append(f"[{current!r}]")
    return "".join(parts)


# endregion


# region cache key helpers


def _freeze_str_mapping(
    mapping: Mapping[str, str] | None,
) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((mapping or {}).items()))


def _freeze_default_values(
    default_values: Mapping[str, Any] | None,
) -> tuple[tuple[str, Any], ...]:
    """Freeze default values for cache keys.

    Values must be hashable to be safely cached. This avoids relying on ``repr``
    for semantic identity and keeps cache behavior predictable.
    """
    frozen: list[tuple[str, Any]] = []
    for key, value in (default_values or {}).items():
        if not isinstance(value, Hashable):
            raise TypeError(
                f"Default value for {key!r} is not hashable and cannot be cached: "
                f"{type(value).__name__}"
            )
        frozen.append((key, value))
    return tuple(sorted(frozen))


# endregion


# region projector source builders


def _validate_projector_inputs(
    fields: tuple[str, ...],
    field_mapping: tuple[tuple[str, str], ...],
    default_values: tuple[tuple[str, Any], ...],
) -> None:
    for field in fields:
        _validate_attr_path_or_raise(field, "field name")

    for field, mapped_field in field_mapping:
        _validate_attr_path_or_raise(field, "mapped output field name")
        _validate_attr_path_or_raise(mapped_field, "mapped source field name")

    for field, _ in default_values:
        _validate_attr_path_or_raise(field, "default value field name")


def make_raw_dict_projector(
    fields: list[T],
    field_mapping: AttrPathMap[T],
    default_values: Mapping[T, Any],
    *,
    function_name: str = _DEFAULT_PROJECTOR_FUNC_NAME,
) -> str:
    """Build source for a dictionary projector."""
    _validate_function_name_or_raise(function_name)
    frozen_fields = tuple(cast(tuple[str, ...], tuple(fields)))
    frozen_mapping = _freeze_str_mapping(cast(Mapping[str, str], field_mapping))
    frozen_defaults = _freeze_default_values(cast(Mapping[str, Any], default_values))
    _validate_projector_inputs(frozen_fields, frozen_mapping, frozen_defaults)

    lines = [f"def {function_name}(obj):\n", "    return {\n"]
    for field, value in frozen_defaults:
        lines.append(f"        {field!r}: {value!r},  # default: {field}\n")
    for field in frozen_fields:
        access = _attr_path_to_dict_access(field)
        lines.append(f"        {field!r}: obj{access},  # field: {field}\n")
    for field, mapped_field in frozen_mapping:
        access = _attr_path_to_dict_access(mapped_field)
        lines.append(
            f"        {field!r}: obj{access},  # field: {field}, source: {mapped_field}\n"
        )
    lines.append("    }\n")
    return "".join(lines)


def make_raw_attr_projector(
    fields: list[T],
    field_mapping: AttrPathMap[T],
    default_values: Mapping[T, Any],
    *,
    function_name: str = _DEFAULT_PROJECTOR_FUNC_NAME,
) -> str:
    """Build source for an attribute projector."""
    _validate_function_name_or_raise(function_name)
    frozen_fields = tuple(cast(tuple[str, ...], tuple(fields)))
    frozen_mapping = _freeze_str_mapping(cast(Mapping[str, str], field_mapping))
    frozen_defaults = _freeze_default_values(cast(Mapping[str, Any], default_values))
    _validate_projector_inputs(frozen_fields, frozen_mapping, frozen_defaults)

    lines = [f"def {function_name}(obj):\n", "    return {\n"]
    for field, value in frozen_defaults:
        lines.append(f"        {field!r}: {value!r},  # default: {field}\n")
    for field in frozen_fields:
        lines.append(f"        {field!r}: obj.{field},  # field: {field}\n")
    for field, mapped_field in frozen_mapping:
        lines.append(
            f"        {field!r}: obj.{mapped_field},  # field: {field}, source: {mapped_field}\n"
        )
    lines.append("    }\n")
    return "".join(lines)


# endregion


# region projector factories


@lru_cache(maxsize=_DEFAULT_CACHE_SIZE)
def _make_dict_projector_cached(
    fields: tuple[str, ...],
    field_mapping: tuple[tuple[str, str], ...],
    default_values: tuple[tuple[str, Any], ...],
    function_name: str,
    filename: str,
) -> FunctionType:
    source = make_raw_dict_projector(
        list(fields),
        dict(field_mapping),
        dict(default_values),
        function_name=function_name,
    )
    return _compile_function(source, function_name=function_name, filename=filename)


@lru_cache(maxsize=_DEFAULT_CACHE_SIZE)
def _make_attr_projector_cached(
    fields: tuple[str, ...],
    field_mapping: tuple[tuple[str, str], ...],
    default_values: tuple[tuple[str, Any], ...],
    function_name: str,
    filename: str,
) -> FunctionType:
    source = make_raw_attr_projector(
        list(fields),
        dict(field_mapping),
        dict(default_values),
        function_name=function_name,
    )
    return _compile_function(source, function_name=function_name, filename=filename)


def make_dict_projector(
    fields: list[T],
    field_mapping: AttrPathMap[T] | None = None,
    default_values: Mapping[T, Any] | None = None,
    *,
    filename: str | None = None,
    function_name: str = _DEFAULT_PROJECTOR_FUNC_NAME,
) -> Callable[[Mapping[str, Any]], dict[T, Any]]:
    """Create a cached projector for dictionaries.

    ``filename`` is used by traceback and ``linecache``. ``function_name`` is the
    compiled Python function name, useful for profiling and traceback grouping.
    """
    frozen_fields = tuple(cast(tuple[str, ...], tuple(fields)))
    frozen_mapping = _freeze_str_mapping(cast(Mapping[str, str] | None, field_mapping))
    frozen_defaults = _freeze_default_values(
        cast(Mapping[str, Any] | None, default_values)
    )
    actual_filename = filename or _default_filename(
        "dict_projector", function_name, repr((frozen_fields, frozen_mapping))
    )
    func = _make_dict_projector_cached(
        frozen_fields,
        frozen_mapping,
        frozen_defaults,
        function_name,
        actual_filename,
    )
    return cast(Callable[[Mapping[str, Any]], dict[T, Any]], func)


def make_attr_projector(
    fields: list[T],
    field_mapping: AttrPathMap[T] | None = None,
    default_values: Mapping[T, Any] | None = None,
    *,
    filename: str | None = None,
    function_name: str = _DEFAULT_PROJECTOR_FUNC_NAME,
) -> Callable[[TObj], dict[T, Any]]:  # type: ignore
    """Create a cached projector for object attributes."""
    frozen_fields = tuple(cast(tuple[str, ...], tuple(fields)))
    frozen_mapping = _freeze_str_mapping(cast(Mapping[str, str] | None, field_mapping))
    frozen_defaults = _freeze_default_values(
        cast(Mapping[str, Any] | None, default_values)
    )
    actual_filename = filename or _default_filename(
        "attr_projector", function_name, repr((frozen_fields, frozen_mapping))
    )
    func = _make_attr_projector_cached(
        frozen_fields,
        frozen_mapping,
        frozen_defaults,
        function_name,
        actual_filename,
    )
    return cast(Callable[[TObj], dict[T, Any]], func)


# endregion


# region attribute getter and setter


@lru_cache(maxsize=_DEFAULT_CACHE_SIZE)
def _make_unbound_attr_getter_cached(
    attr_path: str,
    function_name: str,
    filename: str,
) -> FunctionType:
    _validate_attr_path_or_raise(attr_path, "attribute path")
    source = f"""
    def {function_name}(obj):
        return obj.{attr_path}  # attr_path: {attr_path}
    """
    return _compile_function(source, function_name=function_name, filename=filename)


@lru_cache(maxsize=_DEFAULT_CACHE_SIZE)
def _make_unbound_attr_setter_cached(
    attr_path: str,
    function_name: str,
    filename: str,
) -> FunctionType:
    _validate_attr_path_or_raise(attr_path, "attribute path")
    source = f"""
    def {function_name}(obj, value):
        obj.{attr_path} = value  # attr_path: {attr_path}
    """
    return _compile_function(source, function_name=function_name, filename=filename)


def make_attr_getter(
    attr_path: str,
    bind_target: TObj | None = None,
    *,
    filename: str | None = None,
    function_name: str | None = None,
) -> AttrGetter[TObj]:
    """Create a cached attribute getter.

    Bound getters close over ``bind_target`` after compiling an unbound getter, so
    generated code stays cacheable while calls remain straightforward.
    """
    suffix = _safe_func_suffix(attr_path)
    actual_function_name = function_name or f"{_DEFAULT_GETTER_PREFIX}_{suffix}"
    actual_filename = filename or _default_filename(
        "attr_getter", actual_function_name, repr(attr_path)
    )
    getter = _make_unbound_attr_getter_cached(
        attr_path,
        actual_function_name,
        actual_filename,
    )

    if bind_target is None:
        return cast(AttrGetter[TObj], getter)

    def bound_getter() -> Any:
        return getter(bind_target)

    bound_getter.__name__ = actual_function_name
    bound_getter.__qualname__ = actual_function_name
    return cast(AttrGetter[TObj], bound_getter)


def make_attr_getter_and_setter(
    attr_path: str,
    bind_target: TObj | None = None,
    *,
    getter_filename: str | None = None,
    setter_filename: str | None = None,
    getter_function_name: str | None = None,
    setter_function_name: str | None = None,
) -> tuple[AttrGetter[TObj], AttrSetter[TObj]]:
    """Create cached attribute getter and setter functions."""
    suffix = _safe_func_suffix(attr_path)
    actual_getter_name = getter_function_name or f"{_DEFAULT_GETTER_PREFIX}_{suffix}"
    actual_setter_name = setter_function_name or f"{_DEFAULT_SETTER_PREFIX}_{suffix}"
    actual_getter_filename = getter_filename or _default_filename(
        "attr_getter", actual_getter_name, repr(attr_path)
    )
    actual_setter_filename = setter_filename or _default_filename(
        "attr_setter", actual_setter_name, repr(attr_path)
    )

    getter = _make_unbound_attr_getter_cached(
        attr_path,
        actual_getter_name,
        actual_getter_filename,
    )
    setter = _make_unbound_attr_setter_cached(
        attr_path,
        actual_setter_name,
        actual_setter_filename,
    )

    if bind_target is None:
        return cast(AttrGetter[TObj], getter), cast(AttrSetter[TObj], setter)

    def bound_getter() -> Any:
        return getter(bind_target)

    def bound_setter(value: Any) -> None:
        setter(bind_target, value)

    bound_getter.__name__ = actual_getter_name
    bound_getter.__qualname__ = actual_getter_name
    bound_setter.__name__ = actual_setter_name
    bound_setter.__qualname__ = actual_setter_name
    return cast(AttrGetter[TObj], bound_getter), cast(AttrSetter[TObj], bound_setter)


# endregion


# region dictionary getter and setter


@lru_cache(maxsize=_DEFAULT_CACHE_SIZE)
def _make_unbound_dict_getter_cached(
    field_name: str,
    function_name: str,
    filename: str,
) -> FunctionType:
    source = f"""
    def {function_name}(obj):
        return obj[{field_name!r}]  # key: {field_name}
    """
    return _compile_function(source, function_name=function_name, filename=filename)


@lru_cache(maxsize=_DEFAULT_CACHE_SIZE)
def _make_unbound_dict_setter_cached(
    field_name: str,
    function_name: str,
    filename: str,
) -> FunctionType:
    source = f"""
    def {function_name}(obj, value):
        obj[{field_name!r}] = value  # key: {field_name}
    """
    return _compile_function(source, function_name=function_name, filename=filename)


def make_dict_getter_and_setter(
    field_name: str,
    bind_target: dict[str, Any] | None = None,
    *,
    getter_filename: str | None = None,
    setter_filename: str | None = None,
    getter_function_name: str | None = None,
    setter_function_name: str | None = None,
) -> tuple[AttrGetter[dict[str, Any]], AttrSetter[dict[str, Any]]]:
    """Create cached getter and setter functions for a dictionary key."""
    suffix = _safe_func_suffix(field_name)
    actual_getter_name = getter_function_name or f"{_DEFAULT_GETTER_PREFIX}_{suffix}"
    actual_setter_name = setter_function_name or f"{_DEFAULT_SETTER_PREFIX}_{suffix}"
    actual_getter_filename = getter_filename or _default_filename(
        "dict_getter", actual_getter_name, repr(field_name)
    )
    actual_setter_filename = setter_filename or _default_filename(
        "dict_setter", actual_setter_name, repr(field_name)
    )

    getter = _make_unbound_dict_getter_cached(
        field_name,
        actual_getter_name,
        actual_getter_filename,
    )
    setter = _make_unbound_dict_setter_cached(
        field_name,
        actual_setter_name,
        actual_setter_filename,
    )

    if bind_target is None:
        return (
            cast(AttrGetter[dict[str, Any]], getter),
            cast(AttrSetter[dict[str, Any]], setter),
        )

    def bound_getter() -> Any:
        return getter(bind_target)

    def bound_setter(value: Any) -> None:
        setter(bind_target, value)

    bound_getter.__name__ = actual_getter_name
    bound_getter.__qualname__ = actual_getter_name
    bound_setter.__name__ = actual_setter_name
    bound_setter.__qualname__ = actual_setter_name
    return (
        cast(AttrGetter[dict[str, Any]], bound_getter),
        cast(AttrSetter[dict[str, Any]], bound_setter),
    )


# endregion
