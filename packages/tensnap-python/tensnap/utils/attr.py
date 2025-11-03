from typing import Any, Callable, Dict, List, TypeVar
import re
import keyword


# 验证Python标识符的正则表达式
PYTHON_IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def validate_field_name(field_name: str) -> bool:
    if not isinstance(field_name, str):
        return False
    if not PYTHON_IDENTIFIER_PATTERN.match(field_name):
        return False
    if keyword.iskeyword(field_name):
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
    fields: List[str], map_fields: Dict[str, str], default_values: Dict[str, Any]
) -> str:

    for field in fields:
        if not validate_field_name(field):
            raise ValueError(
                f"Invalid field name: '{field}'. Field names must be valid Python identifiers and not keywords."
            )

    for field, mapped_field in map_fields.items():
        if not validate_field_name(field):
            raise ValueError(
                f"Invalid field name: '{field}'. Field names must be valid Python identifiers and not keywords."
            )
        if not validate_field_name(mapped_field):
            raise ValueError(
                f"Invalid mapped field name: '{mapped_field}'. Field names must be valid Python identifiers and not keywords."
            )

    for field in default_values.keys():
        if not validate_field_name(field):
            raise ValueError(
                f"Invalid field name in default values: '{field}'. Field names must be valid Python identifiers and not keywords."
            )

    objects = [dict_accessor_template_prefix]
    if default_values:
        default_values_str = repr(default_values)[1:-1]  # Strip the surrounding braces
        objects.append(f"        {default_values_str},\n")
    for field in fields:
        objects.append(f'        "{field}": obj.{field},\n')
    for field, mapped_field in map_fields.items():
        objects.append(f'        "{field}": obj.{mapped_field},\n')
    objects.append(dict_accessor_template_suffix)
    return "".join(objects)


def make_dict_accessor(
    fields: List[str], map_fields: Dict[str, str], default_values: Dict[str, Any]
) -> Callable[[Any], Dict[str, Any]]:
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
