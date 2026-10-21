# region Imports

import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401
from mushroom import ForagingModel, MushroomState
from tensnap import (
    SimulationScenario,
    chart,
    mesa_model_time,
)

# endregion

# region Setup

# Setup global state
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, use_msgpack=True)

model: ForagingModel | None = None

# Model configuration
MODEL_WIDTH = 50
MODEL_HEIGHT = 50
NUM_CLUSTERS = 4
PATCHES_PER_CLUSTER = 20
NUM_HUNTERS = 2

# endregion

# region Charts


@chart(
    "mushroom_stats",
    "Mushroom Statistics",
    data_list=[
        ("red_mushrooms", "#E74C3C", "Red Mushrooms"),
        ("collected_mushrooms", "#F39C12", "Collected Mushrooms"),
    ],
)
def mushroom_stats_chart() -> dict[str, int]:
    """Get mushroom statistics"""
    assert model is not None
    return {
        "red_mushrooms": sum(p.state == MushroomState.AVAILABLE for p in model.patches),
        "collected_mushrooms": sum(
            p.state == MushroomState.COLLECTED for p in model.patches
        ),
    }


@chart("harvest_rate", "Cumulative Mushrooms per Hunter per Tick", color="#3498DB")
def harvest_rate_chart() -> float:
    """Count harvested resources per hunter per elapsed tick; zero at initialization."""
    assert model is not None
    return sum(h.collected for h in model.hunters) / max(
        len(model.hunters) * mesa_model_time(model), 1
    )


@chart("search_age", "Ticks Since Last Find", color="#9B59B6")
def search_age_chart() -> float:
    """Search age starts at zero; before a first find it is time since initialization."""
    assert model is not None
    return sum(h.time_since_last_found for h in model.hunters) / max(
        len(model.hunters), 1
    )


# endregion

# region Main


async def main() -> None:
    global model
    model = ForagingModel(
        width=MODEL_WIDTH,
        height=MODEL_HEIGHT,
        num_clusters=NUM_CLUSTERS,
        patches_per_cluster=PATCHES_PER_CLUSTER,
        num_turtles=NUM_HUNTERS,
    )
    assert model is not None

    await scenario.register_model(model)

    scenario.add_all(globals())

    print(
        f"TenSnap Mushroom Foraging visualization starting on ws://localhost:{server_port}"
    )
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())

# endregion
