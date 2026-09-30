from __future__ import annotations

from model import SchellingModel


def canonical_state(model: SchellingModel) -> dict:
    """Project model state into the cross-renderer benchmark oracle shape."""
    return {
        "agents": sorted(
            (
                {
                    "id": str(agent.unique_id),
                    "x": agent.cell.coordinate[0],
                    "y": agent.cell.coordinate[1],
                    "color": "#3498db" if agent.group == 1 else "#e74c3c",
                    "size": 1.0 if agent.is_satisfied() else 0.6,
                }
                for agent in model.agents
            ),
            key=lambda agent: agent["id"],
        )
    }
