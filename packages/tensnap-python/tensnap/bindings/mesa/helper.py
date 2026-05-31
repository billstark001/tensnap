"""Mesa-specific binding helpers."""

from typing import Any, Callable

from tensnap.models import (
    EnvironmentBinding,
    LayerBinding,
)
from tensnap.utils.attr import make_attr_getter, make_attr_projector
from tensnap.utils.model_reinit import reinitialize_registered_model

# region Built-in action handler factories
# Each factory returns a coroutine decorated with @action so that the metadata
# attribute (_tensnap_action) is present for registration.


# endregion

# region Mesa-style environment binding factory


def build_default_layered_binder(
    model: Any,
    agent_iterable_projector: "str | Callable" = "agents",
) -> tuple[EnvironmentBinding, list[LayerBinding[Any, Any, Any, Any]]]:
    """
    Build default environment/layer bindings for a Mesa-style grid model.

    Assumes ``model.grid`` (with ``.width`` / ``.height``) and agents with
    ``unique_id`` and ``pos`` attributes.  No Mesa import at runtime.

    Args:
        model: The simulation model instance.
        agent_iterable_projector: Attribute name string or callable returning
            the agent iterable from the model.
    """
    if callable(agent_iterable_projector):
        direct_iterable_getter = agent_iterable_projector

        def resolved_iterable_getter(target: Any) -> Any:
            return direct_iterable_getter(target)

    else:
        _getter = make_attr_getter(str(agent_iterable_projector))

        def resolved_iterable_getter(target: Any) -> Any:
            val = _getter(target)
            return val() if callable(val) else val

    def grid_metadata(target: Any) -> dict[str, Any]:
        grid = target.grid
        return {
            "width": grid.width,
            "height": grid.height,
        }

    environment_binding = EnvironmentBinding(id=type(model).__name__, type="2d")
    grid_binding = LayerBinding(
        layer_id="grid",
        layer_type="grid",
        item_keys=(),
        metadata_projector=grid_metadata,
        items_projector=lambda _env: [],
    )
    agent_binding = LayerBinding(
        layer_id="agents",
        layer_type="agent",
        item_keys=("id",),
        iterable_getter=resolved_iterable_getter,
        item_projector=make_attr_projector(
            [],
            {"id": "unique_id", "x": "pos[0]", "y": "pos[1]"},
            {},
        ),
    )
    return environment_binding, [grid_binding, agent_binding]


# endregion

# region Mesa model re-init helper


MESA_LIFECYCLE_PARAMETER_IDS = {"running", "steps", "time"}


async def mesa_model_reinit(handler: Any) -> None:
    """
    Re-initialize a Mesa-style handler on reset.

    This is a Mesa policy wrapper around the generic reinitialization helper:
    Mesa lifecycle counters are excluded from replay, while constructor kwargs
    and runtime parameters are preserved across the rebuild.

    Args:
        handler: A MesaSimulationHandler instance (typed as Any to avoid
            importing Mesa at runtime).
    """
    await reinitialize_registered_model(
        handler,
        lifecycle_parameter_ids=MESA_LIFECYCLE_PARAMETER_IDS,
    )


# endregion
