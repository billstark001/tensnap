"""Shared TenSnap lifecycle and controls; model packages supply their views."""

from __future__ import annotations

from dataclasses import replace
from typing import Annotated

from tensnap import (
    BindParameterConfig,
    NumberParameter,
    SimulationScenario,
    action,
    monitor,
    params,
)

from .config import integer


class ModelView:
    initial_options = ()
    selected_agent: int
    seed: int
    policy: Annotated[
        str,
        BindParameterConfig(
            "enum", options=["rule", "llm", "replay"], allow_runtime_change=False
        ),
    ]
    scenario: Annotated[
        str,
        BindParameterConfig(
            "enum",
            options=lambda view: [*view.scenarios, "custom"],
            allow_runtime_change=False,
        ),
    ]

    def __init__(self, model) -> None:
        self.model = model
        self._selected_agent = 0
        self._seed = model.config.seed
        self._provider = model.provider
        self._policy = model.provider.mode if model.provider else "rule"
        self._pending_scenario = None
        self._active_scenario = None
        self._pending_options = {}
        self.simulation = None

    @property
    def seed(self) -> int:
        return self._seed

    @seed.setter
    def seed(self, value) -> None:
        self._seed = integer(value, "seed", 0, 2**32 - 1)

    @property
    def policy(self) -> str:
        return self._policy

    @policy.setter
    def policy(self, value) -> None:
        self._provider_for_policy(value)
        self._policy = value

    def _provider_for_policy(self, policy):
        if policy == "rule":
            return None
        if policy not in ("llm", "replay"):
            raise ValueError("policy must be rule, llm or replay")
        if self._provider is None or self._provider.mode != policy:
            raise ValueError(f"Start the server with --policy {policy} to configure it")
        return self._provider

    @property
    def scenario(self) -> str:
        if self._pending_scenario is not None:
            return self._pending_scenario
        if self._active_scenario == "custom" or (
            self._active_scenario in self.scenarios
            and self.scenarios[self._active_scenario].matches(self.model.config)
        ):
            return self._active_scenario
        return next(
            (
                name
                for name, item in self.scenarios.items()
                if item.matches(self.model.config)
            ),
            "custom",
        )

    @scenario.setter
    def scenario(self, value) -> None:
        self._validate_scenario(value, self.model.config)
        self._pending_scenario = value
        self._pending_options = {}

    def _validate_scenario(self, name, config):
        if name == "custom":
            return
        if name not in self.scenarios:
            raise ValueError(f"Unknown scenario: {name}")
        self.scenarios[name].configure(config)

    def _configure(self, config, preset, options):
        if set(options) - set(self.initial_options):
            raise ValueError("Unknown initialization option")
        if preset is not None and preset != "custom":
            config = self.scenarios[preset].configure(config)
        return replace(config, **options)

    def _initial_value(self, name):
        return self._pending_options.get(name, getattr(self.model.config, name))

    def _set_initial_option(self, name, value):
        options = {**self._pending_options, name: value}
        self._configure(self.model.config, self._pending_scenario, options)
        self._pending_options = options

    def _refresh_selection(self):
        self._selected_agent = min(self._selected_agent, len(self.model.agents) - 1)
        if self.simulation is not None:
            self.simulation.parameters["selected_agent"].max = (
                len(self.model.agents) - 1
            )

    def reset(self):
        config = self._configure(
            self.model.config, self._pending_scenario, self._pending_options
        )
        config = replace(config, seed=self.seed)
        provider = self._provider_for_policy(self.policy)
        old_config, old_provider = self.model.config, self.model.provider
        self.model.config, self.model.provider = config, provider
        try:
            self.model.reset()
        except BaseException:
            self.model.config, self.model.provider = old_config, old_provider
            raise
        self._active_scenario = self._pending_scenario or self._active_scenario
        self._pending_scenario = None
        self._pending_options = {}
        self._refresh_selection()

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
        return self._provider.status() if self._provider else {"mode": "rule"}

    @monitor("metrics", "Current metrics", render_hint="tree")
    def metrics(self):
        return self.model.metrics()

    @action("reseed", "Reset with next seed")
    async def reseed(self):
        self.seed = (self.seed + 1) % 2**32
        await self.simulation.reset()

    def capture(self):
        return {
            "model": self.model.capture(),
            "selected_agent": self.selected_agent,
            "controls": {
                "seed": self.seed,
                "policy": self.policy,
                "scenario": self._pending_scenario,
                "active_scenario": self._active_scenario,
                "options": dict(self._pending_options),
            },
        }

    def restore(self, saved):
        config = self.model.config_type(**saved["model"]["config"])
        selected = integer(
            saved["selected_agent"], "selected_agent", 0, config.agents - 1
        )
        controls = saved.get("controls", {})
        seed = integer(controls.get("seed", config.seed), "seed", 0, 2**32 - 1)
        provider = self._provider if saved["model"]["uses_provider"] else None
        if saved["model"]["uses_provider"] and provider is None:
            raise ValueError("Checkpoint requires a configured decision provider")
        policy = controls.get("policy", provider.mode if provider else "rule")
        self._provider_for_policy(policy)
        pending = controls.get("scenario")
        if pending is not None:
            self._validate_scenario(pending, config)
        active = controls.get("active_scenario")
        if active is not None and active != "custom" and active not in self.scenarios:
            raise ValueError(f"Unknown scenario: {active}")
        options = controls.get("options", {})
        self._configure(config, pending, options)
        old_provider = self.model.provider
        self.model.provider = provider
        try:
            self.model.restore(saved["model"])
        except BaseException:
            self.model.provider = old_provider
            raise
        self._seed, self._policy, self._pending_scenario = seed, policy, pending
        self._active_scenario, self._pending_options = active, dict(options)
        self._selected_agent = selected
        self._refresh_selection()
        self.simulation.set_time_step(self.model.tick)


def controls(extra, *, include=()):
    return params(
        include=["selected_agent", "seed", "policy", "scenario", *extra, *include],
        custom_bindings={
            "selected_agent": NumberParameter("", min=0, max=199, step=1),
            "seed": NumberParameter(
                "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
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
    view.simulation = scenario
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
    # The adapter owns protocol clock synchronization; the model owns RNG state.
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
            scenario.set_time_step(model.tick)
            raise

    async def reset():
        view.reset()
        # A preset can change several controls together. Refresh the cached
        # wire values as well as getters before reset reconciles definitions.
        for param_id, parameter in scenario.parameters.items():
            current = scenario.get_parameter(param_id)
            if parameter.value != current:
                parameter.value = current
                await scenario.server.broadcast_param_sync(param_id, current)

    await scenario.register_model_handler(model_step=step, model_reset=reset)
    return scenario, view


async def serve(kind, model, port, view_type):
    scenario, _view = await build_scenario(model, view_type, port)
    print(
        f"TenSnap {kind} ({'rule' if model.provider is None else model.provider.mode}): "
        f"ws://127.0.0.1:{port}"
    )
    await scenario.run()
