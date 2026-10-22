# Mini Commons Harvest

A spatial common-pool resource model inspired by [Commons Harvest / Melting Pot](https://github.com/google-deepmind/meltingpot) and [GovSim](https://github.com/giorgiopiatti/GovSim). The grid, regeneration law, observations, messages and baselines are defined independently here; this example does not reproduce either benchmark.

## Scientific purpose

The model exposes the tension between immediate individual harvest and future shared resource availability. Agents have local information, compete for regenerating stock, and may communicate without enforced agreements. Researcher views connect resource and inequality trajectories to movements, harvests and messages.

The main extension compares message delivery on/off crossed with a temporary drought. It asks whether local advice changes stock, personal/total yield, irreversible component extinction and recovery after the shock. The [factorial protocol](../EXPERIMENTS.md#commons-message-delivery--temporary-drought) defines matched initial states/random fields, a message-aware rule and negative controls. There are no negotiated quotas or enforced agreements. Run all controls with `python -m examples.python_llm.experiments commons --output /path/to/new-results`.

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

A replay tape must match the current observations and prompt. For older experiments and prompt branches, use the [historical Git snapshot](../HISTORY.md). See [shared workflows](../README.md) for replay matching, budgets, recordings and restoration.

## State and parameters

| Setting | Default | Meaning |
| --- | --- | --- |
| `--agents` | 6 | Harvesters, 2–24, initially on distinct fertile cells |
| `--seed` | 7 | Initial seed for environmental and policy RNG streams |
| `--width`, `--height` | 12, 9 | Dimensions, each 6–40; no wraparound |
| `--memory` | 4 | Each agent's last 1–8 personal activations |
| `--regrowth` | 0.35 | Regeneration multiplier in [0, 1] |
| `--rule` | `greedy` | Rule strategy: `greedy`, `conserve` or `signal` |
| `--message-delivery` | `on` | `off` suppresses incoming observations while retaining generation/publication |
| `--drought-start` | 0 | First affected completed round; positive when drought is enabled |
| `--drought-duration` | 0 | Number of affected rounds; zero disables the shock |
| `--drought-multiplier` | 0.1 | Scale baseline regrowth during the drought; automatically return to baseline afterward |

Three fertile regions have Manhattan radius two around `(width//4, height//3)`, `(3*width//4, height//3)` and `(width//2, 2*height//3)`; they can overlap on small grids. Fertile cells start at capacity three, and barren cells stay at zero. The default grid has 39 fertile cells and 117 initial units. Initial population must fit the fertile cells.

Harvesters have stable IDs, position, cumulative harvest, last action/message and bounded personal history. Initial positions are sampled without replacement; later movement allows sharing a cell. There is no energy cost, survival requirement, birth or death.

Grid dimensions, population and memory are launch-time settings. `seed`, `policy` and the `scenario` enum stage choices for the next Reset. The twelve scenarios cross `greedy`/`conserve`/`signal`, message delivery on/off and normal/drought weather. Drought presets reuse a configured schedule or default to rounds 40–79. Provider policies require the matching launch-time credentials or replay tape. `regrowth` and the `rule` enum are editable at runtime; `rule` affects rule mode only. `selected_agent` affects inspection only. Reset restarts the selected seed; **Reset with next seed** starts the next seed.

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

Environmental initialization and rule exploration use separate RNG streams, both checkpointed. A seed/round-keyed field assigns a draw to every cell, independent of resource eligibility; paired treatments therefore share cell/round noise. Temporary drought scales `regrowth` during `[drought_start, drought_start + drought_duration)` completed rounds. Weather is researcher-visible and not announced in agent observations.

## Information, messages and policies

Each LLM observation contains its ID, run seed, tick, position, legal actions, and:

- Cells within Manhattan distance two, with resource and fertility.
- Peers within distance two, with identity, position and last action, excluding private histories and harvest totals.
- At most the last six audible messages, within distance three of each message's recorded sending position.
- The active agent's bounded personal activation history.

Messages expire on activation after about two rounds; delivery uses the recorded sending location, not the sender's later position. The LLM gets no global stock, inequality or full map. Its prompt asks it to maximize personal total harvest over a long run, without specifying a finite horizon or discount. It returns `{"action":"...","message":"..."}`, with an optional message of at most 160 characters.

Messages are cheap talk: they enter local observations but enforce no reserve, quota, role or sanction. A public promise is observable output, not a guarantee of intent or internal reasoning.

`greedy` harvests whenever its current cell has stock. `conserve` harvests only above one unit. Otherwise both approach a nearest visible cell above their reserve, randomizing ties; without a target they explore legal nonharvest actions. Those two rules send no messages and serve as delivery negative controls.

The `signal` rule emits `reserve x y` while on a fertile cell containing at most two units. It is otherwise greedy but leaves one unit at coordinates warned about by another nearby agent. Incoming advice expires after two rounds; own warnings are excluded from reception. The action/message schema and sender behavior are identical with delivery on/off. This is a scripted receiver for testing the channel, not evidence that cooperation emerges. Rules, local messages and LLM objectives receive no knowledge of the drought schedule.

```bash
python -m examples.python_llm.mini_commons_harvest serve --policy rule \
  --rule signal --message-delivery on \
  --drought-start 40 --drought-duration 40 --drought-multiplier .1 --port 8766
```

## Measurements and visualization

| Metric          | Definition                                                           |
| --------------- | -------------------------------------------------------------------- |
| `tick`, `round` | Individual activations; completed population rounds                  |
| `resource`      | Total remaining units                                                |
| `harvested`     | Sum of cumulative personal harvests                                  |
| `gini`          | `sum(abs(h_i-h_j)) / (2 * N * sum(h_i))`, or zero before any harvest |
| `live_cells`    | Cells containing at least one unit                                   |

Charts show resource, cumulative harvest and harvest Gini. `metrics`, `local_messages`, `last_event`, `selected_agent` and `inference` are researcher monitors. The global message monitor extends beyond any individual's hearing. Low Gini means similar accumulated yields, not necessarily restraint, efficiency or sustainable cooperation.

Factorial metrics additionally report per-connected-fertile-component stock, extinct-component count, total components, weather state and effective regeneration. Entire seedless components cannot recover; a zero-stock cell alone can recover. The `treatment` monitor reports the delivery setting, weather schedule and actual connected habitat. The factorial runner records round-level stock/yield, phase harvests, extinction and recovery confirmation/censoring; [definitions and paired contrasts](../EXPERIMENTS.md) are fixed before analysis.

Pale gray cells are barren, tan cells are depleted fertile cells, and darker greens indicate one to three units. Purple harvesters may overlap while retaining separate identities. Inspect cells for stock/fertility and agents for actions, messages, harvest and history. Model rows are top-down; both cells and agents use projected y `height - 1 - row`.

## Interpreting an experiment

Compare stock, yield, depletion and inequality over a stated number of rounds. Check whether events precede or follow regeneration, and distinguish local observations from global researcher views. A message/action discrepancy is an inspectable event; a single trajectory establishes no general cooperation advantage or collapse mechanism.

Independent initializations supply distinct runs. Checkpoint continuations share a prefix; tape replay verifies a trajectory without measuring its frequency. Use [CLI collection and checkpoint/history restoration](../README.md#standard-recording-historical-frames-and-restoration) for historical event windows and exact continuation.

The core model rejects unavailable actions before changing state. The explicit `LegalActionPolicy` adapter (`common/action_policy.py`) optionally asks the LLM for one correction at that same state. Its first request is unchanged. If the answer is illegal, the second request adds the rejected answer, the current cell's observed resource and the legal action list, explaining that past plans and messages cannot override available actions. Both answers remain on tape and both live requests consume the budget. Exhaustion stops the branch atomically; there is no rule fallback. Choose this adapter explicitly when constructing a provider, and specify the same correction limit in all compared conditions. The ordinary CLI uses strict validation without automatic correction.

For a first reading, follow `observation()` → `rule_decision()` → `step()` → `regrow()`. The first method defines the information boundary; decisions are validated before movement or harvest, and regrowth reads the previous grid synchronously. `_explore_without_harvesting()` makes the resource reserve apply to exploration as well as directed harvesting. Read `viz.py` after the transition rules.

`scenarios.py` owns the named conditions, fertile patches, full initial stock, component discovery, seeded placement and drought schedule. These functions return environment data without operating on model objects. A habitat graph plus `nx.connected_components` can replace the small flood-fill. NumPy can replace grid loops if old/new grids, boundary conditions and random draw order remain explicit. Mesa can replace the agent container or scheduler if it retains one round-robin activation per tick and regeneration only at round end. These alternatives and their assumptions are summarized in [EXPERIMENTS](../EXPERIMENTS.md#implementation-choices-and-alternatives).

Checkpoints use schema version 2; historical execution is documented in [HISTORY](../HISTORY.md).
