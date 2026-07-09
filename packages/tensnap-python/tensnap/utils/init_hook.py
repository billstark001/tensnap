from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from functools import wraps
from threading import RLock
from typing import (
    Any,
    Generic,
    Literal,
    TypeAlias,
    TypeVar,
    cast,
)

T = TypeVar("T")

HookTiming: TypeAlias = Literal["before", "after"]
InitMethod: TypeAlias = Callable[..., None]
OnceInitHook: TypeAlias = Callable[[T, tuple[Any, ...], dict[str, Any]], Any]

_INIT_HOOK_STATE_ATTR = "_tensnap_init_hook_state"


@dataclass(slots=True)
class _InitHookEntry(Generic[T]):
    timing: HookTiming
    hook: OnceInitHook[T]


@dataclass(slots=True)
class _InitHookState(Generic[T]):
    cls: type[T]
    original_init: InitMethod
    lock: RLock = field(default_factory=RLock, repr=False)
    before_hooks: list[_InitHookEntry[T]] = field(default_factory=list, repr=False)
    after_hooks: list[_InitHookEntry[T]] = field(default_factory=list, repr=False)
    wrapper: InitMethod | None = field(default=None, repr=False)

    def hooks_for(self, timing: HookTiming) -> list[_InitHookEntry[T]]:
        return self.before_hooks if timing == "before" else self.after_hooks

    def has_hooks(self) -> bool:
        return bool(self.before_hooks or self.after_hooks)

    def contains(self, entry: _InitHookEntry[T]) -> bool:
        return entry in self.before_hooks or entry in self.after_hooks


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

    _state: _InitHookState[T] = field(repr=False)
    _entry: _InitHookEntry[T] = field(repr=False)

    @property
    def active(self) -> bool:
        """
        Whether this hook is still installed and has not fired.

        Returns `False` after the first construction attempt, after uninstall,
        or if `cls.__init__` has been replaced by something else.
        """
        with self._state.lock:
            return (
                self._state.contains(self._entry)
                and self._state.wrapper is not None
                and self.cls.__init__ is self._state.wrapper
            )

    def uninstall(self) -> None:
        """
        Remove this hook if it has not fired yet.

        This is safe to call multiple times. The original initializer is restored
        only when this was the final pending hook and no other code has replaced
        `cls.__init__` since the dispatcher was installed.
        """
        with self._state.lock:
            _remove_hook_entry(self._state, self._entry)
            if (
                not self._state.has_hooks()
                and self._state.wrapper is not None
                and self.cls.__init__ is self._state.wrapper
            ):
                setattr(self.cls, "__init__", self._state.original_init)
                _clear_state_if_current(self.cls, self._state)


def _clear_state_if_current(cls: type[T], state: _InitHookState[T]) -> None:
    if cls.__dict__.get(_INIT_HOOK_STATE_ATTR) is state:
        delattr(cls, _INIT_HOOK_STATE_ATTR)


def _remove_hook_entry(state: _InitHookState[T], entry: _InitHookEntry[T]) -> None:
    hooks = state.hooks_for(entry.timing)
    try:
        hooks.remove(entry)
    except ValueError:
        pass


def _make_init_dispatcher(state: _InitHookState[T]) -> InitMethod:
    original_init = state.original_init

    @wraps(original_init)
    def init_wrapper(self: T, *args: Any, **kwargs: Any) -> None:
        with state.lock:
            should_consume = (
                state.wrapper is not None and state.cls.__init__ is state.wrapper
            )
            if should_consume:
                before_hooks = tuple(state.before_hooks)
                after_hooks = tuple(state.after_hooks)
                state.before_hooks.clear()
                state.after_hooks.clear()
                setattr(state.cls, "__init__", state.original_init)
                _clear_state_if_current(state.cls, state)
            else:
                before_hooks = ()
                after_hooks = ()

        for entry in before_hooks:
            entry.hook(self, args, kwargs)

        original_init(self, *args, **kwargs)

        for entry in after_hooks:
            entry.hook(self, args, kwargs)

    return cast(InitMethod, init_wrapper)


def _current_state(cls: type[T]) -> _InitHookState[T] | None:
    state = cls.__dict__.get(_INIT_HOOK_STATE_ATTR)
    if not isinstance(state, _InitHookState):
        return None
    if state.wrapper is None or cls.__init__ is not state.wrapper:
        return None
    return cast(_InitHookState[T], state)


def install_once_init_hook(
    cls: type[T],
    hook: OnceInitHook[T],
    *,
    timing: HookTiming = "after",
) -> OnceInitHookHandle[T]:
    """
    Install a hook that runs once for the next construction of `cls`.

    The hook is attached through one dispatcher wrapper per class. On the first
    call to `cls.__init__`, the dispatcher snapshots all pending hooks, restores
    the original initializer before running user code, and consumes the snapshot.
    This prevents recursive or nested construction from triggering the same
    hooks again.

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
    * Hooks are consumed on the first construction attempt.
    * Hooks with the same timing run in installation order.
    * For `timing="after"`, if the original initializer raises, the hook is not
      run, but it is still consumed.
    * For `timing="before"`, if the hook raises, the original initializer is not
      run, and the hook is still consumed.
    * Concurrent first constructions are serialized only around hook state.
      Exactly one construction attempt consumes the pending hooks.
    * If another party replaces `cls.__init__` while the hook is installed,
      this function will not try to manage that later replacement.

    Notes
    -----
    This mutates the class object. Avoid using it on classes whose `__init__`
    is also being monkey-patched elsewhere unless you control the ordering.
    """
    state = _current_state(cls)
    if state is None:
        state = _InitHookState(cls=cls, original_init=cast(InitMethod, cls.__init__))
        state.wrapper = _make_init_dispatcher(state)
        setattr(cls, _INIT_HOOK_STATE_ATTR, state)
        setattr(cls, "__init__", state.wrapper)

    entry = _InitHookEntry(timing=timing, hook=hook)

    with state.lock:
        state.hooks_for(timing).append(entry)

    return OnceInitHookHandle(
        cls=cls,
        original_init=state.original_init,
        _state=state,
        _entry=entry,
    )
