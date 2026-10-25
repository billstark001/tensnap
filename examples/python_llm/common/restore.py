"""Validated inverse of public scene data, without restoring RNGs or LLM cursors."""

from __future__ import annotations

import copy

from .config import integer


def records(items, key="id"):
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError("Layer items must be a list of records")
    result = {}
    for item in items:
        identity = item[key]
        if not isinstance(identity, str) or identity in result:
            raise ValueError("Invalid or duplicate item identity")
        result[identity] = item
    return result


def agent_states(layer, model):
    """Translate inspection records to owned model state in stable agent order."""
    items = records(layer.get("items", []))
    identities = [f"agent_{index}" for index in range(model.config.agents)]
    if set(items) != set(identities):
        raise ValueError(
            "Projected agent identities must match the configured population"
        )
    for identity in identities:
        item = items[identity]
        state = copy.deepcopy(item["data"])
        state.update(id=identity, x=item["x"], y=item["y"])
        state["history"] = state.pop("recent_interactions")
        validate_history(state["history"], model.config.memory, model.tick)
        yield state


def validate_history(events, memory, tick):
    if not isinstance(events, list) or len(events) > memory:
        raise ValueError("Invalid projected agent memory")
    previous = 0
    for event in events:
        if not isinstance(event, dict):
            raise TypeError("Invalid projected history record")
        previous = integer(event["tick"], "history tick", previous + 1, tick)


def prepare_restore(view, payload):
    """Decode a detached model and check pending controls before any live mutation.

    TenSnap's declarative plan already checks topology, dependencies and parameter
    types. This function checks the example's model values and control semantics.
    """
    model = copy.copy(view.model)
    if "envs" in payload:
        envs = payload["envs"]
        if len(envs) != 1 or envs[0]["id"] != "main":
            raise ValueError("Restore requires the complete main environment")
        layers = {layer["layer_id"]: layer for layer in envs[0]["layers"]}
        metadata = layers["agents"].get("metadata", {})
        config = (
            view.model.config_type(**metadata["model_config"])
            if "model_config" in metadata
            else view.model.config
        )
        model = type(view.model)(config)
        model.provider = view._provider_for_policy(
            metadata.get("active_policy", view.active_policy)
        )
    model.tick = integer(payload.get("time", view.model.tick), "restore time", 0, 10**9)
    if "envs" in payload:
        view.restore_layers(model, layers)
    elif "time" in payload:
        for player in model.agents:
            validate_history(player.history, model.config.memory, model.tick)

    # Setters replace immutable configs and pending option dictionaries, so a
    # shallow view copy isolates controls without copying clients or RNGs.
    controls = copy.copy(view)
    controls.model, controls.simulation = model, None
    changes = {
        change["id"]: change["value"] for change in payload.get("parameters", [])
    }
    if "scenario" in changes:
        controls.scenario = changes["scenario"]
    options = dict(controls._pending_options)
    for name, value in changes.items():
        option = "agents" if name == "agent_count" else name
        if option in controls.initial_options:
            parameter = view.simulation.parameters[name]
            options[option] = (
                integer(value, name, parameter.min, parameter.max)
                if option in ("agents", "degree")
                else value
            )
        elif name not in ("scenario", "selected_agent"):
            setattr(controls, name, value)
    controls._configure(model.config, controls._pending_scenario, options)
    integer(
        changes.get("selected_agent", min(view.selected_agent, len(model.agents) - 1)),
        "selected_agent",
        0,
        len(model.agents) - 1,
    )
    return model
