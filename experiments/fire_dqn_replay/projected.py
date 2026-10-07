"""Experiment-only non-exact baseline. Not part of the runnable example.

It restores visible positions, fire, statuses, target exits, parameters and
clock, retaining the advanced RNG, inference policy and collector history.
"""

from python_dqn.checkpoint import capture_model, restore_model


def restore_projected(manager, payload: dict) -> None:
    """Inverse of complete visible state; retains current RNG and policy.

    Collector history is private and is retained. Reward flags can be
    reconstructed from visible status. This deliberately is not exact.
    """
    saved = capture_model(manager.model)
    selected_policy = manager._guide_model
    seen = set()
    for change in payload.get("parameters", []):
        key, value = change["id"], change["value"]
        if key in seen:
            raise ValueError("duplicate projected parameter")
        seen.add(key)
        if key == "guideModel":
            if value not in manager.guide_model_options():
                raise ValueError("unknown guide model")
            selected_policy = value
        elif key in saved["config"]:
            saved["config"][key] = value
        else:
            raise ValueError("unknown projected parameter")
    envs = payload.get("envs", [])
    if envs:
        if len(envs) != 1 or envs[0]["id"] != "evacuation" or envs[0]["type"] != "2d":
            raise ValueError("invalid projected environment")
        layers = {layer["layer_id"]: layer for layer in envs[0]["layers"]}
        if len(layers) != len(envs[0]["layers"]) or set(layers) != {
            "grid",
            "fire_cells",
            "wall_cells",
            "exit_cells",
            "evacuees",
            "guides",
            "evacuee_trails",
        }:
            raise ValueError("invalid projected layers")
        current = {
            layer["layer_id"]: layer
            for layer in manager.scenario.environments["evacuation"].build_state()[
                "layers"
            ]
        }
        for layer in layers.values():
            expected_type = (
                "grid"
                if layer["layer_id"] == "grid"
                else (
                    "trajectory" if layer["layer_id"] == "evacuee_trails" else "agent"
                )
            )
            if "metadata" in layer and layer["metadata"] != current[
                layer["layer_id"]
            ].get("data", {}):
                raise ValueError("projected restore cannot change layer metadata")
            if expected_type in ("grid", "trajectory") and layer.get("items", []):
                raise ValueError("metadata-only layer cannot have items")
            if layer["layer_type"] != expected_type:
                raise ValueError("invalid projected layer type")
            dependencies = (
                {"agent": "evacuees"} if expected_type == "trajectory" else {}
            )
            if layer.get("dependency_layer_ids", {}) != dependencies:
                raise ValueError("invalid projected dependencies")
        for key in ("wall_cells", "exit_cells", "fire_cells"):
            cells = layers[key]["items"]
            coordinates = [(item["x"], item["y"]) for item in cells]
            if len(coordinates) != len(set(coordinates)) or any(
                item["id"] != str(pos)
                for item, pos in zip(cells, coordinates, strict=True)
            ):
                raise ValueError("invalid projected cells")
            if key == "fire_cells":
                saved["fire"] = coordinates
            elif set(coordinates) != set(
                manager.model.wall_cells
                if key == "wall_cells"
                else manager.model.exit_cells
            ):
                raise ValueError("projected restore cannot change the fixed layout")
        for key, records in (
            ("guides", [saved["guide"]]),
            ("evacuees", saved["evacuees"]),
        ):
            items = layers[key]["items"]
            incoming = {item["id"]: item for item in items}
            if len(incoming) != len(items) or set(incoming) != {
                row["id"] for row in records
            }:
                raise ValueError("invalid projected population")
            for row in records:
                item = incoming[row["id"]]
                row.update(pos=[item["x"], item["y"]], data=item["data"])
                if key == "evacuees":
                    row.update(
                        counted_evacuated=item["data"]["evacuated"],
                        counted_dead=not item["data"]["alive"]
                        and not item["data"]["evacuated"],
                    )
    if "time" in payload:
        saved["step_count"] = payload["time"]
        saved["running"] = saved["step_count"] < saved["config"]["max_steps"] and any(
            row["data"]["alive"] and not row["data"]["evacuated"]
            for row in saved["evacuees"]
        )
    restore_model(manager.model, saved)
    manager._guide_model = selected_policy
