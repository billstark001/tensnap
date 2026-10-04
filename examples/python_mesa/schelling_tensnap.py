"""Reusable binding/server shared by teaching and publication launchers.

The extraction keeps reset semantics identical; it is not required structure
for a small TenSnap example.
"""

from __future__ import annotations

import os
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
    grid_layer,
    params,
)

from schelling import SchellingAgent, SchellingModel
from schelling_checkpoint import capture_checkpoint, restore_checkpoint


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
bind_kwargs(exclude=["rng", "collect_data"])(SchellingModel)
bind_datacollector()(SchellingModel)
params(
    exclude=["initialized", "last_swapped", "tick", "rng", "collect_data"],
    custom_bindings={
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
        audit_write=None,
    ) -> None:
        super().__init__(model)
        self._seed = seed
        self._collect_data = collect_data
        self._audit_write = audit_write

    def current_kwargs(self):
        return {
            **super().current_kwargs(),
            "rng": self._seed,
            "collect_data": self._collect_data,
        }

    def reinitialize_model(self) -> None:
        super().reinitialize_model()
        if self._audit_write is not None:
            self._audit_write(self.model)

    def register_model(self, scenario, *, dry_run=False):
        changes = super().register_model(scenario, dry_run=dry_run)
        if not dry_run:
            # Re-registration during init/reset replaces binding hooks. Reattach
            # the exact checkpoint wrapper to keep the protocol clock in sync.
            def restore(data):
                restore_checkpoint(self.model, data)
                scenario._time_step = int(data["time"])
                if self._audit_write is not None:
                    self._audit_write(self.model)
            scenario.configure_scene_restore(None,
                checkpoint_capture=lambda: capture_checkpoint(self.model),
                checkpoint_restore=restore)
        return changes


async def run_schelling_server(
    *,
    model_kwargs: dict[str, Any] | None = None,
    server_port: int = 8765,
    use_msgpack: bool = False,
) -> None:
    kwargs = dict(model_kwargs or {})
    model = SchellingModel(**kwargs)
    audit_path = os.environ.get("TENSNAP_SCHELLING_AUDIT_STATE")
    audit_write = None
    if audit_path:
        from schelling_audit import audit_writer  # publication-only injection
        audit_write = audit_writer(audit_path)
        audit_write(model)
    seed = kwargs.get("rng")
    reinitializer = SeededModelReinitializer(
        model,
        seed=seed if isinstance(seed, int) else None,
        collect_data=bool(kwargs.get("collect_data", True)),
        audit_write=audit_write,
    )
    scenario = SimulationScenario(port=server_port, use_msgpack=use_msgpack,
                                  model_id="examples.schelling", state_schema_version="2")
    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)
    if audit_write is None:
        model_step = model.step
    else:
        def model_step():
            result = model.step()
            audit_write(model)
            return result
    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=model_step,
        model_reset=reinitializer.model_reset,
    )
    print(f"TenSnap Schelling visualization starting on ws://localhost:{server_port}")
    await scenario.run()
