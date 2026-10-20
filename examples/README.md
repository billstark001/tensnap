# Example guide

Start with a model's scientific question and tick definition, then inspect its binding. A runnable visualization demonstrates a modeling mechanism or a TenSnap API; it does not establish an empirical result. All stochastic examples own their RNGs. Seed is an ordinary initialization setting; reset repeats a fixed-seed experiment.

| Example | Learning objective and model variant | One model tick |
| --- | --- | --- |
| [Python random walk](python/random_walk.py) | First agent layer, parameters and charts; independent isotropic fixed-length walks on a torus | Every walker takes one step; unwrapped MSD is retained |
| [Python flock](python/flock.py) | Derived projections, coordinated motion and checkpoint continuation; a Boids-inspired teaching variant | All velocities read the old state, then all positions advance with wrapping |
| [Python adaptive HK](python/hk.py) | Directed network projection and bounded-confidence influence with inertia, random non-neighbor contacts and rewiring | Synchronous continuous opinions, followed by sequential rewiring |
| [Python predator/prey](python/predator_prey.py) | Multiple agent layers and a native grass matrix; a discrete renewable-resource ecosystem | Grass regrowth, sheep movement/feeding/reproduction, then wolves |
| [Python SIRS](python/sirs.py) | Compare interaction topologies using the same synchronous transition rules | Read old disease states, sample transitions, then commit together |
| [Mesa Game of Life](python_mesa/cgol.py) | Native matrix projection and restore; Conway's deterministic cellular automaton after seeded initialization | Apply the cellular rule simultaneously |
| [Mesa gradient Sugarscape](python_mesa/sugarscape.py) | Renewable resources and heterogeneous foragers; a one-cell gradient variant, not a canonical-model reproduction | Random sequential agents move/harvest/metabolize/die; then field regrowth |
| [Mesa mushroom search](python_mesa/mushroom.py) | Area-restricted search and a persistent random-search control | Activate hunters in random order; each may harvest one mushroom |
| Schelling in [Mesa](python_mesa/schelling.py), [Go](go/internal/schelling/model.go), [JS](js/src/models/schelling.ts), [Julia/Agents.jl](julia/schelling.jl) and [NetLogo](python_mesa/schelling.nlogox) | Local preferences and emergent segregation; bounded Moore-grid batch relocation | Classify unhappy agents and empty cells, shuffle each list, pair movers with cells empty at tick start |
| [JS Axelrod](js/src/models/axelrod.ts) | Asynchronous cultural influence and native matrix restore | `updatesPerTick` pairwise micro-updates |
| [JS Tornberg](js/src/models/tornberg.ts) | Partisan sorting extension, topology and nonlocal contacts | `updatesPerTick` cultural micro-updates; sorting diagnostics are sampled every five ticks |
| [JS wolf/sheep](js/src/models/wolf-sheep.ts) | NetLogo-inspired continuous movement, predation and resource regrowth | Sheep, wolves, then grass; fixed array activation order |
| [Go forest fire](go/forest_fire/model.go) | Stochastic cellular transitions, native matrix projection and restore | One full forest update; see its source for update order |
| [Julia adaptive bar](julia/el_farol.jl) | Noisy adaptive expectations and exact continuation; inspired by El Farol without competing predictor selection | All patrons decide from past attendance, then attendance and diagnostic scores update |
| [Fire/DQN](python_dqn/MODEL.md) | Advanced policy/environment separation with transparent heuristic controls | A documented evacuation round; the policy chooses a guide action |
| [LLM naming/commons](python_llm/README.md) | Advanced local decisions, rule controls, response tapes and model-owned checkpointing | One interaction/activation, as specified in each model guide |

## Experiments to try

- Random walk: increase the number of walkers and compare unwrapped mean squared displacement with `ticks × step_size²`. Wrapped distance from the center is bounded and is a different observable.
- Flock: vary separation, alignment and cohesion radii independently. Compare order parameter and speed; inspect two birds on opposite edges to understand toroidal neighborhoods.
- Adaptive HK: set rewiring and random contacts to zero, then introduce each extension separately. A contact receives one vote even when it is already a graph neighbor.
- Mushroom: compare `area_restricted=True` and `False` over the same initial seeds. Report cumulative mushrooms per hunter per tick, remaining resources, and search age. Matching seeds match initial landscapes, not necessarily every later random draw across strategies.
- Gradient Sugarscape: compare random and two-peak fields, vision bounds and metabolic costs. Population decline is a possible outcome: there are no births or trade.
- Schelling: sweep similarity thresholds and density over several seeds. A full grid can jam while most agents remain unhappy; a stopped run is not automatically a satisfied run.
- Adaptive bar: vary capacity and inspect attendance fluctuations. The score is recorded for interpretation and does not select a strategy.

## Schelling metric and stopping definitions

An occupied agent with no occupied neighbors is satisfied. Satisfaction rate is the satisfied fraction of the occupied population; an empty population reports zero. Segregation is the mean same-group neighbor fraction over agents with at least one occupied neighbor, or zero when there are none. These denominators differ.

In convergence mode, a no-movement step stops a trial. `satisfied` means there are no dissatisfied agents, including the vacuous empty-population case; `jammed` means dissatisfaction remains but no relocation occurred. `limit` means the requested step budget was exhausted (always the stopping reason in steady mode). Scientific CSV counts each reason separately. Historical `converged_runs` used the broader no-movement meaning.

## Code and evidence boundaries

Language READMEs provide launch commands and restore coverage. Projection-only restoration does not imply RNG restoration. Schelling and other checkpoint examples use the existing binding checkpoint hooks; there is no TenSnap RNG service.

Scientific studies output domain results only. Warmup, timing and independent audit writers live in [benchmark subjects](../benchmarks/schelling/v1/README.md). The DQN replay warmup and the LLM experiments' scientific burn-in are model/experiment operations, not benchmark warmup.

See the [reproducibility contract](../docs/maintainer-guide/reproducibility.md) for seed/reset/checkpoint semantics and checks. Historical evidence retains its original source, model variants, schemas and metric definitions. Current fixes do not modify those datasets or claim that old figures were produced by the current code.
