from typing import Dict, TypeVar, Any

TKey = TypeVar("TKey", bound=str)
TValue = TypeVar("TValue")


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
