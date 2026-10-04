"""Optional exact Schelling checkpoint for the headless publication experiment.

This is not required for the teaching example. A much smaller projected scene
restore can move agents, parameters, and time back, but may omit RNG state and
other private fields needed to replay the same future exactly.
"""

import copy
import json

from tensnap import cleanup_mesa_model_step, restore_mesa_model_time

from schelling import SchellingAgent, SchellingModel


def _tuples(value):
    return tuple(_tuples(item) for item in value) if isinstance(value, list) else value


def capture_checkpoint(model: SchellingModel) -> dict:
    return {
        "width": model.width, "height": model.height,
        "density": model.density, "balance": model.balance,
        "similarity_threshold": model.similarity_threshold,
        "collect_data": model.collect_data,
        "time": model.tick, "running": model.running,
        "last_swapped": model.last_swapped,
        "random_state": model.random.getstate(),
        # PCG64 has 128-bit integers, which MessagePack cannot encode directly.
        "numpy_state_json": json.dumps(model.rng.bit_generator.state),
        "agents": [{"id": a.unique_id, "coordinate": list(a.cell.coordinate),
                    "group": a.group} for a in model.agents],
        "collector": {
            "model_vars": copy.deepcopy(model.datacollector.model_vars),
            "collection_steps": list(model.datacollector._collection_steps),
            "agent_records": {str(k): v for k, v in model.datacollector._agent_records.items()},
        },
    }


def restore_checkpoint(model: SchellingModel, saved: dict) -> None:
    if not isinstance(saved, dict) or not isinstance(saved.get("agents"), list):
        raise ValueError("invalid Schelling checkpoint")
    width, height = int(saved["width"]), int(saved["height"])
    if width <= 0 or height <= 0:
        raise ValueError("invalid Schelling grid dimensions")
    positions = set()
    for agent in saved["agents"]:
        x, y = agent["coordinate"]
        if not (0 <= x < width and 0 <= y < height) or (x, y) in positions:
            raise ValueError("invalid or duplicate Schelling position")
        positions.add((x, y))

    cleanup_mesa_model_step(model)
    type(model).__init__(model, width=width, height=height, density=0,
                         balance=float(saved["balance"]),
                         similarity_threshold=float(saved["similarity_threshold"]),
                         collect_data=False, rng=0)
    for agent in saved["agents"]:
        x, y = agent["coordinate"]
        SchellingAgent(model, model.grid[(x, y)], int(agent["group"]))

    model.density = float(saved["density"])
    model.collect_data = bool(saved["collect_data"])
    model.random.setstate(_tuples(saved["random_state"]))
    model.rng.bit_generator.state = json.loads(saved["numpy_state_json"])
    restore_mesa_model_time(model, saved["time"])
    model.tick = int(saved["time"])
    model.last_swapped = int(saved["last_swapped"])
    model.running = bool(saved["running"])
    collector = saved["collector"]
    model.datacollector.model_vars = {k: list(v) for k, v in collector["model_vars"].items()}
    model.datacollector._collection_steps = list(collector["collection_steps"])
    model.datacollector._agent_records = {float(k): [tuple(v) for v in records]
                                          for k, records in collector["agent_records"].items()}
