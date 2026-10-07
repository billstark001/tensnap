"""Model-owned, MessagePack-safe state for CPU inference continuation.

This is part of the runnable example. Publication probes belong in
experiments/fire_dqn_replay, not in the model or the visualization launcher.
"""

from __future__ import annotations

import copy
import json
import random
from dataclasses import asdict, fields

import numpy as np
from tensnap.bindings.mesa import cleanup_mesa_model_step, restore_mesa_model_time

from .config import EnvConfig
from .model import EvacuationModel

STATE_SCHEMA = "fire-dqn-inference-v1"


def tuples(value):
    return (
        tuple(tuples(item) for item in value)
        if isinstance(value, (list, tuple))
        else value
    )


def capture_model(model: EvacuationModel) -> dict:
    def record(agent):
        result = {
            "id": agent.unique_id,
            "pos": list(agent.pos),
            "spawn_pos": list(agent.spawn_pos),
            "data": agent.data,
        }
        if agent is not model.guide:
            result.update(
                counted_evacuated=agent._counted_evacuated,
                counted_dead=agent._counted_dead,
            )
        return result

    return copy.deepcopy(
        {
            "config": asdict(model.config),
            "layout": {
                "width": model.width,
                "height": model.height,
                "exits": sorted(model.exit_cells),
                "walls": sorted(model.wall_cells),
            },
            "fire": sorted(model.fire_cells),
            "initial_fire_source": model.initial_fire_source,
            "step_count": model.step_count,
            "running": model.running,
            "mesa_time": getattr(model, "time", model.steps),
            "random": model.random.getstate(),
            # PCG64 uses integers larger than MessagePack's 64-bit limit.
            "numpy": json.dumps(model.rng.bit_generator.state, sort_keys=True),
            "guide": record(model.guide),
            "evacuees": [record(agent) for agent in model.evacuees],
            "collector": model.datacollector.model_vars,
            "collection_steps": getattr(model.datacollector, "_collection_steps", None),
        }
    )


def restore_model(model: EvacuationModel, saved: dict) -> None:
    """Validate first, then rebuild on the same registered model/config objects."""
    saved = copy.deepcopy(saved)
    config_data = saved["config"]
    for key in ("exits", "walls", "fire_sources"):
        config_data[key] = tuples(config_data[key])
    pending_config = EnvConfig(**config_data)
    config = copy.deepcopy(pending_config)
    if set(saved["layout"]) != {"width", "height", "exits", "walls"}:
        raise ValueError("invalid checkpoint layout fields")
    for key, value in saved["layout"].items():
        setattr(config, key, tuples(value))
    config.num_evacuees = len(saved["evacuees"])
    if (
        config.width < 4
        or config.height < 4
        or config.num_evacuees < 1
        or config.max_steps < 1
        or config.fire_spread_interval < 1
    ):
        raise ValueError("invalid checkpoint configuration")
    for key in ("random_move_bias", "guide_follow_bias", "fire_spread_probability"):
        if not 0 <= getattr(config, key) <= 1:
            raise ValueError("invalid checkpoint probability")

    def position(value):
        x, y = value
        if (
            type(x) is not int
            or type(y) is not int
            or not 0 <= x < config.width
            or not 0 <= y < config.height
        ):
            raise ValueError("invalid checkpoint position")
        return (x, y)

    exits, walls = set(config.exits), set(config.walls)
    if len(exits) != 2 or exits & walls:
        raise ValueError("invalid checkpoint layout")
    for value in (*exits, *walls, *config.fire_sources):
        position(value)
    fire = [position(value) for value in saved["fire"]]
    if len(fire) != len(set(fire)) or set(fire) & (exits | walls):
        raise ValueError("invalid checkpoint fire")
    records = [saved["guide"], *saved["evacuees"]]
    if len(records) != config.num_evacuees + 1:
        raise ValueError("invalid checkpoint population")
    ids = [row["id"] for row in records]
    if any(type(value) is not int or value < 1 for value in ids) or len(
        set(ids)
    ) != len(ids):
        raise ValueError("invalid checkpoint agent identities")
    if set(saved["guide"]["data"]) != {"preferred_exit"}:
        raise ValueError("invalid checkpoint guide data")
    if any(
        set(row["data"]) != {"alive", "evacuated", "target_exit"}
        for row in saved["evacuees"]
    ):
        raise ValueError("invalid checkpoint evacuee data")
    for row in records:
        if position(row["pos"]) in walls or position(row["spawn_pos"]) in walls:
            raise ValueError("agent in wall")
        target = row["data"].get("target_exit", row["data"].get("preferred_exit"))
        if target is not None and position(target) not in exits:
            raise ValueError("invalid checkpoint exit target")
    for row in saved["evacuees"]:
        if any(type(row["data"][key]) is not bool for key in ("alive", "evacuated")):
            raise ValueError("invalid checkpoint agent status")
        if any(
            type(row[key]) is not bool for key in ("counted_dead", "counted_evacuated")
        ):
            raise ValueError("invalid checkpoint reward counters")
    tick = saved["step_count"]
    if type(tick) is not int or tick < 0:
        raise ValueError("invalid checkpoint time")
    if type(saved["running"]) is not bool:
        raise ValueError("invalid checkpoint running flag")
    test_rng = random.Random()
    test_rng.setstate(tuples(saved["random"]))
    test_numpy = np.random.default_rng(0)
    test_numpy.bit_generator.state = json.loads(saved["numpy"])
    if set(saved["collector"]) != {"Alive", "Evacuated", "Dead", "Fire Size"}:
        raise ValueError("invalid checkpoint collector")
    if len({len(values) for values in saved["collector"].values()}) != 1:
        raise ValueError("invalid checkpoint collector history")
    if saved["initial_fire_source"] is not None:
        position(saved["initial_fire_source"])
    if saved["mesa_time"] != 0:
        raise ValueError("this model advances via env_step, not Mesa's scheduler")

    # Parameters hold references to this config; preserve that object identity.
    for field in fields(config):
        setattr(model.config, field.name, getattr(config, field.name))
    cleanup_mesa_model_step(model)
    EvacuationModel.__init__(model, model.config, seed=0)
    model.fire_cells = set(fire)
    model.initial_fire_source = tuples(saved["initial_fire_source"])
    for agent, row in zip([model.guide, *model.evacuees], records, strict=True):
        agent.unique_id = row["id"]
        model.grid.move_agent(agent, position(row["pos"]))
        agent.spawn_pos = position(row["spawn_pos"])
        for key, value in row["data"].items():
            setattr(agent, key, tuples(value))
        if agent is not model.guide:
            agent._counted_evacuated = row["counted_evacuated"]
            agent._counted_dead = row["counted_dead"]
    model.step_count = tick
    model.running = saved["running"]
    model.random.setstate(test_rng.getstate())
    model.rng.bit_generator.state = test_numpy.bit_generator.state
    restore_mesa_model_time(model, saved["mesa_time"])
    model.datacollector.model_vars = saved["collector"]
    if saved["collection_steps"] is not None:
        model.datacollector._collection_steps = list(saved["collection_steps"])
    # Structural sliders are pending reset values, distinct from the active grid.
    for field in fields(pending_config):
        setattr(model.config, field.name, getattr(pending_config, field.name))
