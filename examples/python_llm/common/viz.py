"""Shared TenSnap lifecycle and controls; model packages supply their views."""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Annotated

from tensnap import (
    BindParameterConfig,
    SimulationScenario,
    action,
    monitor,
    scene_restore,
)

from .config import integer
from .restore import prepare_restore

POLICIES = ("rule", "llm", "replay")


@scene_restore(
    time="restore_time",
    validate="validate_scene",
    before_apply="begin_scene_restore",
    after_apply="finish_scene_restore",
    checkpoint_capture="capture",
    checkpoint_restore="restore",
)
class ModelView:
    initial_options = ()
    selected_agent: Annotated[
        int, BindParameterConfig("number", min=0, max=199, step=1)
    ]
    seed: Annotated[
        int,
        BindParameterConfig(
            "number", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
    ]
    policy: Annotated[str, BindParameterConfig("enum", options=list(POLICIES))]
    scenario: Annotated[
        str,
        BindParameterConfig(
            "enum",
            options=lambda view: [*view.scenarios, "custom"],
            allow_runtime_change=False,
        ),
    ]

    def __init__(self, model, *, providers=None) -> None:
        self.model = model
        self._selected_agent = 0
        self._seed = model.config.seed
        self._providers = dict(providers or {})
        if model.provider is not None:
            self._providers[model.provider.mode] = model.provider
        # Keep a default provider for budgets and legacy checkpoints that only
        # distinguished rule decisions from provider-backed decisions.
        self._provider = (
            model.provider
            or self._providers.get("llm")
            or self._providers.get("replay")
        )
        self._policy = self.active_policy
        self._policy_reset_pending = False
        self._step_tick = None
        self._policy_changes = [self._policy_boundary()]
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
        self._policy_reset_pending = False

    @property
    def policy_apply_at(self):
        if self.policy == self.active_policy:
            return "active"
        return (
            "reset"
            if self._policy_reset_pending
            or "replay" in (self.policy, self.active_policy)
            else "next_step"
        )

    def policy_status(self):
        return {
            "requested_policy": self.policy,
            "current_step_policy": (
                self.active_policy if self._step_tick is not None else None
            ),
            "current_step": self._step_tick,
            "next_step_policy": (
                self.active_policy if self.policy_apply_at == "reset" else self.policy
            ),
            "effective_when": self.policy_apply_at,
            "recent_changes": [dict(item) for item in self._policy_changes[-8:]],
        }

    def _policy_boundary(self):
        return {"after_tick": self.model.tick, "policy": self.active_policy}

    async def step(self):
        """Apply a pending policy once; keep that provider through all awaits."""
        completed = False
        try:
            if self.policy_apply_at == "next_step":
                self.model.provider = self._provider_for_policy(self.policy)
                self._policy_changes.append(self._policy_boundary())
            self._step_tick = self.model.tick + 1
            await self.simulation.broadcast_monitors()
            await self.model.step()
            completed = True
        finally:
            self._step_tick = None
            if not completed:
                # The default handler already advanced the protocol clock.
                self.simulation.set_time_step(self.model.tick)
                await self.simulation.broadcast_monitors()

    def _provider_for_policy(self, policy):
        if policy == "rule":
            return None
        if policy not in POLICIES:
            raise ValueError("policy must be rule, llm or replay")
        if policy not in self._providers:
            if policy == "llm":
                raise ValueError(
                    "LLM credentials are not configured; supply --env-file or API key environment variables when starting the server"
                )
            raise ValueError(
                "Start the server with --policy replay --replay PATH to configure replay"
            )
        return self._providers[policy]

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
        for provider in self._providers.values():
            provider.cursor = 0
        self._policy_reset_pending = False
        self._policy_changes = [self._policy_boundary()]
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

    @monitor(
        "inference", "Policy / inference budget (never rewinds)", render_hint="tree"
    )
    def inference(self):
        status = self._provider.status() if self._provider else {"mode": "rule"}
        if len(self._providers) > 1:
            status = {
                **status,
                "providers": {
                    mode: provider.status()
                    for mode, provider in self._providers.items()
                },
            }
        return {
            **status,
            "active_policy": self.active_policy,
            "available_policies": ["rule", *self._providers],
            "policy": self.policy_status(),
        }

    @monitor("metrics", "Current metrics", render_hint="tree")
    def metrics(self):
        return self.model.metrics()

    @property
    def active_policy(self):
        return self.model.provider.mode if self.model.provider else "rule"

    def validate_scene(self, payload):
        """Validate model values on a detached candidate before the transaction."""
        self._restored_model = prepare_restore(self, payload)

    def begin_scene_restore(self, payload):
        if "envs" not in payload:
            return
        restored = self._restored_model
        # Only changed constructor settings need a fresh structural model.
        # Layer inverses then install the validated public state.
        if self.model.config != restored.config:
            base = type(self.model)(restored.config)
            base.rng, base.policy_rng, base.tick = (
                self.model.rng,
                self.model.policy_rng,
                self.model.tick,
            )
            self.model._install(base)
        self.model.provider = restored.provider
        self._active_scenario = None
        self._refresh_selection()

    def restore_derived(self, value):
        """Derived layers and metadata were checked against active configuration."""

    def restore_agents(self, items):
        self.model.agents = self._restored_model.agents

    def restore_time(self, value):
        self.model.tick = integer(value, "restore time", 0, 10**9)
        self.simulation.set_time_step(self.model.tick)

    def finish_scene_restore(self, payload):
        if "envs" in payload:
            self.restore_measurements(self._restored_model)
        if "envs" in payload or "time" in payload:
            # A projected scene has no policy-change history or provider cursors.
            self._policy_changes = [self._policy_boundary()]
        self._refresh_selection()
        self._restored_model = None

    @action("reseed", "Reset with next seed")
    async def reseed(self):
        self.seed = (self.seed + 1) % 2**32
        await self.simulation.reset()

    def capture(self):
        if self._step_tick is not None:
            raise ValueError("Checkpoint capture requires a completed Step")
        return {
            "model": self.model.capture(),
            "selected_agent": self.selected_agent,
            "controls": {
                "seed": self.seed,
                "policy": self.policy,
                "active_policy": self.active_policy,
                "policy_apply_at": self.policy_apply_at,
                "provider_cursors": {
                    mode: provider.cursor for mode, provider in self._providers.items()
                },
                "policy_changes": [dict(item) for item in self._policy_changes],
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
        active_policy = controls.get("active_policy")
        if active_policy is None:
            provider = self._provider if saved["model"]["uses_provider"] else None
        else:
            provider = self._provider_for_policy(active_policy)
        if saved["model"]["uses_provider"] and provider is None:
            raise ValueError("Checkpoint requires a configured decision provider")
        active_policy = provider.mode if provider else "rule"
        policy = controls.get("policy", active_policy)
        self._provider_for_policy(policy)
        apply_at = controls.get(
            "policy_apply_at", "reset" if policy != active_policy else "active"
        )
        if (
            apply_at not in ("active", "next_step", "reset")
            or (apply_at == "active" and policy != active_policy)
            or (apply_at == "next_step" and "replay" in (policy, active_policy))
        ):
            raise ValueError("Invalid checkpoint policy application boundary")
        cursors, changes = self._restore_policy_state(
            controls, saved["model"], active_policy
        )
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
        for mode, tape in self._providers.items():
            tape.cursor = cursors.get(
                mode, saved["model"]["decision_cursor"] if tape is provider else 0
            )
        self._policy_changes = changes
        self._policy_reset_pending = apply_at == "reset"
        self._seed, self._policy, self._pending_scenario = seed, policy, pending
        self._active_scenario, self._pending_options = active, dict(options)
        self._selected_agent = selected
        self._refresh_selection()
        self.simulation.set_time_step(self.model.tick)

    @staticmethod
    def _restore_policy_state(controls, model, active):
        cursors = controls.get("provider_cursors", {})
        if not isinstance(cursors, dict) or set(cursors) - {"llm", "replay"}:
            raise ValueError("Invalid checkpoint provider cursors")
        cursors = {
            mode: integer(cursor, f"{mode} cursor", 0, 10**9)
            for mode, cursor in cursors.items()
        }
        if active in cursors and cursors[active] != model["decision_cursor"]:
            raise ValueError("Active provider cursor disagrees with model checkpoint")
        changes = controls.get(
            "policy_changes", [{"after_tick": model["tick"], "policy": active}]
        )
        if not isinstance(changes, list) or not changes:
            raise ValueError("Invalid checkpoint policy changes")
        previous, restored = 0, []
        for item in changes:
            if not isinstance(item, dict) or item.get("policy") not in POLICIES:
                raise ValueError("Invalid checkpoint policy change")
            previous = integer(
                item.get("after_tick"), "policy change tick", previous, model["tick"]
            )
            restored.append({"after_tick": previous, "policy": item["policy"]})
        if restored[-1]["policy"] != active:
            raise ValueError("Policy change history disagrees with active policy")
        return cursors, restored


async def build_scenario(model, view_type, port=8765, *, providers=None):
    view = view_type(model, providers=providers)
    scenario = SimulationScenario(
        host="127.0.0.1",
        port=port,
        step_interval=0.1,
        model_id=model.model_id,
        state_schema_version=str(model.checkpoint_version),
    )
    view.simulation = scenario
    scenario.add_all(view)
    scenario.parameters["selected_agent"].max = len(model.agents) - 1

    async def reset():
        view.reset()
        # A preset can change several controls together. Refresh the cached
        # wire values as well as getters before reset reconciles definitions.
        for param_id, parameter in scenario.parameters.items():
            current = scenario.get_parameter(param_id)
            if parameter.value != current:
                parameter.value = current
                await scenario.server.broadcast_param_sync(param_id, current)

    await scenario.register_model_handler(
        model_init=lambda: scenario.set_time_step(model.tick),
        model_step=view.step,
        model_reset=reset,
    )
    on_param_change = scenario.server.on_param_change

    async def param_change(ws, payload):
        await on_param_change(ws, payload)
        if payload.get("id") == "policy":
            await scenario.broadcast_monitors()

    scenario.server.on_param_change = param_change
    return scenario, view


async def serve(kind, model, port, view_type, *, providers=None):
    scenario, view = await build_scenario(model, view_type, port, providers=providers)
    print(
        f"TenSnap {kind} ({view.active_policy}): "
        f"ws://127.0.0.1:{port}; available policies: {', '.join(['rule', *view._providers])}"
    )
    for provider in view._providers.values():
        if provider.config is not None:
            print(
                "LLM effective settings: "
                + json.dumps(provider.config.effective_settings(), ensure_ascii=False)
            )
    await scenario.run()
