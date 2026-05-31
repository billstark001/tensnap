from typing import Dict, TypeVar, Type

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


def extend(cls: Type[TClass]):
    """
    Extend the function as a method on cls.

    Usage:
        @extend(SomeClass)
        def method(self, ...):
            ...
    """

    def decorator(func):
        setattr(cls, func.__name__, func)
        return func

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
