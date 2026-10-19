# Network interventions and environmental shocks

The `factorial-v1` protocol adds two paired factorial experiments. It is an
exploratory ABM protocol, not a replication of a published benchmark. Run the
rule controls before considering paid inference. The factorial runner imports
no provider configuration and cannot make an LLM request.

```bash
# From the repository root, Python 3.10+. Each output directory must be new.
python -m examples.python_llm.experiments naming --seeds 1,2,3,4,5,6,7,8,9,10,11,12 \
  --output examples/python_llm/artifacts/my-naming-controls
python -m examples.python_llm.experiments commons --seeds 1,2,3,4,5,6,7,8,9,10,11,12 \
  --output examples/python_llm/artifacts/my-commons-controls
```

The environment routes in [README](README.md#choose-a-python-environment) apply.
Headless rules require only the standard library. Use `--help` for horizons and
treatment parameters. These commands create compact time series and checkpoints,
not recordings or image sequences. For visual inspection, use a backend and the
standard [agent recording workflow](README.md#standard-recording-historical-frames-and-restoration).

## Naming: network structure × fixed minority

**Question.** When an alternative convention is advocated by a fixed minority,
does a community network protect the incumbent convention, slow population-wide
replacement, or sustain different local conventions? A different outcome under
the same minority size would identify a dependence on the contact network in
this model; it would not establish a universal tipping threshold.

| Factor | Control | Treatment |
| --- | --- | --- |
| Contact graph | `mixed`: randomized connected regular graph | `community`: two regular communities with two cross-community edges |
| Fixed alternative advocates | 0 | 4 of 24 existing agents |

Both graphs have 24 nodes, degree 4 and 48 undirected edges. A seeded permutation
defines the same two communities in both graphs. The mixed graph starts as a
regular ring and undergoes 20 × N × degree double-edge-swap proposals, rejecting
self-loops, duplicate edges and disconnected proposals. The community graph
joins two degree-4 rings by swapping one edge from each community into two
bridges. These are specified graph families, not uniform samples from all regular
graphs; clustering and path lengths can also differ. Each run saves its full
adjacency, degree sequence, partition and cross-community edge count.

**Shared prefix.** For every seed and each of the `QM`/`MQ` orders, start without
names or fabricated memories on the mixed graph with no fixed agents. Warm up
until last-choice agreement and rolling coordination both reach 90%, with a
full 4N-interaction measurement window, every agent having acted, and the same
majority label satisfying this criterion for N consecutive interactions. The
cutoff is 10,000 interactions. Failure is saved as `no_stable_prefix`; it is not
replaced with another seed. Effects report their number of eligible seeds.

Clone that exact checkpoint into all four conditions. The alternative label is
the opposite of its incumbent convention. Select the same seeded random subset
of existing IDs for both minority treatments. Rewire contacts and replace only
those IDs' decision policy with an always-alternative rule. Population size,
scores, individual memories, current last choices and both RNG cursors remain
intact. Fixed agents earn the same payoffs and remember contacts; they make no
LLM calls and can incur persistent losses. Their assignment is exogenous, not
an agent's inferred commitment. Placement is random, without selecting bridges.

The default ordinary rule is `frequency`: choose the most frequent partner name
in the last five personal interactions; break ties uniformly, and explore with
probability 0.01. It is a local estimate of which name will match the next
partner. The original `wsls` rule remains available through `--naming-rule wsls`.
With simultaneous decisions, WSLS can exchange two mismatched labels and mix
slowly; report prefix failures rather than assuming convergence. These rules
have no population observations and receive no special persuasion instruction.

**Outcomes.** The last 4N actual interactions form a rolling window. Measure the
alternative's share of **ordinary agents' actual choices**, their last-choice
share, rolling matching rate, and the absolute gap between the two communities'
ordinary choice shares. Exclude fixed agents from both shares; otherwise adding
four fixed advocates would mechanically look like conversion. Communities with
no recent ordinary choices report `null`, not zero.

Sustained reversal requires a full window, at least one recent activation of
every ordinary agent, and both ordinary alternative shares at least 90%, for
4N consecutive interactions. Save the **confirmation** time and right censoring
at the 2,400-interaction horizon. This is a prespecified endpoint, not the first
transient majority. Series are sampled every N interactions; detection uses
every interaction. Ordinary choices after treatment can legitimately depend on
their retained pre-treatment personal memories.

The report gives minority effects separately in each network and the interaction
`(community,k4 − community,k0) − (mixed,k4 − mixed,k0)`. Both label orders change
system-prompt option order, observation option order and random rule label order;
their effects are averaged **within each seed** before summarizing independent
seeds. They are paired checks, not extra independent samples. The rule is label
symmetric; future LLM runs need not be. No tipping-point claim follows from a
single minority size; varying size, placement, memory and graph realizations
would be follow-up experiments.

## Commons: message delivery × temporary drought

**Question.** Does access to local advice change yield and resource resilience
during a temporary regeneration shock? Does it help preserve seed-bearing
components, or merely shift harvest between agents or phases?

| Factor | Control | Treatment |
| --- | --- | --- |
| Incoming message delivery | `off`: observations receive an empty list | `on`: nearby recent messages delivered |
| Weather | Baseline regeneration throughout | Multiplier 0.1 during completed rounds 40–79, baseline restored at round 80 |

Use six agents, the same initial positions and full stock, fixed round-robin
activation, baseline regrowth 0.35, and 240 rounds. One round has N activations.
Drought scales the existing regeneration probability; it neither removes stock
directly nor changes capacity, movement, seed requirements or policy objectives.
It is unannounced to agents. Each regeneration event at the end of a round uses
that completed round's weather.

In `factorial-v1`, a separate random field is keyed by seed and completed round.
It supplies one uniform draw for **every grid cell**, including full and barren
cells. Thus changes in harvest or weather never shift another cell's random
test. Initial placement and policy exploration use separate streams. This is
common environmental noise across paired branches, not a promise that their
resources or policy random consumption remain equal after behavior diverges.
The legacy protocol retains its original conditional draw sequence.

Delivery gates only the receiving observation. Both treatments retain the same
JSON action/message schema, message generation, expiration, publication and
researcher message monitor. The `factorial-v1` system prompt uniformly requires
an exact legal-action token from the first activation; no treatment receives a
cooperation instruction. The LLM's objective remains personal long-run harvest.
Messages enforce no quota, sanction, role or reservation.

Three separately analyzed rule controls are included:

- `greedy`: harvest whenever possible; emit no messages.
- `conserve`: leave one unit in each cell; emit no messages.
- `signal`: otherwise greedy, but honor another agent's recent local
  `reserve x y` warning by leaving one unit at that coordinate. When standing on
  a fertile cell with at most two units, emit a warning in both delivery
  conditions. Warnings describe the pre-action cell; publication/hearing uses
  the sender's post-action position, as for all messages. Other targets and
  exploration obey the same temporary reserve. Peers' warnings expire after
  two rounds and are audible within Manhattan distance three of publication.

Signal is a deliberately specified message-using policy. A delivery effect here
validates the mechanism; it is not evidence of learned cooperation, truthful LLM
communication or optimal harvesting. Greedy/conserve must give **identical**
delivery-on/off trajectories under matched weather; the runner asserts this
negative control. It also asserts identical initial physical state and identical
paired drought/no-drought state through round 39 for every delivery/policy pair.

**Outcomes.** Save per-round stock, yield, Gini, live cells and stock in each
connected component of the fertile habitat. A component becomes irreversibly
extinct only when **all** its seed stock is zero; individual depleted cells can
recover from neighbors. Components are calculated from actual habitat, so
overlapping patches on small grids count as one component.

The report includes final and mean stock, minimum stock, total yield, yield in
rounds 40–79 and 80–240, first component extinction, and final extinct-component
count. Recovery is confirmation of five consecutive post-shock round snapshots
at or above 90% of that branch's mean stock over the ten pre-shock snapshots.
Save confirmation delay from round 80 and censoring; a zero reference is marked
undefined. Also report whether the reference is positive. Equal Gini alone says
nothing about sustainability. Off/on effects are calculated within each weather
condition; the interaction is `(on,drought − off,drought) − (on,normal − off,normal)`.
Policies are summarized separately, not pooled as interchangeable populations.

## Evidence, checkpoints and limits

`report.json` indexes all runs and contains settings, source SHA-256 values,
the repository HEAD, timestamp, descriptive seed-level paired effects, failed
prefixes, and the zero-call/zero-cost rule budget. Each run contains its initial
or branch checkpoint, exact final checkpoint, configuration and sampled series.
Each continuation is also checked by restoring a JSON-round-tripped checkpoint
before the final N actions and comparing the exact final state after repeating
those actions. Summaries give mean, standard deviation and range, not significance
claims from twelve populations. Do not treat per-tick observations, mirrored
labels, replay or restored continuations as independent samples.

The model CLI defaults remain `legacy`, preserving old decision inputs and
trajectories. Existing version-1 checkpoints without new config fields load
with legacy defaults. The extended checkpoint fields are additive; factorial
Naming checkpoints additionally retain the treatment boundary and researcher
window. Graphs, minority IDs, habitat components and weather are deterministic
from configuration, seed and tick. Changing observations or prompt protocols
requires a new LLM decision branch; an old tape cannot answer a new treatment.

The `experiments` runner remains rule-only. The individual model CLIs support
the new mechanisms with `--protocol factorial-v1` in rule, replay and LLM modes.
Request/token caps alone are not a currency budget. Slides are outside these
experiments.

## Small live LLM pilot

`llm_experiments` runs one seed with four conditions per model. It reads an
explicit dotenv file as data, requires the official DeepSeek endpoint with
`deepseek-flash` and thinking disabled, and never records credentials. Use a
fresh output directory:

```bash
# Paid requests. The combined guard covers BOTH models, all branches and failures.
python -m examples.python_llm.llm_experiments run \
  --env-file /path/to/private.env \
  --output examples/python_llm/artifacts/my-llm-pilot

# Verify completed trajectories and checkpoints without credentials or live access.
python -m examples.python_llm.llm_experiments verify \
  --input examples/python_llm/artifacts/my-llm-pilot
```

The default pilot keeps Naming at N=24, degree=4 and minority 0/4. It uses a new
LLM warmup on the mixed network, with the same stability criterion and a cutoff
of 384 interactions, then follows each of four branches for 384 interactions.
If the prefix fails, its failure is retained; seeds and memories are not replaced.
Commons keeps N=6 and follows all four conditions for 48 rounds, with drought
at completed rounds 12–23 and baseline regeneration restored at round 24. It
also runs free rule controls at these shorter horizons in `rule-matched/`;
the earlier 12-seed rule study is preserved separately.

This is **one independent seed per model, with QM order only**. It checks live
behavior and experiment plumbing, not statistical significance, tipping points,
or label bias. Short-horizon reversal/recovery is censored as specified; a
failure or unchanged outcome is a result, not a reason to change prompts.

Each branch has its own logical decision cursor. A shared tape pool coalesces
responses only when logical index, system prompt and full observation fingerprint
are identical. This couples identical pre-intervention policy draws across
paired conditions, including the Commons prefix before drought. Changed
observations need fresh responses. Reused responses are marked in decision
traces and do not add independent samples. At most four HTTP calls are active.

Before each HTTP dispatch, the shared spending guard reserves a conservative
input bound (UTF-8 content bytes plus 1,024 framing tokens for two text messages)
and the output cap of 192 tokens. It uses the verified peak Flash prices of
¥2/million input tokens and ¥8/million output tokens, ignoring cache/time
discounts and applying a further factor of 1.25. Reported usage releases unused
reservations; absent usage or uncertain failed requests consume the full
reservation. Paid usage never rewinds on restore. The internal combined limit
is **¥9.50**, below the authorized ¥10, with at most 5,000 requests and no automatic
retry or rule fallback. A missing/malformed result stops its branch. Model/price
metadata and balance snapshots are kept for audit. See [official pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
and the [balance API](https://api-docs.deepseek.com/api/get-user-balance/).

`plan.json` freezes source hashes and settings before paid collection.
`budget.jsonl` journals every reservation and settlement; `budget-summary.json`
reports the cost upper bound and safety-adjusted debit. `balance.json` keeps
before/after account snapshots, which may include unrelated account activity.
Each model has a portable branched `decisions.jsonl`; each condition retains its
initial/final checkpoint, actions/interactions, time series and decision trace.
All completed model steps are verified by replay against the exact final state.

For native multi-frame recording without new calls, serve an individual recorded
case and use the standard bounded agent recording workflow:

```bash
python -m examples.python_llm.llm_experiments serve-case \
  --input examples/python_llm/artifacts/my-llm-pilot \
  --case naming/mixed-k0 --port 8765
```

Other cases are `naming/mixed-k4`, `naming/community-k0`, `naming/community-k4`,
and `commons/{off,on}-{normal,drought}`. Bound the agent run to that result's
`completed_steps`; beyond the recorded branch, replay fails rather than calling
a provider. Initial Naming scene time is its shared prefix's tick, not zero.

### If the live warmup does not stabilize

The original protocol records failed convention formation and does not silently
replace its seed or histories. To still inspect the four intended treatments,
`naming_pilot_continuation` can make a separately labeled exploratory comparison
from that exact capped, unmodified population:

```bash
python -m examples.python_llm.naming_pilot_continuation \
  --input examples/python_llm/artifacts/my-llm-pilot \
  --env-file /path/to/private.env
```

It requires the original process to have settled, no existing Naming branches,
and a warmup that reached its cutoff without an API/decision error. It writes
`naming-unstable-prefix/`, preserving the original failure and report. The new
ledger subtracts all previous spending and calls from the **same** original
¥9.50/5,000-request limits. It does not grant another budget. Both stages' source
hashes, balances and separate journals remain available. The comparison concerns
target adoption and community differences in an unsettled naming population;
it cannot establish replacement of a mature convention, even if a later adoption
threshold is crossed. Document this conditional supplement before observing any
treatment outcomes. A failed individual decision is never retried or substituted.

### Explicit repair of the two failed pilot cases (2026-10-19)

The original pilot and its no-retry failures remain immutable. `repair_pilot`
resumes only Naming `community-k4` and Commons `on-drought`, from their final
valid checkpoints, at the original horizons of 384 branch interactions and
48 rounds. Its plan freezes the modified source and original result hashes
before new inference. All previous requests and spending count toward the new
cumulative authorization of ¥12; the guard stops at ¥11.50 including its 25%
safety factor, and retains the original combined 5,000-request cap.

Naming failed on a valid name with a 165-character note. Full notes are now
retained; display alone is shortened to 160 characters. Its previously paid
answer can be reused exactly. The graph refactor to `ContactNetwork` uses
NetworkX but preserves the original sampler, partition and contact RNG.
`legacy` remains necessary for historical checkpoint/tape replays, particularly
Commons' older conditional regeneration and message-delivery semantics.

Commons failed at activation tick 260: agent_2 was at (9,3), all 13 visible
cells had zero stock, and `legal_actions` excluded `harvest`. The JSON answer
nevertheless selected `harvest`, saying it would take one unit. Recent messages
and the agent's own history described a rotating harvest plan. This supports a
hypothesis of stale-plan following, not an environment accounting or legal-list
bug; a single answer cannot establish the model's internal cause. The strict
rejection correctly left state, RNG and decision cursor unchanged.

For this diagnostic continuation, `LegalActionPolicy` retains that rejected
answer and permits one correction with explicit current-cell and legal-action
feedback, without advancing the world. It never picks a rule action. Corrections
are recorded separately and counted toward the same spending cap. This is a
changed decision protocol after the failure boundary: report it alongside the
original no-retry result, not as a clean replacement or independent replicate.
Naming's unstable warmup and the single-seed limitations remain unchanged.

```bash
python -m examples.python_llm.repair_pilot run \
  --input examples/python_llm/artifacts/factorial-llm-pilot-20261019 \
  --output examples/python_llm/artifacts/factorial-llm-repair-20261019 \
  --env-file /path/to/private.env
python -m examples.python_llm.repair_pilot verify \
  --input examples/python_llm/artifacts/factorial-llm-repair-20261019
```

The repair directory stores new responses only. Original tapes are referenced
read-only and merged by exact index/fingerprint; conflicting records are
rejected. Offline verification checks both the complete trajectory from the
original treatment checkpoint and the continuation from the failure checkpoint.
`serve-case --input ... --case naming/community-k4` (or `commons/on-drought`)
serves the repaired complete trajectory with no credentials. Add `--suffix` to
record just the continuation; otherwise use the standard multi-frame recording
workflow over its complete original horizon. Original recordings are preserved.
