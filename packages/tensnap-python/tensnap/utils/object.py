from typing import Any, Dict, TypeVar, Type

import inspect

TKey = TypeVar("TKey", bound=str)
TValue = TypeVar("TValue")
TClass = TypeVar("TClass")


def dict_diff(
    last: Dict[TKey, TValue], current: Dict[TKey, TValue]
) -> Dict[TKey, TValue]:
    diff_dict: Dict[TKey, TValue] = {}
    for key, value in current.items():
        if key not in last or value != last[key]:
            diff_dict[key] = value

    for key in last:
        if key not in current:
            diff_dict[key] = None  # type: ignore[assignment]

    return diff_dict


def _extend_member_name(member: Any) -> str | None:
    name = getattr(member, "__name__", None)
    if name is not None:
        return name

    property_getter = getattr(member, "fget", None)
    name = getattr(property_getter, "__name__", None)
    if name is not None:
        return name

    wrapped_func = getattr(member, "__func__", None)
    return getattr(wrapped_func, "__name__", None)


def _existing_property(cls: Type[TClass], name: str) -> property:
    current = getattr(cls, name, None)
    if not isinstance(current, property):
        raise TypeError(f"Cannot extend {cls.__name__}.{name} as a property accessor.")
    return current


def extend(
    cls: Type[TClass],
    name: str | None = None,
    *,
    setter: bool = False,
    deleter: bool = False,
):
    """
    Extend a function or descriptor as a member on cls.

    Usage:
        @extend(SomeClass)
        def method(self, ...):
            ...

        @extend(SomeClass)
        @property
        def value(self):
            ...

        @extend(SomeClass)
        @value.setter
        def value(self, next_value):
            ...

        @extend(SomeClass, "value", setter=True)
        def set_value(self, next_value):
            ...
    """
    if setter and deleter:
        raise ValueError("extend cannot install a setter and deleter at the same time.")

    def decorator(member):
        attr_name = name or _extend_member_name(member)
        if attr_name is None:
            raise ValueError("extend requires a name for this member.")

        installed = member
        if setter:
            installed = _existing_property(cls, attr_name).setter(member)
        elif deleter:
            installed = _existing_property(cls, attr_name).deleter(member)

        setattr(cls, attr_name, installed)
        return installed

    return decorator


def get_init_args(cls: Type[TClass]):
    sig = inspect.signature(cls)
    result = {}

    for name, param in sig.parameters.items():
        if param.kind in (
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            if param.default is inspect.Parameter.empty:
                default = None
                required = True
            else:
                default = param.default
                required = False

            result[name] = {
                "default": default,
                "required": required,
                "annotation": (
                    param.annotation
                    if param.annotation is not inspect.Parameter.empty
                    else None
                ),
            }

    return result


def infer_id_from_func_name(func_name: str):
    ret = func_name
    if func_name.startswith("get"):
        ret = func_name[3:]
    ret = ret.lstrip("_")
    return ret or func_name


def infer_label_from_id(id: str):
    return id.replace("_", " ").replace("-", " ").title().strip()
