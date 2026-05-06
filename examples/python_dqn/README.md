# Grid Evacuation Demo (Mesa + PyTorch)

This project is a compact demonstration of combining:

- **ABM (Agent-Based Modeling)** via Mesa.
- **DQN (Deep Q-Network)** via PyTorch.

The environment is a grid-based evacuation scenario:

- A set of evacuee agents try to reach exits.
- A fire source expands over time.
- A **guide agent** is controlled by a DQN policy.
- Nearby evacuees are more likely to follow the guide, so the policy learns where to move in order to reduce congestion and improve evacuation outcomes.

Visualization is intentionally omitted for now, so the code stays focused on environment logic and RL training.

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
pip install mesa torch
```

## Run a random-policy episode

```bash
python main.py --mode rollout --episodes 1 --seed 7
```

## Train DQN

```bash
python main.py --mode train --episodes 300 --seed 7
```

## Evaluate a saved checkpoint

```bash
python main.py --mode eval --episodes 20 --checkpoint checkpoints/dqn_latest.pt --seed 7
```

## Files

- `main.py`: CLI entry point.
- `evac_demo/model.py`: Mesa model and agent logic.
- `evac_demo/dqn.py`: replay buffer, Q-network, trainer.
- `evac_demo/train.py`: training and evaluation loops.
- `evac_demo/config.py`: typed configuration objects.

## Notes

- The demo avoids extra dependencies beyond `mesa`, `torch`, and the Python standard library.
- The environment is intentionally small and readable rather than fully optimized.
- Because only the guide is controlled by RL, this is a good starting point for explaining **how ABM and DQN interact** in one simulation.
