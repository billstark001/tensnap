# Grid Evacuation Demo (Mesa / NetLogo + PyTorch)

This directory contains the runnable entry points for a Mesa + PyTorch DQN
example, with TenSnap, Solara, and NetLogo routes. See [MODEL.md](MODEL.md) for
the normative model description, ODD specification, reinforcement-learning
formulation, validation evidence, and limitations.

TenSnap (`evac_viz.py`), Solara (`evac_viz_solara.py`), and NetLogo
(`netlogo/evac_dqn_netlogo.nlogox`) views are available for comparing the same
evacuation task across implementations. The TenSnap and Solara visualizations
use the Mesa model; the training CLI can choose Mesa or NetLogo as the data
environment.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install mesa torch tensnap solara
# Optional, only for --env netlogo training:
pip install pynetlogo
```

## Run a random-policy episode

```bash
# From the examples/ directory
python -m python_dqn.main --mode rollout --episodes 1 --seed 7

# Use the NetLogo environment adapter instead:
python -m python_dqn.main --mode rollout --env netlogo --episodes 1 --seed 7
```

## Train DQN

```bash
# From the examples/ directory
python -m python_dqn.main --mode train --episodes 500 --seed 7

# Train from NetLogo state/reward transitions instead of Mesa:
python -m python_dqn.main --mode train --env netlogo --episodes 500 --seed 7
```

Checkpoints are written to `examples/python_dqn/checkpoints` by default. You can
override this with `--checkpoint-dir`.

## Evaluate a saved checkpoint

```bash
# From the examples/ directory
python -m python_dqn.main --mode eval --episodes 20 --checkpoint python_dqn/checkpoints/dqn_latest.pt --seed 7

# Evaluate the same checkpoint against NetLogo:
python -m python_dqn.main --mode eval --env netlogo --episodes 20 --checkpoint python_dqn/checkpoints/dqn_latest.pt --seed 7
```

## Compare against reference policies

`compare` runs the learned policy, no-guide, random, and oracle-like safe-exit
heuristic on the same episode seeds:

```bash
# From the examples/ directory
python -m python_dqn.main --mode compare --episodes 100 \
  --checkpoint python_dqn/checkpoints/dqn_latest.pt --seed 4000

# The same checkpoint can drive NetLogo without retraining:
python -m python_dqn.main --mode compare --env netlogo --episodes 20 \
  --checkpoint python_dqn/checkpoints/dqn_latest.pt --seed 4000
```

Interpretation of the reference policies and the expected evidence threshold is
documented in [MODEL.md](MODEL.md#fitness-for-purpose-and-validation).

## TenSnap Visualization

Start the visualization server:

```bash
# From the examples/ directory
python -m python_dqn.evac_viz

# Or from the repo root
pnpm dev:py:evac-dqn
```

The server listens on `ws://localhost:8765` by default. Connect the TenSnap renderer
at <https://tensnap.netlify.app> or run `pnpm dev:web` locally.

## Solara Visualization

Run the Mesa/Solara view:

```bash
# From the examples/ directory
solara run python_dqn/evac_viz_solara.py

# Or from the repo root
pnpm dev:py:evac-dqn:solara
```

The Solara view exposes the same core map layers, DQN guide model selection,
environment sliders, evacuation outcome chart, and fire-size chart as the
TenSnap example.

### Guide model control

`evac_viz.py` exposes a TenSnap enum parameter named `Guide Model`.

- The options are scanned at startup from `examples/python_dqn/checkpoints` by
  default, or from `DQN_GUIDE_MODEL_DIR` when that environment variable is set.
- `.pt` and `.pth` files appear as selectable guide policies.
- `untrained` is always available and creates deterministic untrained DQN weights.
- Changing `Guide Model` records the pending model but does not immediately
  reload the policy.
- The built-in `Reset` action rebuilds the environment and reloads the selected
  guide model.
- The `Reset Guide Model` action reloads only the selected guide policy.

### Taking a screenshot with agent-cli

```bash
# 1. Start the visualization server in the background
cd examples && python -m python_dqn.evac_viz &

# 2. Start the agent runtime
pnpm --filter @tensnap/agent dev -- runtime up --context evac-dqn --simulator-url ws://localhost:8765

# 3. Advance a few steps
pnpm --filter @tensnap/agent dev -- action run step --context evac-dqn

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

## NetLogo Comparison

A NetLogo 7 version is available at:

```bash
examples/python_dqn/netlogo/evac_dqn_netlogo.nlogox
```

It uses NetLogo's bundled `py` extension to initialize Python once, import
`python_dqn.netlogo_policy`, pass the 16-value guide state with `py:set`, and
read the DQN action with `py:runresult`.

For training with `--env netlogo`, the Python adapter disables
`use-python-policy?`, writes `training-action`, calls `go`, and reads the same
16-value state vector, reward, done flag, and count metrics back from NetLogo.
The cross-runtime state, action, reward, and scheduling contract is documented
in [MODEL.md](MODEL.md#process-overview-and-scheduling).

Open it from the repository root with:

```bash
pnpm dev:netlogo:evac-dqn
```

If NetLogo cannot find the repository or Python environment, set the model's
`repo-root` and `python-executable` inputs before pressing `setup`.
`python-executable` defaults to `auto`, which tries common project, conda, and
Homebrew Python paths before falling back to `python3`.

The NetLogo GUI keeps `use-python-policy?` on by default. Its bundled
BehaviorSpace smoke experiment turns that switch off because NetLogo's
`py:setup` can stop silently in headless BehaviorSpace on this machine; the
Python policy bridge is validated separately with `python_dqn.netlogo_policy`.

## Files

- `main.py`: CLI entry point with `--env mesa|netlogo`.
- `envs.py`: DQN environment protocol plus Mesa and NetLogo adapters.
- `model.py`: Mesa model and agent logic.
- `dqn.py`: replay buffer, Q-network, DQN agent.
- `train.py`: training and evaluation loops.
- `policies.py`: no-guide, random, and safe-exit reference policies.
- `config.py`: typed configuration objects.
- `evac_viz.py`: TenSnap visualization entrypoint.
- `evac_viz_solara.py`: Solara visualization entrypoint.
- `netlogo_policy.py`: Python policy bridge used by the NetLogo model.
- `netlogo/evac_dqn_netlogo.nlogox`: NetLogo comparison model.

## Notes

- The Mesa path avoids extra dependencies beyond `mesa`, `torch`, `tensnap`, and the Python standard library. NetLogo training additionally needs `pynetlogo` and a local NetLogo installation.
- The environment is intentionally small and readable rather than fully optimized.
- Model interpretation and limitations are centralized in
  [MODEL.md](MODEL.md#scope-and-interpretation).

## TenSnap design notes

- Parameter option lists are static after state sync. The guide model directory is
  scanned when the server starts; adding checkpoint files while the server is
  running requires restarting the simulator to refresh the enum choices.
- A custom action can reload Python-side policy state, but the Python binding does
  not currently provide a compact helper for "run this action and immediately
  push a full visual refresh." The `Reset Guide Model` action therefore reloads
  the policy and the visible effect appears on the next step or reset.
