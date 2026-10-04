"""Publication audit sidecar; not part of the teaching Schelling example.

Imported only by the opt-in headless launcher. Reads live model fields without
calling the checkpoint serializer.
"""

import json
from pathlib import Path

from schelling import SchellingModel


def audit_state(model: SchellingModel) -> dict:
    return {
        "time": model.tick,
        "state": {
            "width": model.width, "height": model.height,
            "density": model.density, "balance": model.balance,
            "similarityThreshold": model.similarity_threshold,
            "tick": model.tick, "last_swapped": model.last_swapped,
            "random_state": model.random.getstate(),
            "numpy_state": model.rng.bit_generator.state,
            "agents": [{"id": agent.unique_id, "x": agent.cell.coordinate[0],
                        "y": agent.cell.coordinate[1], "group": agent.group}
                       for agent in model.agents],
        },
        "metrics": {"satisfaction_rate": model.satisfied_pct(),
                    "segregation_index": model.segregation_index(),
                    "moved": model.last_swapped, "population": len(model.agents)},
    }


def audit_writer(path: str):
    destination = Path(path)

    def write(model: SchellingModel) -> None:
        temporary = destination.with_name(destination.name + ".tmp")
        temporary.write_text(json.dumps(audit_state(model), sort_keys=True))
        temporary.replace(destination)

    return write
