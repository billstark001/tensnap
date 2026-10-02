import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "examples" / "python_mesa"))

from mushroom import ForagingModel  # noqa: E402
from schelling import SchellingModel  # noqa: E402
from sugarscape import Sugarscape  # noqa: E402


def test_mesa_grid_examples_keep_cell_occupancy_after_one_step() -> None:
    mushrooms = ForagingModel(
        width=12, height=12, num_clusters=1, patches_per_cluster=3, num_turtles=2
    )
    mushrooms.step()
    assert all(
        patch in mushrooms.grid[patch.cell.coordinate].agents
        for patch in mushrooms.patches
    )

    sugar = Sugarscape(width=12, height=12, agent_count=10, seed=7)
    sugar.step()
    assert all(agent in agent.cell.agents for agent in sugar.agents)

    schelling = SchellingModel(width=12, height=12, density=0.5, rng=7)
    schelling.step()
    assert all(agent in agent.cell.agents for agent in schelling.agents)
