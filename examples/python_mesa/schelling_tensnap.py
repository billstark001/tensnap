"""Reusable binding/server shared by teaching and publication launchers.

The extraction keeps reset semantics identical; it is not required structure
for a small TenSnap example.
"""

from __future__ import annotations

from typing import Any

from tensnap import (
    BoundModelReinitializer,
    NumberParameter,
    SimulationScenario,
    agent,
    agent_layer,
    bind_datacollector,
    bind_kwargs,
    env,
    params,
)

from schelling import SchellingAgent, SchellingModel


agent(
    x="cell.coordinate[0]",
    y="cell.coordinate[1]",
    color=lambda item: "#3498db" if item.group == 1 else "#e74c3c",
    icon="circle",
    size=lambda item: 1.0 if item.is_satisfied() else 0.6,
)(SchellingAgent)
agent_layer()(SchellingModel)
env()(SchellingModel)
bind_kwargs(exclude=["rng", "collect_data"])(SchellingModel)
bind_datacollector()(SchellingModel)
params(
    exclude=["initialized", "last_swapped", "tick", "rng", "collect_data"],
    custom_bindings={
        "similarity_threshold": NumberParameter("", min=0, max=1, step=0.05),
        "density": NumberParameter("", min=0, max=1, step=0.05),
        "balance": NumberParameter("", min=0, max=1, step=0.05),
    },
)(SchellingModel)


class SeededModelReinitializer(BoundModelReinitializer):
    """Preserve non-UI construction choices across init/reset calls."""

    def __init__(
        self,
        model: SchellingModel,
        *,
        seed: int | None,
        collect_data: bool,
    ) -> None:
        super().__init__(model)
        self._seed = seed
        self._collect_data = collect_data

    def current_kwargs(self):
        return {
            **super().current_kwargs(),
            "rng": self._seed,
            "collect_data": self._collect_data,
        }


async def run_schelling_server(
    *,
    model_kwargs: dict[str, Any] | None = None,
    server_port: int = 8765,
) -> None:
    kwargs = dict(model_kwargs or {})
    model = SchellingModel(**kwargs)
    seed = kwargs.get("rng")
    reinitializer = SeededModelReinitializer(
        model,
        seed=seed if isinstance(seed, int) else None,
        collect_data=bool(kwargs.get("collect_data", True)),
    )
    scenario = SimulationScenario(port=server_port)
    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)
    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=model.advance,
        model_reset=reinitializer.model_reset,
    )
    print(f"TenSnap Schelling visualization starting on ws://localhost:{server_port}")
    await scenario.run()
