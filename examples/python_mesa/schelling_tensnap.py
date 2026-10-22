"""TenSnap bindings for the batch-relocation Schelling example.

The model owns its RNGs and seed. Exact continuation uses the ordinary checkpoint
contract; observers are optional, per-host callbacks with no file or environment
handling in the example.

For teaching, this module applies decorators as function calls to existing Mesa
classes, including their agent field selectors. This mutates those classes for
all importers in the process and is not recommended application structure. In
an application, declare bindings alongside classes you own or in a dedicated
binding class rather than decorating imported classes at module import time.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from schelling import SchellingAgent, SchellingModel
from schelling_checkpoint import capture_checkpoint, restore_checkpoint
from tensnap import (
    BoundModelReinitializer,
    NumberParameter,
    SimulationScenario,
    agent,
    agent_layer,
    bind_datacollector,
    bind_kwargs,
    env,
    grid_layer,
    params,
)

# ``decorator(...)(Class)`` is the function-call form of ``@decorator(...)``.
agent(
    x="cell.coordinate[0]",
    y="cell.coordinate[1]",
    color=lambda item: "#3498db" if item.group == 1 else "#e74c3c",
    icon="circle",
    size=lambda item: 1.0 if item.is_satisfied() else 0.6,
)(SchellingAgent)
agent_layer()(SchellingModel)
grid_layer()(SchellingModel)
env()(SchellingModel)
bind_kwargs(exclude=["collect_data"])(SchellingModel)
bind_datacollector()(SchellingModel)

params(
    include=["width", "height", "density", "balance", "similarity_threshold", "seed"],
    custom_bindings={
        "width": NumberParameter("", min=1, step=1, allow_runtime_change=False),
        "height": NumberParameter("", min=1, step=1, allow_runtime_change=False),
        "density": NumberParameter(
            "", min=0, max=1, step=0.05, allow_runtime_change=False
        ),
        "balance": NumberParameter(
            "", min=0, max=1, step=0.05, allow_runtime_change=False
        ),
        "similarity_threshold": NumberParameter(
            "similarityThreshold", min=0, max=1, step=0.05
        ),
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
    },
)(SchellingModel)


async def create_schelling_scenario(
    *,
    model_kwargs: dict[str, Any] | None = None,
    server_port: int = 8765,
    use_msgpack: bool = False,
    observe: Callable[[SchellingModel], None] | None = None,
):
    model = SchellingModel(**(model_kwargs or {}))
    scenario = SimulationScenario(
        port=server_port,
        use_msgpack=use_msgpack,
        model_id="examples.schelling",
        state_schema_version="3",
        checkpoint_capture=lambda: capture_checkpoint(model),
        checkpoint_restore=lambda data: restore_checkpoint(model, data),
    )

    def step():
        model.step()
        return model.last_swapped > 0

    await scenario.register_model(
        model,
        reinitializer=BoundModelReinitializer(
            model, init_kwargs={"collect_data": model.collect_data}
        ),
        model_step=step,
        model_time=lambda: model.tick,
        observe=observe,
    )
    return scenario, model


async def run_schelling_server(
    *,
    model_kwargs: dict[str, Any] | None = None,
    server_port: int = 8765,
    use_msgpack: bool = False,
    observe: Callable[[SchellingModel], None] | None = None,
) -> None:
    scenario, _model = await create_schelling_scenario(
        model_kwargs=model_kwargs,
        server_port=server_port,
        use_msgpack=use_msgpack,
        observe=observe,
    )
    print(f"TenSnap Schelling visualization starting on ws://localhost:{server_port}")
    await scenario.run()
