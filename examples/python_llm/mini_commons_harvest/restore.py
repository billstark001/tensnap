"""Restore complete resource cells and harvester records from a scene."""

from ..common.config import integer
from ..common.llm import text_field
from ..common.restore import agent_states, records
from .scenarios import MOVES


def restore_layers(model, layers):
    width, height = model.config.width, model.config.height
    for layer in layers.values():
        metadata = layer.get("metadata", {})
        if (
            metadata.get("width", width) != width
            or metadata.get("height", height) != height
        ):
            raise ValueError(
                "Projected grid dimensions disagree with model configuration"
            )
    if layers["grid"].get("items", []):
        raise ValueError("Grid layer must not contain items")
    cells = records(layers["resources"].get("items", []))
    expected = {f"cell:{y}:{x}" for y in range(height) for x in range(width)}
    if set(cells) != expected:
        raise ValueError("Projected resource grid must contain every cell exactly once")
    resources = [[0] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            item = cells[f"cell:{y}:{x}"]
            if (item["x"], item["y"]) != (x, height - 1 - y):
                raise ValueError(
                    "Projected cell coordinates disagree with cell identity"
                )
            data = item["data"]
            if (
                type(data["fertile"]) is not bool
                or data["fertile"] != model.habitat[y][x]
            ):
                raise ValueError(
                    "Projected fertility disagrees with the model landscape"
                )
            resources[y][x] = integer(
                data["value"],
                "resource",
                0,
                model.capacity if model.habitat[y][x] else 0,
            )

    players, events = list(agent_states(layers["agents"], model)), {}
    for player in players:
        player["y"] = height - 1 - integer(player["y"], "y", 0, height - 1)
        for event in player["history"]:
            if event["agent"] != player["id"] or event["tick"] in events:
                raise ValueError("Invalid projected activation identity")
            if event["action"] not in (*MOVES, "wait", "harvest"):
                raise ValueError("Invalid projected activation action")
            position = event["position"]
            if not isinstance(position, list) or len(position) != 2:
                raise ValueError("Invalid projected activation position")
            integer(position[0], "history x", 0, width - 1)
            integer(position[1], "history y", 0, height - 1)
            integer(event["gain"], "history gain", 0, 1)
            text_field(event, "message")
            events[event["tick"]] = event
    messages = [
        {
            "tick": tick,
            "agent": event["agent"],
            "x": event["position"][0],
            "y": event["position"][1],
            "message": event["message"],
        }
        for tick, event in sorted(events.items())
        if model.tick - tick < 2 * len(players) and event["message"]
    ]
    model.load_state(
        {
            "resources": resources,
            "agents": players,
            "messages": messages,
            "last_event": events.get(model.tick, {}),
        }
    )
