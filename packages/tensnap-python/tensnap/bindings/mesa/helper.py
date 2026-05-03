"""Mesa-specific binding helpers."""

from typing import Any, Callable

from tensnap.models import (
    EnvironmentBinding,
    LayerBinding,
)
from tensnap.utils.attr import make_attr_getter, make_attr_projector

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


async def mesa_model_reinit(handler: Any) -> None:
    """
    Re-initialise a Mesa-style handler on reset.

    Dumps current parameter values, strips auto-registered bindings, rebuilds
    the model with updated init-kwargs, re-registers, then replays any
    non-init-kwarg parameters.

    Args:
        handler: A MesaSimulationHandler instance (typed as Any to avoid
            importing Mesa at runtime).
    """
    scenario = handler.scenario
    assert scenario is not None, "Handler must be registered before re-init."

    dumped: dict[str, Any] = {
        pid: scenario._get_param_value(param)
        for pid, param in scenario.parameters.items()
    }
    handler._unregister_auto(scenario)

    replayed: dict[str, Any] = {}
    for key, value in dumped.items():
        if key in handler.model_init_kwargs_orig:
            handler.model_init_kwargs[key] = value
        else:
            replayed[key] = value

    handler._init_model()
    await handler.on_registered(scenario)

    for key, value in replayed.items():
        if key in scenario.parameters:
            scenario._set_param_value(scenario.parameters[key], value)


# endregion
