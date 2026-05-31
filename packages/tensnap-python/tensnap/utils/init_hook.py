from __future__ import annotations

from dataclasses import dataclass, field
from functools import wraps
from threading import RLock
from typing import (
    Any,
    Tuple,
    Dict,
    Callable,
    Generic,
    Literal,
    TypeAlias,
    TypeVar,
    cast,
)

T = TypeVar("T")

HookTiming: TypeAlias = Literal["before", "after"]
InitMethod: TypeAlias = Callable[..., None]
OnceInitHook: TypeAlias = Callable[[T, Tuple[Any, ...], Dict[str, Any]], Any]


@dataclass(slots=True)
class OnceInitHookHandle(Generic[T]):
    """
    Handle returned by `install_once_init_hook`.

    Calling `uninstall()` restores the original `__init__` only if this hook is
    still installed and has not already fired. The method is idempotent.

    If the hook has already fired, the original `__init__` has already been
    restored, so `uninstall()` becomes a no-op.

    If another caller replaces `cls.__init__` after this hook is installed,
    `uninstall()` will not overwrite that newer replacement.
    """

    cls: type[T]
    original_init: InitMethod

    _wrapper: InitMethod = field(repr=False)
    _lock: RLock = field(repr=False)
    _armed: Callable[[], bool] = field(repr=False)
    _disarm: Callable[[], None] = field(repr=False)

    @property
    def active(self) -> bool:
        """
        Whether this hook is still installed and has not fired.

        Returns `False` after the first construction attempt, after uninstall,
        or if `cls.__init__` has been replaced by something else.
        """
        with self._lock:
            return self._armed() and self.cls.__init__ is self._wrapper

    def uninstall(self) -> None:
        """
        Remove the hook if it is still the active `__init__` wrapper.

        This is safe to call multiple times. It does not restore the original
        initializer if some other code has replaced `cls.__init__` since this
        hook was installed.
        """
        with self._lock:
            if self.cls.__init__ is self._wrapper:
                self.cls.__init__ = self.original_init
            self._disarm()


def install_once_init_hook(
    cls: type[T],
    hook: OnceInitHook[T],
    *,
    timing: HookTiming = "after",
) -> OnceInitHookHandle[T]:
    """
    Install a hook that runs once for the next construction of `cls`.

    The hook is attached by temporarily wrapping `cls.__init__`. On the first
    call to `cls.__init__`, the wrapper restores the original initializer before
    running user code. This prevents recursive or nested construction from
    triggering the hook again.

    Parameters
    ----------
    cls:
        Class whose `__init__` should be temporarily wrapped.

    hook:
        Callable receiving the instance being initialized. It may return any
        value; the return value is ignored.

    timing:
        `"before"` runs `hook(instance)` before the original initializer.
        `"after"` runs `hook(instance)` after the original initializer
        completes successfully.

    Returns
    -------
    OnceInitHookHandle[T]
        A handle that can be used to inspect whether the hook is still active
        or to uninstall it before it fires.

    Semantics
    ---------
    * The hook is consumed on the first construction attempt.
    * For `timing="after"`, if the original initializer raises, the hook is not
      run, but it is still consumed.
    * For `timing="before"`, if the hook raises, the original initializer is not
      run, and the hook is still consumed.
    * Concurrent first constructions are serialized only around hook state.
      Exactly one construction attempt consumes the hook.
    * If another party replaces `cls.__init__` while the hook is installed,
      this function will not try to manage that later replacement.

    Notes
    -----
    This mutates the class object. Avoid using it on classes whose `__init__`
    is also being monkey-patched elsewhere unless you control the ordering.
    """
    original_init = cast(InitMethod, cls.__init__)
    lock = RLock()
    armed = True

    def is_armed() -> bool:
        return armed

    def disarm() -> None:
        nonlocal armed
        armed = False

    @wraps(original_init)
    def init_wrapper(self: T, *args: Any, **kwargs: Any) -> None:
        nonlocal armed

        should_run_hook = False

        with lock:
            if armed and cls.__init__ is init_wrapper:
                armed = False
                should_run_hook = True
                cls.__init__ = original_init

        if not should_run_hook:
            original_init(self, *args, **kwargs)
            return

        if timing == "before":
            hook(self, args, kwargs)
            original_init(self, *args, **kwargs)
        else:
            original_init(self, *args, **kwargs)
            hook(self, args, kwargs)

    wrapper = cast(InitMethod, init_wrapper)

    with lock:
        cls.__init__ = wrapper

    return OnceInitHookHandle(
        cls=cls,
        original_init=original_init,
        _wrapper=wrapper,
        _lock=lock,
        _armed=is_armed,
        _disarm=disarm,
    )
