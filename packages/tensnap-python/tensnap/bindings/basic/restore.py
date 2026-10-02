"""Opt-in declarative hooks for projected and checkpoint scene restore."""

from __future__ import annotations

import base64
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

import msgpack

from tensnap.bindings.ownership import (
    attach_class_metadata,
    read_class_metadata,
    require_class,
)
from tensnap.utils.codec import msgpack_default

from .layer import _layer_binding_config_objects_name
from .restore_plan import RestoreValue, _LayerRestore, _ProjectedRestore

_TENSNAP_SCENE_RESTORE_FIELD = "_tensnap_scene_restore"


@dataclass(frozen=True)
class SceneRestoreBinding:
    """Method names/callables used to restore a model and capture checkpoints."""

    restore: str | Callable[[dict[str, Any]], Any] | _ProjectedRestore | None
    checkpoint_capture: str | Callable[[], Any] | None = None
    checkpoint_restore: str | Callable[[Any], Any] | None = None

    def bind(
        self, target: Any, scenario: Any = None
    ) -> tuple[
        Callable[[dict[str, Any]], Any] | None,
        Callable[[], Any] | None,
        Callable[[Any], Any] | None,
    ]:
        restore = (
            self.restore.bind(target, scenario)
            if isinstance(self.restore, _ProjectedRestore)
            else getattr(target, self.restore)
            if isinstance(self.restore, str)
            else self.restore
        )
        capture_spec = self.checkpoint_capture
        restore_spec = self.checkpoint_restore
        capture = (
            getattr(target, capture_spec)
            if isinstance(capture_spec, str)
            else capture_spec
        )
        checkpoint_restore = (
            getattr(target, restore_spec)
            if isinstance(restore_spec, str)
            else restore_spec
        )
        if (
            (restore is not None and not callable(restore))
            or (capture is not None and not callable(capture))
            or (checkpoint_restore is not None and not callable(checkpoint_restore))
        ):
            raise TypeError("scene_restore binding must resolve to callable hooks")
        return restore, capture, checkpoint_restore


def scene_restore(  # noqa: PLR0913 - declarative callbacks are independent phases
    restore: str | Callable[[dict[str, Any]], Any] | None = "restore_scene",
    *,
    checkpoint_capture: str | Callable[[], Any] | None = None,
    checkpoint_restore: str | Callable[[Any], Any] | None = None,
    time: str | Callable[[Any], Any] | RestoreValue | None = None,
    validate: str | Callable[..., Any] | None = None,
    before_apply: str | Callable[..., Any] | None = None,
    after_apply: str | Callable[..., Any] | None = None,
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

    if (checkpoint_capture is None) != (checkpoint_restore is None):
        raise ValueError("Checkpoint capture and restore must be declared together")
    declarative = any(
        value is not None for value in (time, validate, before_apply, after_apply)
    )
    restore_spec: str | Callable[[dict[str, Any]], Any] | _ProjectedRestore | None = (
        restore
    )
    if declarative:
        if restore != "restore_scene":
            raise ValueError(
                "Declarative scene_restore cannot also name an imperative restore hook"
            )
        restore_spec = _ProjectedRestore(time, validate, before_apply, after_apply)
    binding = SceneRestoreBinding(
        restore_spec, checkpoint_capture, checkpoint_restore
    )

    def decorator(target: type[Any]) -> type[Any]:
        require_class(target, "@scene_restore")
        previous = get_scene_restore_binding(target)
        if previous is not None and previous.checkpoint_capture is not None:
            if binding.checkpoint_capture is not None:
                raise ValueError("Checkpoint hooks are already declared")
            attach_class_metadata(
                target,
                _TENSNAP_SCENE_RESTORE_FIELD,
                replace(
                    binding,
                    checkpoint_capture=previous.checkpoint_capture,
                    checkpoint_restore=previous.checkpoint_restore,
                ),
            )
        else:
            attach_class_metadata(target, _TENSNAP_SCENE_RESTORE_FIELD, binding)
        return target

    return decorator


def checkpoint(
    *, capture: str | Callable[..., Any], restore: str | Callable[..., Any]
) -> Callable[[type[Any]], type[Any]]:
    """Declare paired model-private checkpoint hooks."""

    def decorator(target: type[Any]) -> type[Any]:
        require_class(target, "@checkpoint")
        previous = get_scene_restore_binding(target) or SceneRestoreBinding(None)
        if (
            previous.checkpoint_capture is not None
            or previous.checkpoint_restore is not None
        ):
            raise ValueError("Checkpoint hooks are already declared")
        attach_class_metadata(
            target,
            _TENSNAP_SCENE_RESTORE_FIELD,
            replace(previous, checkpoint_capture=capture, checkpoint_restore=restore),
        )
        return target

    return decorator


def layer_restore(  # noqa: PLR0913 - layer callbacks are independent operations
    *,
    create: str | Callable[..., Any] | None = None,
    update: str | Callable[..., Any] | None = None,
    delete: str | Callable[..., Any] | None = None,
    replace: str | Callable[..., Any] | None = None,
    metadata: str | Callable[..., Any] | None = None,
    validate: str | Callable[..., Any] | None = None,
    target: str | Callable[..., Any] | None = None,
    layer_id: str | None = None,
) -> Callable[[type[Any]], type[Any]]:
    """Attach the inverse to a layer already declared on the class."""
    if replace is not None and any(
        value is not None for value in (create, update, delete)
    ):
        raise ValueError("replace cannot be combined with create/update/delete")
    if (
        replace is None
        and any(value is not None for value in (create, update, delete))
        and not all(value is not None for value in (create, update, delete))
    ):
        raise ValueError("collection restore needs create, update, and delete")
    if all(value is None for value in (create, replace, metadata)):
        raise ValueError("layer_restore needs item or metadata callbacks")
    spec = _LayerRestore(create, update, delete, replace, metadata, validate, target)

    def decorator(owner: type[Any]) -> type[Any]:
        require_class(owner, "@layer_restore")
        # A restore declaration may only modify a layer owned by this class.
        # Inherited config objects belong to the base class and are mutable.
        configs = list(vars(owner).get(_layer_binding_config_objects_name, []))
        matches = [
            config
            for config in configs
            if config._attached_class is owner
            and (layer_id is None or config.layer_id == layer_id)
        ]
        if len(matches) != 1:
            raise ValueError(
                "layer_restore requires exactly one matching layer; specify layer_id"
            )
        if matches[0].restore is not None:
            raise ValueError(
                f"layer {matches[0].layer_id} already has restore callbacks"
            )
        matches[0].restore = spec
        return owner

    return decorator


def get_scene_restore_binding(value: Any) -> SceneRestoreBinding | None:
    """Read class-owned restore metadata from a model class or instance."""
    return read_class_metadata(value, _TENSNAP_SCENE_RESTORE_FIELD, SceneRestoreBinding)


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
