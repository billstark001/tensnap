# Mini Commons Harvest

A spatial common-pool resource model inspired by [Commons Harvest / Melting Pot](https://github.com/google-deepmind/meltingpot) and [GovSim](https://github.com/giorgiopiatti/GovSim). The grid, regeneration law, observations, messages and baselines are defined independently here; this example does not reproduce either benchmark.

## Scientific purpose

The model exposes the tension between immediate individual harvest and future shared resource availability. Agents have local information, compete for regenerating stock, and may communicate without enforced agreements. Researcher views connect resource and inequality trajectories to movements, harvests and messages.

The implementation supports exploratory comparisons of resource pressure, population, memory and decision policies. Public message/action discrepancies motivate hypotheses about coordination and restraint. Demonstrating an effect of communication requires a separate controlled comparison: there is currently no communication-off treatment, negotiated quota system or formal cooperation metric.

## Run the backend

Choose a [Python environment](../README.md#choose-a-python-environment), then run from the repository root:

```bash
python -m examples.python_llm.mini_commons_harvest serve \
  --policy rule --rule greedy --port 8766
```

Connect the GUI to the printed URL or follow the [minimal agent CLI path](../README.md#connect-the-agent-cli-minimal-path) using port 8766. The backend waits for actions; stop it with Ctrl-C.

```bash
# Headless rules: Python 3.10+, no binding installation or API access.
python -m examples.python_llm.mini_commons_harvest batch --policy rule \
  --rule conserve --seeds 1,2,3 --agents 6 --steps 1200

# Existing tape: configuration and prompt schedule must match.
python -m examples.python_llm.mini_commons_harvest serve --policy replay \
  --agents 4 --seed 7 --width 12 --height 9 --memory 4 --regrowth 0.35 \
  --replay /path/to/commons-decisions.jsonl --port 8766

# Live inference: actions can make paid requests, one per activation.
python -m examples.python_llm.mini_commons_harvest serve --policy llm \
  --env-file /path/to/private.env --agents 4 --max-calls 8 --port 8766
```

A historical tape made with a prompt clarification needs that same clarification at its original activation boundary; the stock command above does not read a manifest or alter the prompt. See [shared workflows](../README.md) for replay matching, budgets, recordings and restoration.

## State and parameters

| Setting | Default | Meaning |
| --- | --- | --- |
| `--agents` | 6 | Harvesters, 2–24, initially on distinct fertile cells |
| `--seed` | 7 | Initial seed for environmental and policy RNG streams |
| `--width`, `--height` | 12, 9 | Dimensions, each 6–40; no wraparound |
| `--memory` | 4 | Each agent's last 1–8 personal activations |
| `--regrowth` | 0.35 | Regeneration multiplier in [0, 1] |
| `--rule` | `greedy` | Rule strategy: `greedy` or `conserve` |

Three fertile regions have Manhattan radius two around `(width//4, height//3)`, `(3*width//4, height//3)` and `(width//2, 2*height//3)`; they can overlap on small grids. Fertile cells start at capacity three, and barren cells stay at zero. The default grid has 39 fertile cells and 117 initial units. Initial population must fit the fertile cells.

Harvesters have stable IDs, position, cumulative harvest, last action/message and bounded personal history. Initial positions are sampled without replacement; later movement allows sharing a cell. There is no energy cost, survival requirement, birth or death.

Grid dimensions, population and memory are launch-time settings. `regrowth` and `rule` are editable at runtime; `rule` affects rule mode only. `selected_agent` affects inspection only. Reset restarts the current seed; **Reset with next seed** starts the next seed.

## One activation, in order

1. Select agent `tick % population_size`, in fixed round-robin order, and construct its local observation.
2. Obtain and validate a decision. Legal actions are in-bounds north/south/east/west, `wait`, and `harvest` only if the current cell has stock.
3. Advance tick by one. A move changes position by one cell; harvest removes one unit and increases personal harvest by one; wait changes neither.
4. Record action, post-action position, gain and message in personal history and `last_event`. Expire old messages and publish a new message, if any, at the post-action position.
5. After each complete population round, regenerate synchronously, then publish state and metrics.

One tick is **one individual activation**; a round contains `population_size` ticks. Invalid decisions leave state, RNG cursors and tick unchanged; paid requests remain counted. Earlier agents can affect later agents' observations within the same round.

## Resource regeneration

For each fertile cell below capacity, count `s`: resource-bearing cells among itself and its four cardinal neighbors in the **pre-regeneration** grid. In-bounds neighbors contribute; the denominator stays five at boundaries. Add one unit with probability:

```text
p(regrowth at cell) = regrowth * s / 5
```

Full/barren cells do not grow. Growth tests use the same previous grid, so a new unit cannot seed another cell during that event. A depleted cell can recover from a stocked neighbor; an isolated fertile patch without seeds cannot recover spontaneously. Harvesting one cell's last unit does not by itself prove irreversible patch collapse.

Environmental initialization/regeneration and rule exploration use separate RNG streams, both checkpointed. Identical seeds reproduce a fixed policy/tape trajectory. Across policies, changed resource states can change which regeneration draws occur; the same seed alone does not guarantee identical noise at each cell/round.

## Information, messages and policies

Each LLM observation contains its ID, run seed, tick, position, legal actions, and:

- Cells within Manhattan distance two, with resource and fertility.
- Peers within distance two, with identity, position and last action, excluding private histories and harvest totals.
- At most the last six audible messages, within distance three of each message's recorded sending position.
- The active agent's bounded personal activation history.

Messages expire on activation after about two rounds; delivery uses the recorded sending location, not the sender's later position. The LLM gets no global stock, inequality or full map. Its prompt asks it to maximize personal total harvest over a long run, without specifying a finite horizon or discount. It returns `{"action":"...","message":"..."}`, with an optional message of at most 160 characters.

Messages are cheap talk: they enter local observations but enforce no reserve, quota, role or sanction. A public promise is observable output, not a guarantee of intent or internal reasoning.

`greedy` harvests whenever its current cell has stock. `conserve` harvests only above one unit. Otherwise both approach a nearest visible cell above their reserve, randomizing ties; without a target they explore legal nonharvest actions. Rules send no messages. A rule/LLM comparison changes policy and language behavior together, so it does not isolate communication's effect.

## Measurements and visualization

| Metric | Definition |
| --- | --- |
| `tick`, `round` | Individual activations; completed population rounds |
| `resource` | Total remaining units |
| `harvested` | Sum of cumulative personal harvests |
| `gini` | `sum(abs(h_i-h_j)) / (2 * N * sum(h_i))`, or zero before any harvest |
| `live_cells` | Cells containing at least one unit |

Charts show resource, cumulative harvest and harvest Gini. `metrics`, `local_messages`, `last_event`, `selected_agent` and `inference` are researcher monitors. The global message monitor extends beyond any individual's hearing. Low Gini means similar accumulated yields, not necessarily restraint, efficiency or sustainable cooperation.

Pale gray cells are barren, tan cells are depleted fertile cells, and darker greens indicate one to three units. Purple harvesters may overlap while retaining separate identities. Inspect cells for stock/fertility and agents for actions, messages, harvest and history. Model rows are top-down; both cells and agents use projected y `height - 1 - row`.

## Interpreting an experiment

Compare stock, yield, depletion and inequality over a stated number of rounds. Check whether events precede or follow regeneration, and distinguish local observations from global researcher views. A message/action discrepancy is an inspectable event; a single trajectory establishes no general cooperation advantage or collapse mechanism.

Independent initializations supply distinct runs. Checkpoint continuations share a prefix; tape replay verifies a trajectory without measuring its frequency. Use [CLI collection and checkpoint/history restoration](../README.md#standard-recording-historical-frames-and-restoration) for historical event windows and exact continuation.
