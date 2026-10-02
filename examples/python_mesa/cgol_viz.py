import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401
from cgol import GameOfLife
from tensnap import (
    BoundModelReinitializer,
    SimulationScenario,
)
from tensnap.bindings import scene_restore_binding

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


def restore_checkpoint(checkpoint: bytes) -> None:
    """Restore the model and keep constructor-backed parameters canonical."""
    model.restore_checkpoint(checkpoint)
    reinitializer.width = model.width
    reinitializer.height = model.height


# Main function
async def main() -> None:
    reinitializer.register_model(scenario)
    reinitializer.configure_reinit(scenario)
    # The model owns the declarative inverse. Only the external constructor
    # reinitializer needs a small adapter after a checkpoint changes dimensions.
    projected, capture, _ = scene_restore_binding(model).bind(model, scenario)
    scenario.configure_scene_restore(
        projected, checkpoint_capture=capture, checkpoint_restore=restore_checkpoint
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
