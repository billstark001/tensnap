"""
TenSnap helper utilities.

Provides action-handler factories (start / step / reset) that close over a
SimulationScenario, and an environment-binder factory for Mesa-style models.
Mesa is only referenced in TYPE_CHECKING blocks — no runtime import.
"""

from typing import Any, Callable

from tensnap.models import (
    EnvironmentBindingBuilder,
    LayeredEnvironmentBinder,
)
from tensnap.utils.attr import make_identifier_getter


# region Built-in action handler factories
# Each factory returns a coroutine decorated with @action so that the metadata
# attribute (_tensnap_action) is present for registration.


# endregion

# region Mesa-style environment binder factory


def build_default_layered_binder(
    model: Any,
    agent_iterable_accessor: "str | Callable" = "agents",
) -> "LayeredEnvironmentBinder":
    """
    Build a 2-D grid + agent LayeredEnvironmentBinder for Mesa-style models.

    Assumes ``model.grid`` (with ``.width`` / ``.height``) and agents with
    ``unique_id`` and ``pos`` attributes.  No Mesa import at runtime.

    Args:
        model: The simulation model instance.
        agent_iterable_accessor: Attribute name string or callable returning
            the agent iterable from the model.
    """
    if callable(agent_iterable_accessor):
        iterable_fn: Callable[[Any], Any] = agent_iterable_accessor
    else:
        _getter = make_identifier_getter(str(agent_iterable_accessor))

        def iterable_fn(target: Any) -> Any:
            val = _getter(target)
            return val() if callable(val) else val

    builder = EnvironmentBindingBuilder(environment_type="2d")
    builder.add_grid_layer(
        metadata_accessor=lambda env: {
            "width": env.grid.width,
            "height": env.grid.height,
        },
    )
    builder.add_agent_layer(
        item_iterable_accessor=iterable_fn,
        item_accessor=make_grid_agent_accessor(id="unique_id", x="pos[0]", y="pos[1]"),
    )
    return builder.build(type(model).__name__, model)


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
