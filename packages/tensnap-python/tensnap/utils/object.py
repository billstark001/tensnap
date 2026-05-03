from typing import Dict, TypeVar, Any

TKey = TypeVar("TKey", bound=str)
TValue = TypeVar("TValue")


def dict_diff(
    last: Dict[TKey, TValue], current: Dict[TKey, TValue]
) -> Dict[TKey, TValue]:
    diff_dict: Dict[TKey, TValue] = {}
    for key in set(last.keys()) | set(current.keys()):
        if key not in current:
            diff_dict[key] = None  # type: ignore[assignment]
        elif key not in last or current[key] != last[key]:
            diff_dict[key] = current[key]
    return diff_dict
