# Mini Commons Harvest

A small spatial common-pool resource dilemma inspired by
[Commons Harvest / Melting Pot](https://github.com/google-deepmind/meltingpot)
and [GovSim](https://github.com/giorgiopiatti/GovSim). The grid, regeneration law,
local messages and baselines here are an independent simplified model; this
example does not reproduce either benchmark.

- Default: a 12 × 9 grid, three fertile patches, six harvesters, four remembered
  personal activations. Agents may share a cell.
- One tick activates one agent in fixed round-robin order. Legal actions are
  north/south/east/west, harvest one unit, or wait. There is no wraparound.
- An agent sees cells and peers within Manhattan distance two. It can send an
  optional message to observers within distance three of the sending location.
  Messages expire after two rounds. No LLM receives the global resource total.
- Each complete round regenerates resources synchronously. A fertile cell below
  capacity three gains one unit with probability `regrowth × s / 5`, where `s`
  is the number of resource-bearing cells among itself and its cardinal neighbors
  **before** that regeneration event. Barren cells never regenerate. A patch with
  no remaining seeds in itself or adjacent cells cannot recover spontaneously.
- Rule `greedy` harvests any available current-cell resource; `conserve` harvests
  only above one unit. Otherwise agents move toward visible harvestable cells or
  explore. Rule agents send no messages.
- LLM mode chooses among the same legal actions and may communicate. There are
  no quotas, assigned roles, sanctions, births, deaths or scripted agreements.

```bash
# From repository root, in the environment described in ../README.md:
python -m examples.python_llm.mini_commons_harvest serve --policy rule --rule greedy
python -m examples.python_llm.mini_commons_harvest serve --policy rule --rule conserve
python -m examples.python_llm.mini_commons_harvest serve --policy llm \
  --env-file /path/to/private.env --agents 4 --max-calls 8
```

The resource layer uses pale gray for barren cells, tan for depleted fertile
cells, and increasing greens for one to three resource units. Purple circles
are agents. Cell inspection exposes resource and fertility; agent inspection
shows harvest, last action, message and personal history. Monitors retain recent
local messages and the last activation. Charts show global remaining resource,
total harvest and harvest Gini; these are researcher observations.

`regrowth` and the rule strategy can be edited at runtime. The strategy setting
affects rule mode only. Grid shape, population and memory are launch-time options.
Rule sampling and environmental regeneration use independent RNGs, both captured
in checkpoints. Cooperation, division of work or negotiated restraint are possible
observations to investigate, not guaranteed outcomes or demonstrated advantages
of LLMs. See [shared workflows](../README.md) for repeated runs, budgets and replay.
