import keyword
import re
from collections.abc import Callable
from typing import Any

# 验证Python标识符的正则表达式（支持嵌套字段）
# 支持格式: identifier, identifier.identifier, identifier[0], identifier.identifier[0]等
PYTHON_IDENTIFIER_PATTERN = re.compile(
    r"^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$"
)


def validate_field_name(field_name: str) -> bool:
    """
    Validate field name, supporting nested field access.
    Examples: 'name', 'pos.x', 'data[0]', 'agent.pos.x', 'items[0].value'
    """
    if not isinstance(field_name, str):
        return False
    if not PYTHON_IDENTIFIER_PATTERN.match(field_name):
        return False
    # Check if the first part is not a keyword
    first_part = field_name.split(".")[0].split("[")[0]
    if keyword.iskeyword(first_part):
        return False
    return True


dict_accessor_template_prefix = """
def f(obj):
    return {
"""

dict_accessor_template_suffix = """
    }
"""


def make_raw_dict_accessor(
    fields: list[str], map_fields: dict[str, str], default_values: dict[str, Any]
) -> str:

    for field in fields:
        if not validate_field_name(field):
            raise ValueError(
                f"Invalid field name: '{field}'. "
                "Field names must be valid Python identifiers and not keywords."
            )

    for field, mapped_field in map_fields.items():
        if not validate_field_name(field):
            raise ValueError(
                f"Invalid field name: '{field}'. "
                "Field names must be valid Python identifiers and not keywords."
            )
        if not validate_field_name(mapped_field):
            raise ValueError(
                f"Invalid mapped field name: '{mapped_field}'. "
                "Field names must be valid Python identifiers and not keywords."
            )

    for field in default_values.keys():
        if not validate_field_name(field):
            raise ValueError(
                f"Invalid field name in default values: '{field}'. "
                "Field names must be valid Python identifiers and not keywords."
            )

    objects = [dict_accessor_template_prefix]
    if default_values:
        default_values_str = repr(default_values)[1:-1]  # Strip the surrounding braces
        objects.append(f"        {default_values_str},\n")
    for field in fields:
        # Support nested field access (e.g., pos.x, data[0])
        objects.append(f'        "{field}": obj.{field},\n')
    for field, mapped_field in map_fields.items():
        # Support nested field access (e.g., pos.x, data[0])
        objects.append(f'        "{field}": obj.{mapped_field},\n')
    objects.append(dict_accessor_template_suffix)
    return "".join(objects)


def make_dict_accessor(
    fields: list[str], map_fields: dict[str, str], default_values: dict[str, Any]
) -> Callable[[Any], dict[str, Any]]:
    """
    Create a function that accesses specified fields from a dictionary,
    applying field mapping and default values.

    Args:
        fields: List of field names to access
        map_fields: Mapping of field names to different keys in the input dict
        default_values: Default values for fields if not present in input dict

    Raises:
        ValueError: If any field name is not a valid Python identifier or is a keyword
    """
    code = make_raw_dict_accessor(fields, map_fields, default_values)
    ns = {}
    exec(code, ns)
    return ns["f"]


def _make_identifier_getter_raw(
    ns: dict,
    id_name: str,
    id_name_for_func: str,
    bind_target: Any | None,
):
    getter_str = f"""
def get_{id_name_for_func}({"" if bind_target is not None else "obj"}):
    return obj.{id_name}
"""
    exec(getter_str, ns)


def make_identifier_getter(
    id_name: str,
    bind_target: Any | None = None,
) -> Callable[[Any], Any]:
    """
    Create getter and setter functions for a given attribute name.

    Args:
        attr_name: Name of the attribute to access

    Returns:
        A tuple containing the getter and setter functions.
    """
    if not validate_field_name(id_name):
        raise ValueError(
            f"Invalid attribute name: '{id_name}'. "
            "Attribute names must be valid Python identifiers and not keywords."
        )
    id_name_for_func = id_name.replace(".", "_").replace("[", "_").replace("]", "")
    ns = {}
    if bind_target is not None:
        ns["obj"] = bind_target
    _make_identifier_getter_raw(ns, id_name, id_name_for_func, bind_target)
    return ns[f"get_{id_name_for_func}"]


def make_identifier_getter_and_setter(
    id_name: str,
    bind_target: Any | None = None,
) -> tuple[Callable[[Any], Any], Callable[[Any, Any], None]]:
    """
    Create getter and setter functions for a given attribute name.

    Args:
        attr_name: Name of the attribute to access

    Returns:
        A tuple containing the getter and setter functions.
    """
    if not validate_field_name(id_name):
        raise ValueError(
            f"Invalid attribute name: '{id_name}'. "
            "Attribute names must be valid Python identifiers and not keywords."
        )
    id_name_for_func = id_name.replace(".", "_").replace("[", "_").replace("]", "")
    ns = {}
    if bind_target is not None:
        ns["obj"] = bind_target
    _make_identifier_getter_raw(ns, id_name, id_name_for_func, bind_target)

    setter_str = f"""
def set_{id_name_for_func}({"" if bind_target is not None else "obj, "}value):
    obj.{id_name} = value
"""
    exec(setter_str, ns)
    return ns[f"get_{id_name_for_func}"], ns[f"set_{id_name_for_func}"]


def make_dict_getter_and_setter(
    field_name: str,
    bind_target: dict | None = None,
) -> tuple[Callable[[dict[str, Any]], Any], Callable[[dict[str, Any], Any], None]]:
    """
    Create getter and setter functions for a given dictionary key.

    Args:
        field_name: Key name in the dictionary
    Returns:
        A tuple containing the getter and setter functions.
    """
    field_name_for_func = (
        field_name.replace(".", "_").replace("[", "_").replace("]", "")
    )
    ns = {}
    if bind_target is not None:
        ns["obj"] = bind_target

    getter_str = f"""
def get_{field_name_for_func}({"" if bind_target is not None else "obj"}):
    return obj["{field_name}"]
"""
    setter_str = f"""
def set_{field_name_for_func}({"" if bind_target is not None else "obj, "}value):
    obj["{field_name}"] = value
"""
    exec(getter_str, ns)
    exec(setter_str, ns)
    return ns[f"get_{field_name_for_func}"], ns[f"set_{field_name_for_func}"]
