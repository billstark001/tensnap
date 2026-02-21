# TenSnap Layer Plugin Authoring Guide

This guide explains how to create custom layer types for TenSnap and register
them with the Layer Registry so the frontend can validate and display them.

---

## Overview

The TenSnap layer system is extensible via a **Layer Registry**. Each layer type
has a string identifier (e.g. `"agent"`, `"edge"`, `"grid"`, `"background"`)
and optional [Zod](https://zod.dev/) schemas for:

| Schema | Used for |
| --- | --- |
| `metadataSchema` | The `data` field of `env_layer_create` / `env_layer_update` messages |
| `entitySchema` | Full entity objects in `agent_create` / `edge_create` |
| `entityDiffSchema` | Diff objects in `agent_update` / `edge_update` |

Schemas are **advisory** — unknown or invalid data is accepted with a console
warning, never silently dropped.

---

## Quick Start

```typescript
import { registerLayerType } from 'tensnap-web';
import { z } from 'zod';

registerLayerType({
  layer_type: 'heatmap',
  label: 'Heatmap Layer',

  // Metadata schema: validates the `data` field in env_layer_create / env_layer_update
  metadataSchema: z.object({
    colormap: z.enum(['viridis', 'plasma', 'inferno']).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }).passthrough(),

  // This layer type does not carry agent or edge entities
  hasAgents: false,
  hasEdges: false,
});
```

Call `registerLayerType` **before** establishing the WebSocket connection so
the first incoming `env_layer_create` for your layer type is validated correctly.

---

## `LayerTypeDefinition` reference

```typescript
interface LayerTypeDefinition {
  /** Unique string key, e.g. "heatmap". Must not clash with built-in types. */
  layer_type: string;

  /** Human-readable label shown in the UI. */
  label?: string;

  /**
   * Zod schema for the `data` field in env_layer_create / env_layer_update.
   * Use `.passthrough()` to allow extra keys.
   */
  metadataSchema?: ZodType;

  /**
   * Zod schema for full entity objects (agent_create / edge_create payloads).
   * Only needed when the layer manages a large, growing entity collection.
   */
  entitySchema?: ZodType;

  /**
   * Zod schema for partial entity diffs (agent_update / edge_update payloads).
   */
  entityDiffSchema?: ZodType;

  /** True when this layer carries agents (agent_create / agent_update / agent_delete). */
  hasAgents?: boolean;

  /** True when this layer carries edges (edge_create / edge_update / edge_delete). */
  hasEdges?: boolean;
}
```

---

## Built-in Layer Types

| `layer_type` | `hasAgents` | `hasEdges` | Description |
| --- | --- | --- | --- |
| `agent` | ✓ | — | Agents with optional `x`, `y`, `heading` (grid or free-form). |
| `edge` | — | ✓ | Directed/undirected edges with d3-force layout. |
| `grid` | — | — | Parametric multi-scale grid overlay (no entities). |
| `background` | — | — | CSS color or image fill; data contains `background` and optional `interpolation`. |

Built-in types are registered automatically at module load time. You may
**overwrite** a built-in type by calling `registerLayerType` with the same
`layer_type` string after the module has loaded, which will emit a console
warning.

---

## Python Side

On the Python/server side, emit the new layer type with:

```python
runner.create_env_layer(
    env_id="my_env",
    layer_id="heat",
    layer_type="heatmap",
    data={"colormap": "viridis", "min": 0.0, "max": 1.0},
)
```

See the [Python API reference](../api-reference/python-api.md) for details.

---

## Using the Registry Programmatically

```typescript
import { layerRegistry } from 'tensnap-web';

// Check if a type is registered
layerRegistry.has('heatmap');            // → true

// Retrieve the definition
const def = layerRegistry.get('heatmap');

// Validate layer metadata
const result = layerRegistry.validateMetadata('heatmap', { colormap: 'viridis' });
if (!result.success) console.warn(result.error);

// List all registered types
for (const def of layerRegistry.getAll()) {
  console.log(def.layer_type, def.label);
}
```

---

## Rendering Custom Layers

The Layer Registry handles **data validation and state management**. Rendering
custom layer types requires additional work in the frontend UI:

1. Implement a rendering layer class extending `BaseLayer` from `tensnap-web-core`.
2. Create a corresponding `Storage` class extending `BaseStorage`.
3. Wire the two together in a React component, similar to `GridEnvironmentView`
   or `GraphEnvironmentView`.
4. Register the component so `AnchoredEnvironmentView` renders it when
   encountering your `layer_type`.

> **Note**: A higher-level component registration API (analogous to
> `registerLayerType`) is planned for a future milestone.

---

## Reserved Layer IDs

The following `layer_type` strings are reserved for built-in use:

- `agent`
- `edge`
- `grid`
- `background`

Custom layer types should use a namespaced prefix (e.g. `mypkg.heatmap`) to
avoid future collisions.

---

## References

- [Protocol v0.2](./protocol-v0.2.md) — full message spec for `env_layer_*`, `agent_*`, `edge_*`
- [Architecture](./architecture.md) — rendering layer design
- [Roadmap](./roadmap.md)
