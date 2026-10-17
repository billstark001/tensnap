# Naming Game

A deliberately small adaptation of pairwise convention formation, inspired by
[Ashery, Aiello & Baronchelli (Science Advances, 2025)](https://www.lajello.com/papers/sciadv25emergent.pdf).
It is not an exact reproduction of that study's prompts or theoretical baseline.

- Default: 24 agents, two names Q/M, memory of five personal interactions.
- Each tick selects a pair uniformly on a complete network, or a local pair on
  a ring (`--topology ring`). Both choose before either observes the other answer.
- Matching names give both +1; mismatches give both -1. There is no global
  consensus instruction or global population statistic in an agent's prompt.
- Rule mode repeats a successful name or adopts the other name after failure,
  with 0.05 exploration probability. This is symmetric under Q/M relabeling.
- LLM mode sees the same local interaction history and a shuffled name list;
  a short optional note is displayed as a reported observation, not a causal
  explanation of the model's internals.

```bash
# From repository root, in the environment described in ../README.md:
python -m examples.python_llm.naming_game serve --policy rule
python -m examples.python_llm.naming_game serve --policy llm \
  --env-file /path/to/private.env --agents 8 --max-calls 12
python -m examples.python_llm.naming_game batch --seeds 1,2,3 --steps 1000
```

Graph nodes start on a circle and use the renderer's graph layout. Colors are **blue Q**, **amber M**,
and **gray not activated**. Edges show actual interactions from the last 12
ticks, with the newest thicker; they are not the full permitted contact network.
Inspect a node's personal history or set `selected_agent` to its numeric index.

The chart records last-name shares and cumulative pairwise success. The metric
`last_choice_agreement` is the largest last-choice share, not a guarantee that
agents will keep choosing that name. A single trajectory cannot establish a
population-level convention bias. Use repeated runs to investigate whether this
provider/prompt actually differs from the symmetric baseline.

`--exploration` configures the rule baseline and can be changed in the GUI.
Population, memory length and topology are launch-time options. Pair selection
uses a separate RNG from policy sampling/name-list ordering, so equal seeds have
the same pair schedule across decision backends. See [shared workflows](../README.md)
for budgets, checkpoint restoration, local recordings and offline replay.
