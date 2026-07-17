"""Opt-in declarative hooks for projected and checkpoint scene restore."""

from __future__ import annotations

import base64
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import msgpack

from tensnap.utils.codec import msgpack_default

_TENSNAP_SCENE_RESTORE_FIELD = "_tensnap_scene_restore"


@dataclass(frozen=True)
class SceneRestoreBinding:
    """Method names/callables used to restore a model and capture checkpoints."""

    restore: str | Callable[[dict[str, Any]], Any] | None
    checkpoint_capture: str | Callable[[], Any] | None = None
    checkpoint_restore: str | Callable[[Any], Any] | None = None

    def bind(
        self, target: Any
    ) -> tuple[
        Callable[[dict[str, Any]], Any] | None,
        Callable[[], Any] | None,
        Callable[[Any], Any] | None,
    ]:
        restore = (
            getattr(target, self.restore)
            if isinstance(self.restore, str)
            else self.restore
        )
        capture = (
            getattr(target, self.checkpoint_capture)
            if isinstance(self.checkpoint_capture, str)
            else self.checkpoint_capture
        )
        checkpoint_restore = (
            getattr(target, self.checkpoint_restore)
            if isinstance(self.checkpoint_restore, str)
            else self.checkpoint_restore
        )
        if (
            (restore is not None and not callable(restore))
            or (capture is not None and not callable(capture))
            or (checkpoint_restore is not None and not callable(checkpoint_restore))
        ):
            raise TypeError("scene_restore binding must resolve to callable hooks")
        return restore, capture, checkpoint_restore


def scene_restore(
    restore: str | Callable[[dict[str, Any]], Any] | None = "restore_scene",
    *,
    checkpoint_capture: str | Callable[[], Any] | None = None,
    checkpoint_restore: str | Callable[[Any], Any] | None = None,
) -> Callable[[type[Any]], type[Any]]:
    """Attach explicit scene restore hooks to a model class.

    Example::

        @scene_restore(
            "restore",
            checkpoint_capture="capture",
            checkpoint_restore="restore_checkpoint",
        )
    Pass ``restore=None`` for checkpoint-only support. A projected restore
    capability is declared only when ``restore`` resolves;
    the checkpoint capability requires both checkpoint hooks. Checkpoint hooks
    receive and return model data; wire encoding is inferred by TenSnap.
    """

    binding = SceneRestoreBinding(restore, checkpoint_capture, checkpoint_restore)

    def decorator(target: type[Any]) -> type[Any]:
        setattr(target, _TENSNAP_SCENE_RESTORE_FIELD, binding)
        return target

    return decorator


def get_scene_restore_binding(value: Any) -> SceneRestoreBinding | None:
    owner = value if isinstance(value, type) else value.__class__
    binding = getattr(owner, _TENSNAP_SCENE_RESTORE_FIELD, None)
    return binding if isinstance(binding, SceneRestoreBinding) else None


def encode_checkpoint(data: Any, *, use_msgpack: bool) -> dict[str, Any]:
    """Encode model checkpoint data into the v0.3 opaque checkpoint envelope."""
    if isinstance(data, (bytes, bytearray, memoryview)):
        encoding = "application/octet-stream"
        encoded = bytes(data)
    else:
        encoding = "application/msgpack"
        encoded = msgpack.packb(data, default=msgpack_default, use_bin_type=True)
    wire_data: Any = encoded
    if not use_msgpack:
        wire_data = (
            f"data:{encoding};base64,{base64.b64encode(encoded).decode('ascii')}"
        )
    return {"encoding": encoding, "data": wire_data}


def decode_checkpoint(checkpoint: dict[str, Any]) -> Any:
    """Decode a v0.3 checkpoint envelope back to model checkpoint data."""
    encoding = checkpoint.get("encoding")
    wire_data = checkpoint.get("data")
    if not isinstance(encoding, str) or not encoding:
        raise ValueError("checkpoint.encoding must be a non-empty string")
    if isinstance(wire_data, str):
        if wire_data.startswith("data:"):
            header, separator, encoded = wire_data.partition(",")
            if not separator or ";base64" not in header:
                raise ValueError("checkpoint data URL must be base64 encoded")
            raw = base64.b64decode(encoded, validate=True)
        else:
            raw = base64.b64decode(wire_data, validate=True)
    elif isinstance(wire_data, (bytes, bytearray, memoryview)):
        raw = bytes(wire_data)
    else:
        raise ValueError("checkpoint.data must be binary data or base64 text")

    if encoding == "application/octet-stream":
        return raw
    if encoding == "application/msgpack":
        return msgpack.unpackb(raw, raw=False)
    raise ValueError(f"Unsupported checkpoint encoding: {encoding}")


__all__ = [
    "SceneRestoreBinding",
    "decode_checkpoint",
    "encode_checkpoint",
    "get_scene_restore_binding",
    "scene_restore",
]
