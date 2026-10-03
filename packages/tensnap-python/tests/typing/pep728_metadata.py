"""Pyright check for PEP 728 extra items; mypy does not support them yet."""

from tensnap.bindings.basic.layer_kwargs import LayerMetadataKwargs

metadata: LayerMetadataKwargs = {"temperature": 1.0, "label": "heat"}
