# Naming Game

A small pairwise coordination model inspired by [Ashery, Aiello & Baronchelli (Science Advances, 2025)](https://arxiv.org/abs/2410.08948). This implementation defines its own two-name game, prompts and rule baseline; it is not a replication of that study.

## Scientific purpose

How do agents using only recent personal interactions coordinate on a shared convention? How do memory, contact topology and policy affect formation and persistence? Matching is individually rewarded, but agents receive no global consensus instruction or population statistics.

The model supports complete/ring contacts and a degree-controlled mixed/community comparison with a fixed alternative-name minority. The main intervention asks whether community structure protects an established convention or supports persistent local disagreement. Inspecting individual histories connects aggregate choices to contacts. Repeated independent populations are needed; the supplied rules do not establish an LLM advantage.

See the [factorial protocol](../EXPERIMENTS.md#naming-network-structure--fixed-minority) for the graph generator, shared stable prefix, minority assignment, label counterbalancing, sustained reversal endpoint and paired estimands. Run all four conditions with `python -m examples.python_llm.experiments naming --output /path/to/new-results`.

## Run the backend

Choose a [Python environment](../README.md#choose-a-python-environment), then run from the repository root:

```bash
python -m examples.python_llm.naming_game serve --policy rule --port 8765
```

Connect the GUI to the printed URL or follow the [minimal agent CLI path](../README.md#connect-the-agent-cli-minimal-path). The backend waits for actions; stop it with Ctrl-C.

```bash
# Headless rules: Python 3.10+ and NetworkX, no binding or API access.
python -m examples.python_llm.naming_game batch --policy rule \
  --seeds 1,2,3 --agents 24 --memory 5 --topology ring --steps 1000

# Existing tape: configuration and prompts must match its original run.
python -m examples.python_llm.naming_game serve --policy replay \
  --agents 8 --seed 7 --memory 5 --topology complete \
  --replay /path/to/naming-decisions.jsonl --port 8765

# Live inference: actions can make paid requests, two per interaction.
python -m examples.python_llm.naming_game serve --policy llm \
  --env-file /path/to/private.env --agents 8 --max-calls 12
```

See [shared workflows](../README.md) for credentials, caps, recordings and restoration.

## State and parameters

| Setting | Default | Meaning |
| --- | --- | --- |
| `--agents` | 24 | Population, 2–200; stable IDs `agent_0`, … |
| `--seed` | 7 | Initial seed for contact and policy RNG streams |
| `--memory` | 5 | Each agent's last 1–12 personal interactions |
| `--topology` | `complete` | Permitted contacts: `complete`, `ring`, `mixed`, `community` or `barbell` |
| `--initial-names` | `unassigned` | `unassigned`, `all-q`, `all-m`, `balanced` or `polarized` by community |
| `--layout` | `circle` | `circle`, two `communities`, seeded `spring` or `grid`; changes positions only |
| `--scenario` | none | Load a named preset after the other launch settings |
| `--exploration` | 0.05 | Rule-only probability of a fresh uniform choice, in [0, 1] |
| `--degree` | 4 | Mixed/community degree; even and below N/2, with even N |
| `--committed` | 0 | Existing agents assigned an exogenous fixed-name policy |
| `--committed-name` | `M` | The fixed choice; no LLM requests for fixed agents |
| `--label-order` | `QM` | `QM` or `MQ`; factorial mode counterbalances system/observation/rule ordering |
| `--rule` | `wsls` | Original `wsls` or empirical partner-`frequency` policy |

By default, agents start without a name, at score zero, with empty history. An initial-name assignment sets their current convention without fabricating encounters or payoffs. A rule agent uses that convention on its first activation; subsequent activations use its ordinary memory rule and exploration. LLM observations include `current_name` for these initialized conditions. `balanced` uses a separate seeded permutation; `polarized` assigns Q to community 0 and M to community 1. Names remain Q and M. There is no movement or population turnover during a run. In factorial mode, fixed agents keep their histories/payoffs but always choose their assigned name. The experiment runner changes contact topology and fixed-agent assignment at the shared checkpoint without clearing personal memory or resetting stochastic cursors. A direct model CLI launch applies its configured minority from tick zero; use the factorial runner for the established-convention experiment.

`seed`, `policy`, `scenario`, `agent_count`, `topology`, `degree`, `initial_names` and `layout` stage choices for the next Reset. Selecting a preset replaces pending scene edits; edit individual controls afterward to customize it. Preset population/layout/name values appear in their controls after Reset. Population changes also update the selected-agent range and clamp an out-of-range selection. Checkpoints retain both active and pending configurations and can restore a different population. Memory remains a launch setting. Provider policies require the matching launch-time credentials or replay tape. `exploration` can be edited at runtime but affects rule mode only. Reset restarts the selected seed; **Reset with next seed** starts the next seed.

| Preset | Population | Initial names | Shape |
| --- | --- | --- | --- |
| `small-population` | 12 | Unassigned | Ring |
| `large-population` | 64 | Unassigned | Mixed regular network |
| `all-q`, `all-m`, `balanced` | 24 | All Q, all M, seeded 50/50 | Mixed regular network |
| `two-communities` | 24 | Q/M by community | Two degree-four communities with two bridges, arranged as in the slides |
| `barbell-polarized` | 24 | Q/M by community | Two cliques connected by one bridge |
| `spring-network`, `grid-network` | 24 | Unassigned | Same mixed contacts, different placement |

Complete/ring and the four factorial presets remain available. The original factorial conditions retain unassigned names and circle coordinates, with four fixed agents in minority presets. They retain the current rule and exploration; match the runner's `frequency` / 0.01 launch settings when comparing its defaults. The `custom` value represents a configuration outside a named preset. Full permitted contacts appear in a faint background layer, with cross-community links highlighted; recent interactions appear above it. Both edge layers disable force simulation. `spring` computes a seeded layout once at initialization, without a live force simulation.

```bash
python -m examples.python_llm.naming_game serve --scenario two-communities
python -m examples.python_llm.naming_game serve --scenario barbell-polarized
python -m examples.python_llm.naming_game run --agents 48 --topology community \
  --initial-names polarized --layout communities --steps 100
```

## One interaction, in order

1. Select the first agent uniformly. On a complete network, select its partner uniformly from everyone else; on a ring, select its left or right neighbor with equal probability.
2. Ask both agents for Q or M using their pre-interaction histories. LLM requests are sequential, but neither sees the other's new answer, so choices are simultaneous in information terms.
3. Validate both answers before committing state. Matching gives both +1; different choices give both −1.
4. Advance tick by one, set last choices/decisions, and append partner identity, own/other choices, success and payoff to each participant's bounded history.
5. Update recent-contact edges and publish metrics, monitors and charts.

One tick is **one pairwise interaction**, not a population round. Failed decisions restore stochastic cursors and leave state/tick unchanged; paid requests remain counted. Separate RNG streams control contacts and policy sampling. Equal seed, population and topology give the same pair schedule across decision backends; both RNG states are checkpointed.

## Information and decision policies

The LLM sees its ID, run seed, a shuffled Q/M option list, recent personal interactions and, for initialized-name conditions, its current name. It receives no global choice shares, other agents' private memories or partner's next choice. The system prompt specifies payoffs and asks it to maximize score. It returns `{"name":"Q or M","note":"..."}`. The prompt requests a short optional note, but a longer string does not invalidate the name or stop the experiment. The full text remains in the model, checkpoint and decision tape; the node/selected-agent display shortens it to 160 characters with an ellipsis. Notes are not added to subsequent interaction histories or treated as internal reasoning.

The original rule chooses uniformly with empty history or during exploration. Otherwise it repeats its previous choice after success and adopts its partner's previous choice after failure. `frequency` chooses the most frequent partner name in personal memory and breaks ties uniformly, with the same exploration mechanism. Both are symmetric under Q/M relabeling. The label order changes the system-prompt order as well as observation and rule sampling order. Counterbalancing does not by itself demonstrate absence of LLM bias.

For an inspectable new-mechanism backend (minority active from launch):

```bash
python -m examples.python_llm.naming_game serve --policy rule \
  --topology community --degree 4 --agents 24 \
  --rule frequency --exploration .01 --committed 4 --committed-name M
```

## Measurements and visualization

These are researcher observations, not global information given to policies:

| Metric | Definition | Interpretation |
| --- | --- | --- |
| `q_share`, `m_share` | Agents last choosing Q/M, divided by population | Current last-choice shares |
| `unseen_share` | Fraction without any choice yet | Agents not yet activated |
| `coordination_rate` | Successful / completed interactions; zero initially | Cumulative pairwise success |
| `last_choice_agreement` | Larger of Q/M last-choice shares | Instantaneous agreement, not persistence |

Charts `names` and `coordination_rate` show those series. Monitors include `metrics`, `selected_agent`, `last_interaction` and `inference`. Set `selected_agent` to the numeric index or inspect a node for its history/decision.

`contact_network` reports actual allowed adjacency, community membership and fixed IDs. The metrics monitor reports ordinary-agent recent choice/last-choice shares, rolling coordination, community shares/gap and the treatment boundary; the `ordinary_target_share` chart tracks recent adoption. Its 4N-interaction window is researcher state, separate from each agent's bounded personal memory. Undefined recent shares are `null`; the factorial runner evaluates the sustained reversal criterion on every step.

The share chart uses zero before any ordinary choice is observed; check `ordinary_recent_choices` and the nullable metric to distinguish an empty window from an observed zero share.

Nodes start on a circle and use the renderer's graph layout. Blue is Q, amber is M, gray is not yet activated. Edges show actual contacts from the last twelve ticks, retaining the latest per pair; the newest is thicker. They do not show the full permitted network. Display layout is separate from fixed projected model coordinates.

## Interpreting an experiment

Agreement of one means all last choices align at that instant. Stable convention formation requires a stated persistence window or further analysis. Cumulative success can hide recent instability, so inspect the event sequence too.

Convention-bias experiments need independent runs, recorded provider/prompt settings, initial individual-preference measurements and label/order controls. One converged trajectory cannot establish collective bias. Replaying a tape checks reproducibility and adds no independent sample. See [replay and restoration](../README.md#standard-recording-historical-frames-and-restoration).

`scenarios.py` owns the named conditions, initial positions, seeded community partition, minority order and topology selection. It uses `nx.complete_graph` and `nx.cycle_graph` for simple topologies and composes the paired networks from the generic operations in `network.py`. `ContactNetwork` stores the frozen graph and its inspection data. The explicit swap loop fixes edge ordering and random consumption. `nx.random_regular_graph` and `nx.connected_double_edge_swap` offer shorter alternative generators; changing the sampler changes the realized graph, and positive-probability Watts–Strogatz rewiring does not preserve every node's degree. See the [implementation alternatives](../EXPERIMENTS.md#implementation-choices-and-alternatives) for the assumptions each choice preserves.

For a first reading, follow `observation()` → `rule_decision()` → `step()` → `_apply_interaction()`. The frequency rule's tie handling lives in `_most_frequent_partner_name()`; researcher metrics are kept separate from policy input. After understanding the pure model, read `viz.py` for the projection and `experiments.py` for paired checkpoint branching.

Checkpoints use schema version 2. Historical tapes and version-1 checkpoints use the [historical Git snapshot](../HISTORY.md).
