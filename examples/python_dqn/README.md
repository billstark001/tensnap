# Grid Evacuation Demo (Mesa + PyTorch)

This project is a compact demonstration of combining:

- **ABM (Agent-Based Modeling)** via Mesa.
- **DQN (Deep Q-Network)** via PyTorch.

The environment is a grid-based evacuation scenario:

- A set of evacuee agents try to reach exits.
- A fire source expands over time.
- A **guide agent** is controlled by a DQN policy.
- Nearby evacuees are more likely to follow the guide, so the policy learns where to move in order to reduce congestion and improve evacuation outcomes.

A TenSnap visualization layer (`evac_viz.py`) is available for inspecting the simulation state in real time.

## Environment summary

- **Grid**: rectangular discrete space.
- **Agents**:
  - `EvacueeAgent`: heuristic civilian.
  - `GuideAgent`: RL-controlled agent.
- **Hazard**: expanding fire cells.
- **Exits**: fixed safe cells.
- **Actions**: `stay`, `up`, `down`, `left`, `right`.
- **Reward**:
  - positive reward for evacuations,
  - negative reward for casualties,
  - small per-step time penalty,
  - small congestion penalty,
  - bonus when the guide helps clustered evacuees.

## State features

The DQN observes a compact vector that includes:

- normalized guide position,
- normalized fire centroid,
- counts of alive / evacuated / dead evacuees,
- local congestion around the guide,
- distance to nearest exit,
- occupancy in 8 directional sectors around the guide.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install mesa torch tensnap
```

## Run a random-policy episode

```bash
# From the examples/ directory
python -m python_dqn.main --mode rollout --episodes 1 --seed 7
```

## Train DQN

```bash
# From the examples/ directory
python -m python_dqn.main --mode train --episodes 300 --seed 7
```

## Evaluate a saved checkpoint

```bash
# From the examples/ directory
python -m python_dqn.main --mode eval --episodes 20 --checkpoint checkpoints/dqn_latest.pt --seed 7
```

## TenSnap Visualization

Start the visualization server (uses a DQN agent with random weights — no training needed):

```bash
# From the examples/ directory
python -m python_dqn.evac_viz

# Or from the repo root
pnpm dev:py:evac-dqn
```

The server listens on `ws://localhost:8765` by default. Connect the TenSnap renderer
at <https://tensnap.netlify.app> or run `pnpm dev:web` locally.

### Taking a screenshot with agent-cli

```bash
# 1. Start the visualization server in the background
cd examples && python -m python_dqn.evac_viz &

# 2. Start the agent runtime
pnpm --filter @tensnap/agent dev -- runtime up --context evac-dqn --simulator-url ws://127.0.0.1:8765

# 3. Advance a few steps
pnpm --filter @tensnap/agent dev -- scene step --context evac-dqn

# 4. Render a snapshot
pnpm --filter @tensnap/agent dev -- scene render snapshot --context evac-dqn
```

### Visualization layers

| Layer | Description |
|---|---|
| **cells** | Static map: walls (dark gray), exits (green), fire (red, expands) |
| **evacuees** | Civilians: amber = alive, green = evacuated, gray = dead |
| **guide** | DQN-controlled guide agent (blue) |

### Charts

| Chart | Description |
|---|---|
| `alive` | Number of civilians still moving |
| `evacuated` | Cumulative evacuations |
| `dead` | Cumulative casualties |
| `fire_size` | Number of burning cells |

## Files

- `main.py`: CLI entry point.
- `model.py`: Mesa model and agent logic.
- `dqn.py`: replay buffer, Q-network, DQN agent.
- `train.py`: training and evaluation loops.
- `config.py`: typed configuration objects.
- `evac_viz.py`: TenSnap visualization entrypoint.

## Notes

- The demo avoids extra dependencies beyond `mesa`, `torch`, `tensnap`, and the Python standard library.
- The environment is intentionally small and readable rather than fully optimized.
- Because only the guide is controlled by RL, this is a good starting point for explaining **how ABM and DQN interact** in one simulation.
