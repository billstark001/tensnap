import asyncio
import os
from typing import Any

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401

from tensnap import (
    BoundModelReinitializer,
    SimulationScenario,
)

from cgol import GameOfLife

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(
    port=server_port,
    use_msgpack=True,
    model_id="examples.python_mesa.cgol",
    state_schema_version="1",
)

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50

model = GameOfLife(width=MODEL_WIDTH, height=MODEL_HEIGHT)
reinitializer = BoundModelReinitializer(model)


def reset_cell_diff_cache() -> None:
    """Keep restore correct with v0.3 bindings released before the cache fix."""
    environment = scenario.environments.get("cgol_grid")
    if environment is not None and "cells" in environment.layers:
        scenario.set_layer_target("cgol_grid", "cells", model)


def restore_checkpoint(checkpoint: bytes) -> None:
    """Restore the model and keep constructor-backed parameters canonical."""
    model.restore_checkpoint(checkpoint)
    reinitializer.width = model.width
    reinitializer.height = model.height
    reset_cell_diff_cache()


def restore_scene(payload: dict[str, Any]) -> None:
    model.restore_scene(payload)
    for parameter in payload.get("parameters", []):
        if parameter["id"] in {"width", "height"}:
            setattr(reinitializer, parameter["id"], int(parameter["value"]))
    reset_cell_diff_cache()


# Main function
async def main() -> None:
    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)
    scenario.configure_scene_restore(
        restore_scene,
        checkpoint_capture=model.capture_checkpoint,
        checkpoint_restore=restore_checkpoint,
    )
    await scenario.register_model_handler(
        model_init=reinitializer.model_init,
        model_step=lambda: model.step(),
        model_reset=reinitializer.model_reset,
    )

    print(
        f"TenSnap Game of Life visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
