import inspect
from collections.abc import Awaitable, Callable
from typing import TypeVar, cast

from typing_extensions import ParamSpec

P = ParamSpec("P")
R = TypeVar("R")


async def call_function(
    func: Callable[P, R] | Callable[P, Awaitable[R]],
    *args: P.args,
    **kwargs: P.kwargs,
) -> R:
    """Call a function, handling both sync and async functions."""
    result = func(*args, **kwargs)
    if inspect.isawaitable(result):
        return cast(R, await result)
    return result
