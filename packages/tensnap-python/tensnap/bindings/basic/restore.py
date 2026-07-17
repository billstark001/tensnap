"""Opt-in declarative hooks for projected and checkpoint scene restore."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

_TENSNAP_SCENE_RESTORE_FIELD = "_tensnap_scene_restore"


@dataclass(frozen=True)
class SceneRestoreBinding:
    """Method names/callables used to restore a model and capture checkpoints."""

    restore: str | Callable[[dict[str, Any]], Any]
    checkpoint_capture: str | Callable[[], Any] | None = None

    def bind(self, target: Any) -> tuple[Callable[[dict[str, Any]], Any], Callable[[], Any] | None]:
        restore = getattr(target, self.restore) if isinstance(self.restore, str) else self.restore
        capture = (
            getattr(target, self.checkpoint_capture)
            if isinstance(self.checkpoint_capture, str)
            else self.checkpoint_capture
        )
        if not callable(restore) or (capture is not None and not callable(capture)):
            raise TypeError("scene_restore binding must resolve to callable hooks")
        return restore, capture


def scene_restore(
    restore: str | Callable[[dict[str, Any]], Any] = "restore_scene",
    *,
    checkpoint_capture: str | Callable[[], Any] | None = None,
) -> Callable[[type[Any]], type[Any]]:
    """Attach explicit scene restore hooks to a model class.

    Example: ``@scene_restore("restore", checkpoint_capture="checkpoint")``.
    A projected restore capability is declared only when ``restore`` resolves;
    the checkpoint capability additionally requires ``checkpoint_capture``.
    """

    binding = SceneRestoreBinding(restore, checkpoint_capture)

    def decorator(target: type[Any]) -> type[Any]:
        setattr(target, _TENSNAP_SCENE_RESTORE_FIELD, binding)
        return target

    return decorator


def get_scene_restore_binding(value: Any) -> SceneRestoreBinding | None:
    owner = value if isinstance(value, type) else value.__class__
    binding = getattr(owner, _TENSNAP_SCENE_RESTORE_FIELD, None)
    return binding if isinstance(binding, SceneRestoreBinding) else None


__all__ = ["SceneRestoreBinding", "scene_restore", "get_scene_restore_binding"]
