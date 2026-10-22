"""Exact continuation of scientific state and both model-owned RNGs.

DataCollector/chart history is observational output and starts a new segment on
restore. The checkpoint uses no private collector fields. Historical schema-2
checkpoints require their original source revision.
"""

import json

from schelling import SchellingAgent, SchellingModel
from tensnap import cleanup_mesa_model_step, restore_mesa_model_time
from tensnap.bindings.mesa import prepare_mesa_model_reinit


def _tuples(value):
    return tuple(_tuples(item) for item in value) if isinstance(value, list) else value


def capture_checkpoint(model: SchellingModel) -> dict:
    return {
        "seed": model.seed,
        "width": model.width,
        "height": model.height,
        "density": model.density,
        "balance": model.balance,
        "similarity_threshold": model.similarity_threshold,
        "collect_data": model.collect_data,
        "time": model.tick,
        "running": model.running,
        "last_swapped": model.last_swapped,
        "random_state": model.random.getstate(),
        # PCG64 has 128-bit integers, which MessagePack cannot encode directly.
        "numpy_state_json": json.dumps(model.rng.bit_generator.state),
        "agents": [
            {"id": a.unique_id, "coordinate": list(a.cell.coordinate), "group": a.group}
            for a in model.agents
        ],
    }


def _apply_checkpoint(model: SchellingModel, saved: dict) -> None:
    if not isinstance(saved, dict) or not isinstance(saved.get("agents"), list):
        raise TypeError("invalid Schelling checkpoint")
    width, height = int(saved["width"]), int(saved["height"])
    if width <= 0 or height <= 0:
        raise ValueError("invalid Schelling grid dimensions")
    positions = set()
    for agent in saved["agents"]:
        x, y = agent["coordinate"]
        if not (0 <= x < width and 0 <= y < height) or (x, y) in positions:
            raise ValueError("invalid or duplicate Schelling position")
        positions.add((x, y))

    prepare_mesa_model_reinit(model)
    type(model).__init__(
        model,
        width=width,
        height=height,
        density=0,
        balance=float(saved["balance"]),
        similarity_threshold=float(saved["similarity_threshold"]),
        collect_data=False,
        seed=int(saved["seed"]),
    )
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
    if model.collect_data:
        model.datacollector.collect(model)


def restore_checkpoint(model: SchellingModel, saved: dict) -> None:
    candidate = SchellingModel(width=1, height=1, density=0, collect_data=False)
    try:
        _apply_checkpoint(candidate, saved)
    finally:
        cleanup_mesa_model_step(candidate)
    _apply_checkpoint(model, saved)
