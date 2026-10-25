"""Restore the graph and player data published in a Naming scene."""

from ..common.config import integer
from ..common.llm import text_field
from ..common.restore import agent_states


def restore_layers(model, layers):
    players = list(agent_states(layers["agents"], model))
    ids, events = {player["id"] for player in players}, {}
    for player in players:
        integer(player["score"], "score", -model.tick, model.tick)
        for event in player["history"]:
            if event["partner"] not in ids - {player["id"]}:
                raise ValueError("Invalid projected interaction partner")
            success = event["own"] == event["other"]
            if type(event["success"]) is not bool or event["success"] != success:
                raise ValueError("Invalid projected interaction outcome")
            if event["payoff"] != (1 if success else -1):
                raise ValueError("Invalid projected payoff")
            pair = sorted((player["id"], event["partner"]))
            names = [event["own"], event["other"]]
            record = {
                "tick": event["tick"],
                "players": pair,
                "names": names if pair[0] == player["id"] else names[::-1],
                "success": success,
            }
            if event["tick"] in events and events[event["tick"]] != record:
                raise ValueError("Conflicting projected interaction histories")
            events[event["tick"]] = record
        decision = player["last_decision"]
        if not isinstance(decision, dict) or (
            "name" in decision and decision["name"] not in ("Q", "M")
        ):
            raise ValueError("Invalid projected last decision")
        text_field(decision, "note", limit=None)

    contacts = _edges(layers["contacts"], ids)
    expected = {
        tuple(sorted((model.network.agent_ids[a], model.network.agent_ids[b])))
        for a, b in (sorted(edge) for edge in model.network.graph.edges)
    }
    if set(contacts) != expected:
        raise ValueError(
            "Projected contacts disagree with the active model configuration"
        )
    edges = []
    for pair, item in _edges(layers["interactions"], ids).items():
        data = item.get("data")
        if data is None:
            # Older scenes have no edge timing; bounded player memories may
            # still supply it. Never invent a timestamp for an unknown edge.
            matches = [
                event for event in events.values() if event["players"] == list(pair)
            ]
            if not matches:
                raise ValueError(
                    "Older snapshot lacks interaction timing for this edge"
                )
            data = max(matches, key=lambda event: event["tick"])
        tick = integer(
            data["tick"], "interaction tick", max(1, model.tick - 11), model.tick
        )
        if type(data["success"]) is not bool:
            raise ValueError("Invalid projected edge outcome")
        edges.append(
            {
                "source": pair[0],
                "target": pair[1],
                "tick": tick,
                "success": data["success"],
            }
        )
    total = sum(player["score"] for player in players) + 2 * model.tick
    if total % 4 or not 0 <= total // 4 <= model.tick:
        raise ValueError("Projected scores disagree with model time")
    # Translate the projection into the model's existing, validated state format.
    model.load_state(
        {
            "agents": players,
            "successes": total // 4,
            "recent_edges": edges,
            "last_interaction": events.get(model.tick, {}),
            "treatment_tick": 0,
            "events": [
                events[tick]
                for tick in sorted(events)
                if tick > model.tick - 4 * len(players)
            ],
        }
    )


def _edges(layer, ids):
    result = {}
    for item in layer.get("items", []):
        pair = (item["source"], item["target"])
        if (
            not all(isinstance(identity, str) and identity in ids for identity in pair)
            or pair[0] == pair[1]
            or item.get("directed", False) is not False
        ):
            raise ValueError("Invalid or duplicate projected edge")
        pair = tuple(sorted(pair))
        if pair in result:
            raise ValueError("Duplicate projected edge")
        result[pair] = item
    return result
