"""Shared TenSnap lifecycle and controls; model packages supply their views."""

from __future__ import annotations

from dataclasses import replace

from tensnap import (
    EnumParameter,
    NumberParameter,
    SimulationScenario,
    action,
    monitor,
    params,
)

from .config import integer


class ModelView:
    selected_agent: int
    seed: int
    policy: str

    def __init__(self, model) -> None:
        self.model = model
        self._selected_agent = 0
        self.scenario = None

    @property
    def seed(self) -> int:
        return self.model.config.seed

    @property
    def policy(self) -> str:
        return self.model.provider.mode if self.model.provider else "rule"

    @property
    def selected_agent(self) -> int:
        return self._selected_agent

    @selected_agent.setter
    def selected_agent(self, value) -> None:
        self._selected_agent = integer(
            value, "selected_agent", 0, len(self.model.agents) - 1
        )

    @property
    def agents(self):
        return self.model.agents

    @monitor(
        "selected_agent", "Selected agent / recent interactions", render_hint="tree"
    )
    def selected(self):
        player = self.model.agents[self.selected_agent]
        return {"id": player.id, **player.data}

    @monitor("inference", "Inference budget (never rewinds)", render_hint="tree")
    def inference(self):
        return self.model.provider.status() if self.model.provider else {"mode": "rule"}

    @monitor("metrics", "Current metrics", render_hint="tree")
    def metrics(self):
        return self.model.metrics()

    @action("reseed", "Reset with next seed")
    async def reseed(self):
        self.model.config = replace(self.model.config, seed=(self.seed + 1) % 2**32)
        await self.scenario._fire_reset()

    def capture(self):
        return {"model": self.model.capture(), "selected_agent": self.selected_agent}

    def restore(self, saved):
        selected = integer(
            saved["selected_agent"], "selected_agent", 0, len(self.model.agents) - 1
        )
        self.model.restore(saved["model"])
        self._selected_agent = selected
        self.scenario._time_step = self.model.tick


def controls(extra):
    return params(
        include=["selected_agent", "seed", "policy", *extra],
        custom_bindings={
            "selected_agent": NumberParameter("", min=0, max=199, step=1),
            "seed": NumberParameter(
                "", min=0, max=2**32 - 1, allow_runtime_change=False
            ),
            "policy": EnumParameter(
                "", options=["rule", "llm", "replay"], allow_runtime_change=False
            ),
            **extra,
        },
    )


async def build_scenario(model, view_type, port=8765):
    view = view_type(model)
    scenario = SimulationScenario(
        host="127.0.0.1",
        port=port,
        step_interval=0.1,
        model_id=model.model_id,
        state_schema_version=str(model.checkpoint_version),
    )
    view.scenario = scenario
    scenario.add_all(view)
    # Binding discovery reads class-local declarations. Register shared base
    # members explicitly as bound callables through the public namespace API.
    scenario.add_monitors(
        {
            "selected": view.selected,
            "inference": view.inference,
            "metrics": view.metrics,
        }
    )
    scenario.add_actions({"reseed": view.reseed})
    scenario.parameters["selected_agent"].max = len(model.agents) - 1
    # These private lifecycle hooks are also used by repository examples. Keep
    # them here: the pure model has no dependency on scenario clocks or encoding.
    scenario.configure_scene_restore(
        None,
        checkpoint_capture=view.capture,
        checkpoint_restore=view.restore,
    )

    async def step():
        try:
            await model.step()
        except BaseException:
            # Default handlers increment before invoking the model. An API
            # failure must not leave the protocol clock ahead of the model.
            scenario._time_step = model.tick
            raise

    await scenario.register_model_handler(model_step=step, model_reset=model.reset)
    return scenario, view


async def serve(kind, model, port, view_type):
    scenario, _view = await build_scenario(model, view_type, port)
    print(
        f"TenSnap {kind} ({'rule' if model.provider is None else model.provider.mode}): "
        f"ws://127.0.0.1:{port}"
    )
    await scenario.run()
