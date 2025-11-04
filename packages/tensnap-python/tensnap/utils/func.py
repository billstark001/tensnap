
from typing import Callable, Awaitable, TypeVar, Union
from typing_extensions import ParamSpec

import asyncio

P = ParamSpec("P")
R = TypeVar("R")


async def call_function(
    func: Union[Callable[P, R], Callable[P, Awaitable[R]]],
    *args: P.args,
    **kwargs: P.kwargs,
) -> R:
    """Call a function, handling both sync and async functions."""
    if asyncio.iscoroutinefunction(func):
        return await func(*args, **kwargs)  # type: ignore
    else:
        return func(*args, **kwargs)  # type: ignore

