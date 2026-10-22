# Network interventions and environmental shocks

These paired factorial experiments ask how contact structure changes convention adoption and how local communication changes resilience to a resource shock. They are exploratory agent-based models with explicit mechanisms, controls and endpoints. The runner uses rule policies and never loads provider configuration or makes an inference request.

```bash
# From the repository root, Python 3.10+ and NetworkX. Each output must be new.
python -m examples.python_llm.experiments naming --seeds 1,2,3,4,5,6,7,8,9,10,11,12 \
  --output examples/python_llm/artifacts/my-naming-controls
python -m examples.python_llm.experiments commons --seeds 1,2,3,4,5,6,7,8,9,10,11,12 \
  --output examples/python_llm/artifacts/my-commons-controls
```

Use the environment routes in [README](README.md#choose-a-python-environment) and `--help` for horizons and treatment parameters. The runner saves time series and checkpoints. For visual inspection, start a backend and use the [agent recording workflow](README.md#standard-recording-historical-frames-and-restoration).

Conditions and environment generation live in [naming scenarios](naming_game/scenarios.py) and [commons scenarios](mini_commons_harvest/scenarios.py). The runner reads these definitions directly, and every run records its `scenario` ID. The same conditions are selectable in each model's frontend `scenario` enum; seed and scenario edits apply on Reset. Naming's runner still branches from its shared stable checkpoint, while interactive Reset initializes a fresh population with the selected condition.

## Naming: network structure × fixed minority

**Scientific question.** When a fixed minority advocates an alternative convention, does community structure protect the incumbent convention, slow replacement, or sustain different local conventions? The experiment estimates dependence on the specified contact network; it does not identify a universal tipping threshold.

| Factor | Control | Treatment |
| --- | --- | --- |
| Contact graph | `mixed`: randomized connected regular graph | `community`: two regular communities joined by two edges |
| Fixed alternative advocates | 0 | 4 of 24 existing agents |

**Graphs.** Both graphs have 24 nodes, degree 4 and 48 undirected edges. The same seeded permutation defines community membership in both conditions. Mixed contacts start as a regular ring and undergo 20 × N × degree double-edge-swap proposals, rejecting self-loops, duplicate edges and disconnected proposals. Community contacts join two regular rings by replacing one edge in each with two bridges. These are specified graph families rather than uniform samples from all regular graphs. Clustering and path lengths may differ too. Each run saves the adjacency, degree sequence, partition and number of cross-community edges.

**Shared prefix.** For every seed and each `QM`/`MQ` label order, begin on the mixed graph without fixed agents, assigned names or fabricated histories. Warm up until last-choice agreement and rolling coordination both reach 90%, the measurement window contains 4N interactions, every agent has acted, and the same majority label satisfies these conditions for N consecutive interactions. The cutoff is 10,000 interactions. Save a failure as `no_stable_prefix`; do not replace its seed. Report how many seeds satisfy the prefix criterion.

Clone the exact stable checkpoint into all four conditions. The alternative name is the opposite of the incumbent. A separate seeded permutation selects the same existing IDs for both minority treatments, without selecting bridge agents. Change their policy to always choose the alternative and change the contact network as assigned. Population size, scores, personal histories, current last choices and both RNG cursors remain intact. Fixed agents receive ordinary payoffs and remember contacts, but do not call an LLM. Their assignment is an exogenous intervention.

**Rule policies.** The default `frequency` policy chooses the most frequent partner name in the last five personal interactions, breaks ties uniformly and explores with probability 0.01. It estimates the name likely to match the next local partner. `--naming-rule wsls` uses win-stay / lose-switch instead. Simultaneous WSLS decisions can exchange mismatched labels and converge slowly; prefix failures are part of the result. Neither rule sees population statistics or receives a persuasion instruction.

**Measurements.** The last 4N actual interactions form a researcher measurement window, separate from personal memory. Measure the alternative's share of ordinary agents' actual choices, their last-choice share, the rolling matching rate and the absolute gap between community choice shares. Exclude fixed agents from adoption shares so the intervention does not mechanically count its assigned advocates as conversions. A community with no recent ordinary choices reports `null`.

Sustained reversal requires a full window, at least one recent activation of every ordinary agent, and both ordinary alternative shares at least 90% for 4N consecutive interactions. Save the confirmation time, rather than inferring an onset, and right censor at the default 2,400-interaction horizon. Detection uses every interaction; stored series are sampled every N interactions.

**Paired estimates.** Report the minority effect within each network and the interaction `(community,k4 − community,k0) − (mixed,k4 − mixed,k0)`. Both label orders change system-prompt order, observation option order and rule sampling order. Average their effects within each seed before summarizing seeds. Label orders and branches are paired observations, not independent populations. One minority size does not establish a tipping threshold; size, placement, memory and graph realizations are distinct follow-up factors.

## Commons: message delivery × temporary drought

**Scientific question.** Does local advice change yield and resource resilience during a temporary regeneration shock? Does it preserve seed-bearing components or shift harvest between agents and periods?

| Factor | Control | Treatment |
| --- | --- | --- |
| Incoming message delivery | `off`: observation contains an empty message list | `on`: nearby recent messages are delivered |
| Weather | Baseline regeneration throughout | Multiplier 0.1 during completed rounds 40–79; baseline returns at round 80 |

Use six agents, identical initial positions and full stock, fixed round-robin activation, baseline regrowth 0.35 and a 240-round horizon. One round contains N activations. Drought scales regeneration probability without directly removing stock or changing capacity, movement, seed requirements or policy objectives. Weather is not announced to agents. End-of-round regeneration uses that completed round's weather.

**Matched environmental noise.** A random field keyed by seed and completed round supplies a draw for every grid cell, including full and barren cells. Resource-dependent eligibility therefore never shifts another cell's draw. Initial placement and policy exploration have separate streams. Paired conditions share environmental noise; their states and policy random consumption may diverge after different decisions.

**Delivery intervention.** Gate incoming observations only. Both conditions retain the same action/message schema, message generation, expiration, publication and researcher monitor. Agents hear other agents' recent messages within Manhattan distance three of the sending position, for two rounds. The prompt requires an exact legal action from the first activation and gives no cooperation instruction. The objective is personal long-run harvest. Messages enforce no quota, sanction, role or reservation.

Analyze three rule controls separately:

- `greedy`: harvest whenever possible and emit no messages.
- `conserve`: leave one unit in each cell and emit no messages.
- `signal`: otherwise greedy, but honor another agent's recent `reserve x y` warning by leaving one unit at that coordinate. Emit a warning when the current fertile cell contains at most two units. Other targets and exploration respect the same reserve. Warnings describe the pre-action cell; publication and hearing use the sender's post-action position, as for all messages.

Signal is a deliberately scripted receiver, so its delivery effect checks the mechanism rather than demonstrating learned cooperation or truthful communication. Greedy and conserve must give identical delivery-on/off trajectories under matched weather; the runner asserts this negative control. It also asserts equal initial physical state and equal paired drought/no-drought state through round 39 for every delivery/policy pair.

**Measurements.** Save per-round stock, yield, Gini, live cells and stock in each connected fertile component. A component becomes irreversibly extinct when all its seed stock reaches zero; individual cells may recover from neighbors. Components are computed from the actual habitat, including patch overlaps on smaller grids.

Report final, mean and minimum stock, total yield, yield during rounds 40–79 and 80–240, first component extinction and final extinct-component count. Recovery requires five consecutive post-shock snapshots at or above 90% of that branch's mean stock over the ten pre-shock snapshots. Save confirmation delay from round 80 and right censoring. A zero reference makes recovery undefined. Equal Gini does not establish sustainability.

Calculate delivery effects within each weather condition and the interaction `(on,drought − off,drought) − (on,normal − off,normal)`. Summarize each policy separately.

## Decisions, evidence and reproducibility

The pure models accept either their built-in rule or a `DecisionTape` provider. For an LLM extension, retain the same four treatments, seed pairing, observations, prompt, model settings and endpoint definitions. Save the complete decisions and generation settings, specify request limits before collection, and distinguish policy randomness from environmental randomness. A tape reuses a response only when its logical index and complete request fingerprint match. Replayed calls and restored continuations are not new samples.

Illegal actions are rejected before world state changes. If using the optional `LegalActionPolicy`, prescribe the same correction limit in every condition and save rejected responses and correction requests. Correction is an additional policy step at unchanged world state, not a rule fallback. Report corrected runs under that decision policy. Long Naming notes remain intact in checkpoints and tapes; only presentation is shortened.

`report.json` indexes settings, source hashes, repository HEAD, timestamps, failed prefixes and descriptive paired effects. Runs retain their initial or treatment checkpoint, final checkpoint, configuration and sampled series. The runner round-trips a saved checkpoint through JSON and repeats the final N actions to check exact continuation. Means, standard deviations and ranges are descriptive summaries; repeated time points, mirrored labels and restored futures do not increase the number of independent seeds.

Current checkpoints and TenSnap state use schema version 2. Version-1 checkpoints and older decision protocols use the Git snapshot documented in [HISTORY](HISTORY.md); saved recordings can still be viewed without running a model.

## Implementation choices and alternatives

Read the examples in this order: model `Config` and agent records; `observation()`; `rule_decision()`; `step()`; measurements and checkpoint validation; then `viz.py`. The model controls transitions, the policy proposes a decision and the view projects state. `experiments.py` adds paired branching and endpoint detection around those components.

| Function | Current choice | Other implementations and their implications |
| --- | --- | --- |
| Complete and nearest-neighbor contacts | `nx.complete_graph`, `nx.cycle_graph` | Both directly express these graph definitions. |
| Degree-controlled mixed contacts | Regular ring plus explicit connected edge swaps | [`nx.random_regular_graph`](https://networkx.org/documentation/stable/reference/generated/networkx.generators.random_graphs.random_regular_graph.html) generates a simple regular graph; check connectivity and record the realized adjacency. [`nx.connected_double_edge_swap`](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.swap.connected_double_edge_swap.html) preserves connectivity and degrees but uses a different sampler. Neither reproduces the same graph from the same seed. |
| Regular ring and small-world contacts | Explicit ring edges before mixing | [`nx.watts_strogatz_graph(n, d, 0)`](https://networkx.org/documentation/stable/reference/generated/networkx.generators.random_graphs.watts_strogatz_graph.html) constructs the even-degree ring. Positive rewiring probability creates a different network family whose individual degrees need not stay fixed. |
| Community contacts | Two regular rings and exactly two bridges | [`nx.stochastic_block_model`](https://networkx.org/documentation/stable/reference/generated/networkx.generators.community.stochastic_block_model.html) controls within/between-block edge probabilities; it does not enforce the same exact degree or bridge count. |
| Fertile components | A small flood-fill over four-neighbor cells | `nx.connected_components` on a habitat graph gives the same partition. A raster connected-component routine is suitable for larger grids if it uses four-neighbor connectivity. |
| Spatial resources | Python lists and explicit synchronous loops | NumPy arrays can express the same update, provided the old grid is read throughout and every cell consumes its prescribed draw in the same order. |
| Agent scheduling | Explicit pair sampling or round-robin activation | Mesa or another ABM scheduler can own agents and activation. Match the simultaneous-information and end-of-round regeneration boundaries before treating results as equivalent. |
| Decision policy | Small rule functions or a replayable JSON provider | A learned policy can use the same observation/action boundary. Its training, memory and correction policy become additional experimental assumptions. |

Changing a graph sampler, activation order or random-number schedule can implement a related model while changing individual trajectories. Record that choice as a new design and rerun matched controls rather than expecting an old tape to fit it.
