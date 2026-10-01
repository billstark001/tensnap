"""Composable inverse of a complete projected scene snapshot.

The model owns mutation.  This module owns topology checks, stable-key
reconciliation, ordering, and the boundary between validation and application.
"""

from __future__ import annotations

import inspect
import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

Hook = str | Callable[..., Any]


def _resolve(target: Any, hook: Hook | None) -> Callable[..., Any] | None:
    value = getattr(target, hook) if isinstance(hook, str) else hook
    if value is not None and not callable(value):
        raise TypeError(f"restore hook {hook!r} is not callable")
    return value


async def _call(hook: Callable[..., Any] | None, *args: Any) -> Any:
    if hook is None:
        return None
    result = hook(*args)
    if inspect.isawaitable(result):
        return await result
    return result


@dataclass(frozen=True)
class _LayerRestore:
    create: Hook | None = None
    update: Hook | None = None
    delete: Hook | None = None
    replace: Hook | None = None
    metadata: Hook | None = None
    validate: Hook | None = None
    target: Hook | None = None

    @property
    def mode(self) -> str:
        if self.replace is not None:
            return "replace"
        if self.create is not None:
            return "collection"
        return "metadata"


@dataclass(frozen=True)
class _ProjectedRestore:
    time: Hook | None = None
    validate: Hook | None = None
    before_apply: Hook | None = None
    after_apply: Hook | None = None

    def bind(self, target: Any, scenario: Any) -> _BoundProjectedRestore:
        return _BoundProjectedRestore(self, target, scenario)


class _BoundProjectedRestore:
    def __init__(self, spec: _ProjectedRestore, target: Any, scenario: Any):
        self.spec = spec
        self.target = target
        self.scenario = scenario
        self._prepared: (
            list[
                tuple[
                    str,
                    _LayerRestore,
                    dict[str, Any],
                    dict[tuple[Any, ...], dict[str, Any]],
                    dict[tuple[Any, ...], dict[str, Any]],
                ]
            ]
            | None
        ) = None

    @staticmethod
    def _items(layer: Mapping[str, Any]) -> list[dict[str, Any]]:
        value = layer.get("items", [])
        if not isinstance(value, list) or any(
            not isinstance(item, dict) for item in value
        ):
            raise ValueError("layer items must be a list of records")
        return value

    @staticmethod
    def _key(item: Mapping[str, Any], fields: str | tuple[str, ...]) -> tuple[Any, ...]:
        keys = (fields,) if isinstance(fields, str) else fields
        if not keys or any(name not in item for name in keys):
            raise ValueError(f"missing layer item key: {keys}")
        values = tuple(item[name] for name in keys)
        if any(
            not isinstance(value, (str, int, float, bool))
            or (isinstance(value, float) and not math.isfinite(value))
            for value in values
        ):
            raise ValueError("layer item keys must be scalar")
        return values

    @classmethod
    def _index(
        cls, items: list[dict[str, Any]], fields: str | tuple[str, ...]
    ) -> dict[tuple[Any, ...], dict[str, Any]]:
        result: dict[tuple[Any, ...], dict[str, Any]] = {}
        for item in items:
            key = cls._key(item, fields)
            if key in result:
                raise ValueError(f"duplicate layer item key: {key}")
            result[key] = item
        return result

    async def prepare(self, payload: dict[str, Any]) -> None:  # noqa: PLR0912, PLR0915
        """Validate the whole declaration without mutating model state."""
        prepared = []
        seen_envs: set[str] = set()
        for env in payload.get("envs", []):
            env_id = env["id"]
            if env_id in seen_envs:
                raise ValueError(f"duplicate environment: {env_id}")
            seen_envs.add(env_id)
            registered = self.scenario.environments.get(env_id)
            if registered is None or env["type"] != registered.type:
                raise ValueError(f"environment topology mismatch: {env_id}")
            declared = set(registered.layers)
            inbound = {layer["layer_id"]: layer for layer in env["layers"]}
            if len(inbound) != len(env["layers"]) or set(inbound) != declared:
                raise ValueError(f"layer topology mismatch: {env_id}")
            for layer_id, layer in inbound.items():
                registration = registered.layers[layer_id]
                binding = registration.binding
                if (
                    layer["layer_type"] != binding.layer_type
                    or layer.get("dependency_layer_ids", {})
                    != binding.dependency_layer_ids
                ):
                    raise ValueError(f"layer topology mismatch: {env_id}/{layer_id}")
                name = f"{env_id}/{layer_id}"
                spec = binding.restore
                if spec is None:
                    raise ValueError(f"no restore declaration for {name}")
                if spec.mode == "metadata" and self._items(layer):
                    raise ValueError(f"metadata-only layer {name} has items")
                if spec.mode == "metadata" and binding.layer_type in ("agent", "edge"):
                    raise ValueError(f"item-bearing layer {name} needs an item inverse")
                incoming = (
                    self._index(self._items(layer), binding.item_keys)
                    if spec.mode == "collection"
                    else {}
                )
                if spec.mode == "collection":
                    current = self._index(
                        binding.build_item_list(registration.target), binding.item_keys
                    )
                else:
                    current = {}
                if "metadata" in layer and spec.metadata is None:
                    raise ValueError(f"no metadata restore declaration for {name}")
                await _call(_resolve(self.target, spec.validate), layer)
                prepared.append((name, spec, layer, current, incoming))

        seen_params: set[str] = set()
        for change in payload.get("parameters", []):
            param_id = change["id"]
            if param_id in seen_params:
                raise ValueError(f"duplicate parameter: {param_id}")
            seen_params.add(param_id)
            param = self.scenario.parameters.get(param_id)
            if param is None or param.setter is None:
                raise ValueError(f"parameter {param_id} has no setter")
            value = change["value"]
            if param.type == "number":
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                ):
                    raise ValueError(f"parameter {param_id} requires a finite number")
                if (getattr(param, "min", None) is not None and value < param.min) or (
                    getattr(param, "max", None) is not None and value > param.max
                ):
                    raise ValueError(f"parameter {param_id} is out of range")
            elif param.type == "boolean" and not isinstance(value, bool):
                raise ValueError(f"parameter {param_id} requires a boolean")
            elif param.type == "string" and not isinstance(value, str):
                raise ValueError(f"parameter {param_id} requires a string")
            elif param.type == "enum" and value not in (param.options or []):
                raise ValueError(f"parameter {param_id} has an unknown option")
        await _call(_resolve(self.target, self.spec.validate), payload)
        self._prepared = self._ordered(prepared)

    async def __call__(self, payload: dict[str, Any]) -> None:
        # An optional checkpoint was imported after initial validation.
        # Re-read current entities from that authoritative state before C/U/D.
        await self.prepare(payload)
        prepared, self._prepared = self._prepared, None
        assert prepared is not None
        await _call(_resolve(self.target, self.spec.before_apply), payload)
        for change in payload.get("parameters", []):
            param = self.scenario.parameters[change["id"]]
            await _call(param.setter, change["value"])
            param.value = (
                self.scenario._get_param_value(param)
                if param.getter
                else change["value"]
            )
        # Metadata precedes items. Deletion reverses dependency order.
        ordered = prepared
        for _, spec, layer, _, _ in ordered:
            if "metadata" in layer:
                await _call(_resolve(self.target, spec.metadata), layer["metadata"])
        for name, spec, _, current, incoming in reversed(ordered):
            if spec.mode == "collection":
                env_id, layer_id = name.split("/", 1)
                key_fields = (
                    self.scenario.environments[env_id]
                    .layers[layer_id]
                    .binding.item_keys
                )
                for key in current:
                    if key not in incoming:
                        await _call(
                            _resolve(self.target, spec.delete),
                            dict(zip(key_fields, key, strict=True)),
                        )
        for _, spec, layer, current, incoming in ordered:
            if spec.mode == "replace":
                await _call(_resolve(self.target, spec.replace), self._items(layer))
            elif spec.mode == "collection":
                for key, item in incoming.items():
                    hook = spec.update if key in current else spec.create
                    await _call(_resolve(self.target, hook), item)
        if "time" in payload:
            await _call(_resolve(self.target, self.spec.time), payload["time"])
        await _call(_resolve(self.target, self.spec.after_apply), payload)

    async def rebind_targets(self) -> None:
        """Refresh scenario layer targets after a model replaces owned objects."""
        for environment in self.scenario.environments.values():
            for registration in environment.layers.values():
                spec = registration.binding.restore
                if spec is None or spec.target is None:
                    continue
                target = await _call(_resolve(self.target, spec.target))
                registration.set_target(target)
                registration.reset_diff_state()

    def _ordered(self, entries: list[Any]) -> list[Any]:
        by_name = {entry[0]: entry for entry in entries}
        output: list[Any] = []
        visited: set[str] = set()
        active: set[str] = set()

        def visit(name: str) -> None:
            if name in active:
                raise ValueError(f"cyclic layer dependency: {name}")
            if name in visited:
                return
            active.add(name)
            entry = by_name[name]
            env_id, _ = name.split("/", 1)
            for dep in (
                self.scenario.environments[env_id]
                .layers[entry[2]["layer_id"]]
                .binding.dependency_layer_ids.values()
            ):
                dep_name = f"{env_id}/{dep}"
                if dep_name in by_name:
                    visit(dep_name)
            active.remove(name)
            visited.add(name)
            output.append(entry)

        for name in by_name:
            visit(name)
        return output


__all__ = []
