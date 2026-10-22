"""Mesa clock restore binding backed by the shared compatibility utilities."""

from tensnap.bindings.basic.restore_plan import RestoreValue

from .utils import (
    mesa_model_time,
    restore_mesa_model_time,
    validate_mesa_model_time_restore,
)

__all__ = [
    "mesa_clock_restore",
    "mesa_model_time",
    "restore_mesa_model_time",
    "validate_mesa_model_time_restore",
]

mesa_clock_restore = RestoreValue(
    apply=restore_mesa_model_time,
    validate=validate_mesa_model_time_restore,
)
