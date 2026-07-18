# Two-Exit Fire Evacuation Model

This document is the normative description of the Fire/DQN example. It follows
the ODD (Overview, Design concepts, Details) structure, including the design
rationale and fitness-for-purpose guidance in the
[2020 ODD update](https://www.jasss.org/23/2/7.html). The implementation lives
in `model.py` (Mesa), `netlogo/evac_dqn_netlogo.nlogox` (NetLogo), and `dqn.py`
(PyTorch).

## Scope and interpretation

The model is a deliberately small research and integration case, not a
validated model of human behavior in real fires. Its purpose is to make one
reinforcement-learning mechanism easy to inspect across runtimes:

> A guide observes which of two exits is threatened, broadcasts an exit choice
> to nearby evacuees, and is rewarded when that intervention improves completed
> evacuations rather than merely moving the guide avatar.

The case supports three uses:

1. a Mesa model rendered through TenSnap;
2. the same Mesa model rendered through Solara; and
3. an independently implemented NetLogo environment driven by the same
   PyTorch checkpoint through either the NetLogo Python extension or pyNetLogo.

Claims should therefore be limited to task performance and cross-platform
integration. Results do not imply that a learned policy is safe for deployment
or that the civilian rules represent observed evacuation behavior.

## Overview

### Purpose and patterns

The model tests whether a DQN-controlled guide can learn a contingent decision:
signal the exit opposite a randomly selected fire source. A useful policy should
produce all of the following patterns on held-out episode seeds:

- materially more completed evacuations than a no-guide policy;
- materially fewer deaths and unresolved evacuees than no-guide and random
  policies;
- performance approaching a transparent safe-exit heuristic that reads the
  initial fire side and signals the opposite exit once; and
- similar qualitative performance when the same checkpoint controls the Mesa
  and NetLogo implementations.

The comparison is meaningful because staying still is a valid policy and does
not automatically redirect anyone. A policy must select a horizontal action to
establish a preferred exit, and only evacuees within the guide's influence
radius may adopt that preference.

### Entities, state variables, and scales

The world is a non-toroidal rectangular grid. Default dimensions are 17 by 13
cells. Space and time are abstract: one grid cell and one tick have no asserted
physical unit.

#### Patches

Each patch has four Boolean state variables:

- `wall`: impassable to guides, evacuees, and fire;
- `exit`: resolves a living evacuee as evacuated;
- `fire`: lethal and impassable for planned movement;
- `next_fire`: temporary state used for synchronous fire spread in NetLogo.

Two solid barrier columns divide a central room from the left and right exit
corridors. Each barrier has exactly one doorway at the vertical center. The
exits are centered on the left and right world boundaries. The two candidate
fire sources sit immediately inside the two doorways.

#### Evacuees

Each evacuee has:

- grid position;
- `alive` status;
- `evacuated` status; and
- a persistent `target_exit`, either left or right.

Evacuees are heuristic agents, not reinforcement learners. They initially
target the nearest exit and may change that target only after adopting the
guide's broadcast.

#### Guide

The single guide has:

- grid position; and
- `preferred_exit`, initially unset and later left or right.

The DQN controls only the guide. Horizontal actions both move the guide and set
its broadcast preference. Vertical actions move without changing the current
preference. The stay action preserves both position and preference.

#### Fire

An episode samples exactly one of the two candidate sources. Fire is represented
as a set of burning patches and spreads stochastically to passable, non-exit
von Neumann neighbors.

#### Global episode state

The environment records the tick, alive/evacuated/dead counts, fire size,
last-step reward, cumulative reward, and whether the episode terminated by
resolution or truncation.

Default scale and control values are defined in `config.py`:

| Parameter | Default |
|---|---:|
| Grid | 17 × 13 |
| Evacuees | 28 |
| Maximum ticks | 50 |
| Guide influence radius | 6 Manhattan cells |
| Guide-follow probability | 0.90 |
| Random movement probability | 0.05 |
| Fire-spread interval | 2 ticks |
| Per-neighbor spread probability | 0.20 |

### Process overview and scheduling

At each tick, processes execute in this order:

1. Reject further transitions if the episode is already terminal.
2. Apply the guide action. A left/right action updates the preferred exit even
   when fire or a wall prevents the physical move.
3. For each living unresolved evacuee within the Manhattan influence radius,
   adopt the preferred exit with probability 0.90 when it differs from the
   current target.
4. Move each living unresolved evacuee by one cell or stay, using the civilian
   route-choice submodel.
5. On every second tick, spread fire synchronously and resolve newly exposed
   evacuees as dead.
6. Compute evacuation and death deltas, congestion, route progress, reward, and
   metrics.
7. Advance the tick and terminate if everyone is evacuated/dead or the maximum
   tick is reached.

Mesa iterates evacuees in their creation order. NetLogo's `ask` uses randomized
agent order. The implementations intentionally share task semantics and state
meaning, but they are not expected to produce cell-for-cell identical
trajectories for the same seed because their random-number generators and agent
schedulers differ.

## Design concepts

### Basic principles

The example separates a high-level intervention from lower-level crowd motion.
The guide does not directly move evacuees; it changes a target variable that
feeds their own route selection. This makes the learned action traceable in
snapshots and allows an explanatory chain:

`fire side → guide preference → civilian targets → paths → outcomes`.

### Emergence

Evacuation totals, deaths, unresolved counts, congestion, and trajectory shapes
emerge from the interaction of persistent exit targets, local guide influence,
stochastic adoption, route planning, crowd occupancy, and fire spread.

### Adaptation and objectives

Evacuees adapt only by probabilistically accepting the guide's preferred exit.
Their movement heuristic then seeks a short currently traversable route to that
target while avoiding fire and occupied cells.

The guide adapts through DQN training. Its objective is the discounted return
defined by the environment reward, not a hand-coded exit label.

### Learning

Learning occurs only in the guide policy and only during training. Replay-buffer
updates fit a Q-function that estimates expected discounted return for the five
guide actions. Evaluation and visualization use greedy action selection and do
not update weights, replay memory, or the exploration schedule.

### Prediction

Civilian movement uses a breadth-first route distance over the current grid,
treating walls and fire as blocked. The DQN does not receive a full map; it must
act from a compact summary state.

### Sensing

The guide policy receives the 16 normalized values listed under
“Reinforcement-learning formulation.” It does not observe individual identities,
the full occupancy grid, future fire random draws, or the civilians' movement
tie-breaks.

### Interaction

Guide–evacuee interaction is local and one-way: an in-range evacuee may adopt
the guide's current exit preference. Evacuees interact indirectly through a
per-cell occupancy penalty in their movement score and through aggregate
congestion in the guide reward.

### Stochasticity

Randomness enters through fire-source selection, evacuee spawn cells, tied
initial exit targets, guide-follow decisions, small movement perturbations,
movement tie-breaking, fire spread, replay sampling, and epsilon-greedy action
selection during training.

### Collectives

There is one implicit collective: unresolved evacuees currently targeting the
same exit. The state exposes the left- and right-target shares, but there is no
explicit group agent or leader hierarchy.

### Observation

The model reports alive, evacuated, dead, unresolved, fire size, episode reward,
steps, congestion, guide redirects, invalid guide actions, and truncation.
TenSnap and Solara visualize the Mesa implementation; NetLogo visualizes its own
implementation. The policy-comparison CLI aggregates outcome metrics over common
episode seeds.

## Details

### Initialization

For each episode:

1. Generate the two exits, two single-door barrier columns, and two candidate
   fire-source cells from the requested grid dimensions.
2. Sample one candidate fire source.
3. Place the guide at the grid center with no preferred exit.
4. Sample unique evacuee cells from the central room, within three rows of the
   vertical center and excluding walls, exits, fire, and occupied cells.
5. Assign each evacuee the nearest exit; break exact ties randomly.
6. Reset counters, route caches, plots, and tick to zero.

### Input data

The model reads no external empirical time series. Runtime inputs are the typed
environment parameters, a random seed, and optionally a PyTorch checkpoint.
NetLogo may obtain policy actions by loading the checkpoint through its Python
extension or by accepting actions from the pyNetLogo adapter.

### Submodels

#### Civilian route choice

For each candidate consisting of the current patch and passable non-burning
neighbors, compute a route distance to the current target exit using
breadth-first search. If a route exists, the base score is:

```text
-3.0 × route_distance + 0.35 × distance_to_nearest_fire
```

If no route exists, the candidate receives:

```text
-1000 + 1.2 × distance_to_nearest_fire
```

Moving into a patch with `n` unresolved occupants adds `-0.9 × n`. With
probability 0.05, a uniform perturbation in `[-0.5, 0.5]` is added. The agent
selects a maximum-score candidate, randomly breaking ties. Entering an exit
resolves evacuation. Fire cells are excluded from planned candidates, while
newly spread fire can kill an evacuee after movement.

#### Guide signal

Actions 3 and 4 set the preferred exit to left and right respectively. Each
living unresolved evacuee within Manhattan radius 6 whose target differs from
the preference independently adopts it with probability 0.90. The preference
persists until another horizontal action changes it.

#### Fire spread

Every two ticks, each burning patch independently attempts to ignite each
passable, non-exit von Neumann neighbor with probability 0.20. Newly ignited
cells are applied synchronously for that spread event.

#### Congestion

For each occupied patch, congestion contributes `max(0, n - 1)`, where `n` is
the number of living unresolved evacuees on that patch. Summing by patch avoids
double-counting the same excess occupants.

#### Reward

For one environment transition:

```text
reward =  3.00 × newly_evacuated
        - 8.00 × newly_dead
        - 0.03
        - 0.01 × congestion
        + 0.05 × bounded_route_progress
        - 0.05 if the guide move is invalid
        - 2.00 × unresolved if the episode truncates
```

For each evacuee with a valid route before and after movement, route progress is
the reduction in route distance clipped to `[-1, 1]`; values are summed across
evacuees. The progress term is shaping, while completed evacuation, death, and
terminal unresolved penalties encode the primary outcome. No reward is granted
merely for staying near or clustering civilians around the guide.

## Reinforcement-learning formulation

### Markov decision process

One episode is treated as a finite-horizon partially observed control problem:

- **agent**: the guide;
- **environment**: grid, fire, and heuristic evacuees;
- **decision interval**: one model tick;
- **horizon**: at most 50 decisions;
- **discount**: 0.99;
- **terminal conditions**: all evacuees resolved, or horizon reached.

The 16-value summary is not a lossless description of the full simulator state,
so this is operationally closer to a POMDP solved with a memoryless Q-network.
The compact state is intentional: it remains transferable between Mesa and
NetLogo and keeps the policy mechanism inspectable.

### Observation vector

| Index | Feature | Normalization |
|---:|---|---|
| 0 | Guide x | `x / (width - 1)` |
| 1 | Guide y | `y / (height - 1)` |
| 2 | Fire-centroid x | `x / (width - 1)` |
| 3 | Fire-centroid y | `y / (height - 1)` |
| 4 | Living unresolved evacuees | count / total evacuees |
| 5 | Evacuated evacuees | count / total evacuees |
| 6 | Dead evacuees | count / total evacuees |
| 7 | Episode progress | tick / maximum ticks |
| 8 | Preferred exit | 0 left, 0.5 unset, 1 right |
| 9 | Burning cells left of center | count / burnable cells |
| 10 | Burning cells right of center | count / burnable cells |
| 11 | Living evacuees targeting left | count / total evacuees |
| 12 | Living evacuees targeting right | count / total evacuees |
| 13 | Living evacuees in guide range | count / total evacuees |
| 14 | Guide distance to nearest fire | distance / (width + height) |
| 15 | Fire size | count / burnable cells |

The initial fire centroid makes the safe side directly inferable, while target
shares and preferred exit allow the policy to observe whether its intervention
has already propagated. Position and range share permit movement-based recovery
when some evacuees do not adopt the first signal.

### Action space and causal mechanism

| Code | Action | Policy effect |
|---:|---|---|
| 0 | Stay | Preserve position and preferred exit |
| 1 | Down | Move one cell if valid; preserve preference |
| 2 | Up | Move one cell if valid; preserve preference |
| 3 | Left | Set preferred exit left, then attempt to move left |
| 4 | Right | Set preferred exit right, then attempt to move right |

The critical causal channel is the preferred-exit broadcast, not guide
displacement. Left/right signals can still take effect when the physical move is
blocked, which separates communication from locomotion and avoids making a wall
collision erase the intended instruction.

### Function approximation and Double DQN

The policy network is a multilayer perceptron:

```text
16 inputs → 128 ReLU → 128 ReLU → 5 Q-values
```

Training uses Adam with learning rate `1e-3`, Huber loss, gradient norm clipping
at 5, replay capacity 20,000, batch size 64, and a 250-transition warm-up. The
epsilon-greedy schedule decays linearly from 1.00 to 0.05 over 8,000 training
actions. A target network is synchronized every 200 optimization steps.

The bootstrap target uses Double DQN logic:

```text
a* = argmax_a Q_policy(next_state, a)
target = reward + gamma × Q_target(next_state, a*) × (1 - done)
```

The policy network therefore selects the next action while the target network
evaluates it, reducing the direct maximization bias of using one network for
both operations. Greedy evaluation does not advance the exploration counter.

### Why the DQN can learn something meaningful

The earlier version allowed the guide to wander while civilians mostly pursued
the nearest exit, and its reward included proximity/clustering terms. Those
conditions made visually active behavior possible without a reliable
improvement in evacuation.

The current task creates a repeated counterfactual:

- if fire is on the left, signaling right usually saves the left-targeting
  civilians;
- if fire is on the right, signaling left usually saves the right-targeting
  civilians;
- staying silent leaves roughly half the crowd committed to the blocked side;
- signaling the threatened side produces visibly worse outcomes.

Because the fire side is randomized each episode, a fixed always-left or
always-right action cannot solve the task. Because the safe-exit heuristic is
explicit, DQN performance can be judged against both a lower baseline and an
interpretable ceiling.

## Fitness for purpose and validation

### Automated checks

From the repository root:

```bash
PYTHONPATH=examples python -m pytest -q examples/python_dqn/tests
ruff check examples/python_dqn
pyright examples/python_dqn
```

The tests verify canonical map construction, one-sided fire sampling, the
16-value state contract, horizon truncation, and a material safe-guide advantage
over no guide. NetLogo's `smoke` BehaviorSpace experiment validates that the
model compiles and runs headlessly.

### Policy comparison

Train and compare on held-out episode seeds:

```bash
cd examples
python -m python_dqn.main --mode train --episodes 500 --seed 7
python -m python_dqn.main --mode compare --episodes 100 \
  --checkpoint python_dqn/checkpoints/dqn_latest.pt --seed 4000
```

During development, five independently trained models (training seeds 7, 11,
23, 37, and 53) were each evaluated on the same 500 held-out episode seeds. The
mean across training seeds was 27.65 evacuated, 0.14 dead, and 0.21 unresolved
out of 28. The range of mean evacuations was 27.45–27.89. On those episode
seeds, no guide averaged 14.39 evacuated, 4.70 dead, and 8.91 unresolved. The
safe-exit heuristic averaged 27.87 evacuated, 0.08 dead, and 0.05 unresolved.

A smaller cross-runtime smoke comparison used one checkpoint for 10 NetLogo
episodes: DQN averaged 27.8 evacuated and 0 dead; no guide averaged 14.3
evacuated and 5.9 dead. These figures establish fitness for the demonstration,
not external validity.

### Known limitations

- Civilian route choice and guide compliance are stylized rather than fitted to
  empirical evacuation data.
- The guide receives a compact global summary, including fire centroid and
  aggregate target shares, that may be unrealistic for a person in a building.
- Fire spread is an abstract stochastic cellular process without smoke,
  temperature, visibility, incapacitation delay, or building materials.
- One guide broadcast can influence every evacuee inside a Manhattan radius;
  communication delay, occlusion, trust heterogeneity, and crowd perception are
  omitted.
- The default layout is intentionally easy to interpret and tests one binary
  routing decision. It does not establish generalization to arbitrary maps,
  multiple fires, blocked passages, or changing exits.
- Mesa and NetLogo align state, action, reward, and scheduling phases but do not
  share random-number streams or agent iteration order.
- Reported episode-level results condition on this simulator and parameter set.
  They should not be converted into claims about real casualty reduction.

## Implementation map

| Concern | Source |
|---|---|
| Typed parameters and canonical layout | `config.py` |
| Mesa agents, scheduling, state, and reward | `model.py` |
| Q-network, replay, and Double DQN update | `dqn.py` |
| Training/evaluation loops | `train.py` |
| Reference policies and comparison | `policies.py` |
| Mesa/NetLogo environment adapters | `envs.py` |
| NetLogo implementation | `netlogo/evac_dqn_netlogo.nlogox` |
| NetLogo-to-Python checkpoint bridge | `netlogo_policy.py` |
| TenSnap visualization entry point | `evac_viz.py` |
| Solara visualization entry point | `evac_viz_solara.py` |
