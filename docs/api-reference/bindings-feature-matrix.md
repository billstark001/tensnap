# Binding Feature Matrix

This checklist compares the Python, Go, and Julia bindings against the protocol v0.2 feature surface.  It is intended as a maintenance guide when adding or changing bindings.

Legend: ✅ supported, 🟡 partial or intentionally scoped, ❌ not currently implemented.

| Feature | Python (`packages/tensnap-python`) | Go (`packages/tensnap-go`) | Julia (`packages/tensnap-julia`) | Notes / follow-up |
| --- | --- | --- | --- | --- |
| JSON WebSocket simulator server | ✅ | ✅ | ✅ | All three can serve a simulator over WebSocket using JSON. |
| MessagePack transport | ✅ | 🟡 custom codec hook | ❌ | Python exposes `use_msgpack`; Go bundles JSON only but accepts a custom `protocol.Codec`; Julia explicitly rejects `use_msgpack=true` until implemented. |
| Scenario / model orchestration | ✅ | ✅ | ✅ | Python uses `SimulationScenario`; Go uses declarative `binding.Model`; Julia uses `Scenario` plus `register_model!`. |
| Built-in lifecycle actions | ✅ `start`, `step`, `reset` | ✅ `start`, `step`, `reset`, plus `init` | ✅ `start`, `step`, `reset` | Lifecycle IDs must remain aligned with `tensnap-agent` reserved actions. |
| Parameters | ✅ number / enum / boolean / string | ✅ number / enum / boolean / string | ✅ generic builder with type string | Julia supports protocol-compatible parameter payloads; typed convenience wrappers can be added later. |
| Runtime parameter updates | ✅ getter / setter | ✅ setter through model binding | ✅ zero-arg, model-aware, and `(value, model)` setters | Julia tests cover model-aware setters. |
| Actions | ✅ decorator + manual registration | ✅ declarative action router | ✅ builder + handler | Julia supports zero-arg and model-aware handlers. |
| Charts | ✅ single and grouped series | ✅ single and grouped series | ✅ single and grouped series | Julia chart getters support zero-arg and model-aware forms. |
| Environment create/update/delete | ✅ | ✅ | ✅ | Julia exposes environment/layer add/remove helpers and immediate wire broadcasts. |
| Layer types | ✅ agent / grid / edge / patch-like item layers | ✅ agent / grid / edge / patch-like item layers | ✅ agent / grid / patch / edge builders | Julia builder names match common TenSnap layer concepts. |
| Incremental item diffing | ✅ | ✅ | ✅ | Julia tracks `last_items` per layer and emits create/update/delete item deltas using `item_key_fields`. |
| Layer metadata / dependencies | ✅ | ✅ | ✅ | Julia layers include `data` and `dependency_layer_ids`. |
| Assets / screenshots | ✅ server helpers | ✅ protocol emitter methods | ✅ | Julia implements asset meta/data/delete cache, asset sync responses, and screenshot request/response plumbing. |
| Logs | ✅ | ✅ | ✅ | Julia provides `log!`. |
| Decorator / tag discovery | ✅ Python decorators / metadata | ✅ struct tags | ❌ | Julia intentionally starts with explicit builders; macro/tag discovery can be considered after the API stabilizes. |
| Mesa / framework integration | ✅ Mesa handler | N/A | 🟡 Agents.jl-compatible projector/getter helpers | Julia does not depend on `Agents.jl`, but accepts `allagents` or explicit getters. |
| Plain-language model support | ✅ | ✅ | ✅ | Julia example uses plain mutable structs. |
| Headless `tensnap-agent` compatibility | ✅ smoke-tested via JSON | ✅ smoke-tested via JSON | 🟡 protocol-aligned; not executable in current CI image without Julia | Static tests enforce action IDs and payload fields; runtime smoke should be added once Julia is available. |
| Test coverage in repository | ✅ pytest | ✅ go test | 🟡 Julia `test/runtests.jl` plus pnpm static checks | `pnpm --filter @tensnap/julia test` does not require Julia; `test:julia` runs native Julia tests when Julia is installed. |

## Julia parity checklist

- [x] Package metadata uses version `0.2.0` to align with the current TenSnap protocol/package line.
- [x] Lifecycle action IDs are `start`, `step`, and `reset` for `tensnap-agent` compatibility.
- [x] Item payloads use the canonical protocol `items` field.
- [x] Parameters, actions, charts, environments, and layers have Julia builder APIs.
- [x] Plain Julia models are supported without `Agents.jl`.
- [x] Agents.jl-style models are supported through explicit `m -> allagents(m)` getters or `model.agents` / `model.space.agents` discovery.
- [x] El Farol example is split into pure dynamics (`examples/julia/el_farol.jl`) and visualization (`examples/julia/el_farol_viz.jl`).
- [x] Static pnpm checks validate key protocol invariants in environments without Julia.
- [x] Native Julia tests are provided for projectors, scenario lifecycle, incremental diffing, asset cache helpers, CRD helpers, and El Farol dynamics.
- [ ] Add MessagePack transport.
- [x] Add asset cache and screenshot request helpers.
- [x] Add incremental item diffing using `item_key_fields`.
- [ ] Add optional macro/declarative discovery if a Julia-native pattern emerges.
- [ ] Add CI with a Julia runtime and run `pnpm --filter @tensnap/julia test:julia`.
