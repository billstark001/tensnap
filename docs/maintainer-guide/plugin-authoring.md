# TenSnap Layer Plugin Authoring Guide

This guide explains how to create custom layer types for TenSnap and register
them with the Layer Registry so Scenario, snapshot replay, and browser/headless
hosts can validate, store, and render them.

---

## Overview

The TenSnap layer system is extensible via a single **Layer Registry**. Each
layer type has a string identifier (for example `"agent"`, `"edge"`,
`"grid"`, `"background"`, or `"mypkg.heatmap"`) and can register one or more
of the following capabilities:

| Registration field | Used for |
| --- | --- |
| `metadataSchema` | Validate the `data` field in `env_layer_create` / `env_layer_update` |
| `itemSchema` | Validate full item objects in `item_create` |
| `itemDiffSchema` | Validate item diffs in `item_update` |
| `storageFactory` | Create the live storage instance held by `Scenario` |
| `fromSnapshot` | Reconstruct storage during snapshot replay |
| `controller` | Handle metadata application, item CRUD, dependency reactions, and asset events |
| `view` | Provide scene bounds and preferred view-metadata sources |
| `renderer` | Participate in render planning, snapshot extraction, and live layer creation |

Schemas are **advisory** - unknown or invalid data is accepted with a console
warning, never silently dropped.

If you only need validation, the schema fields are enough. If you want your
layer to support `item_*`, snapshot replay, or rendering, register the
corresponding runtime hooks too.

---

## Quick Start

```typescript
import {
  registerLayerType,
  type LayerStorage,
  type ScenarioLayerSnapshot,
} from '@tensnap/core/scenario';
import { z } from 'zod';

type HeatmapCell = {
  id: string;
  value: number;
};

class HeatmapStorage implements LayerStorage {
  private readonly cells = new Map<string, HeatmapCell>();

  dump(): unknown {
    return { cells: [...this.cells.values()] };
  }

  load(snapshot: unknown): void {
    this.cells.clear();

    const cells = (
      typeof snapshot === 'object'
      && snapshot !== null
      && Array.isArray((snapshot as { cells?: unknown }).cells)
    )
      ? (snapshot as { cells: HeatmapCell[] }).cells
      : [];

    for (const cell of cells) {
      this.cells.set(cell.id, { ...cell });
    }
  }

  upsert(items: HeatmapCell[]): void {
    for (const item of items) {
      this.cells.set(item.id, { ...item });
    }
  }

  remove(ids: string[]): void {
    for (const id of ids) {
      this.cells.delete(id);
    }
  }
}

registerLayerType({
  layer_type: 'mypkg.heatmap',
  label: 'Heatmap Layer',

  metadataSchema: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    colormap: z.enum(['viridis', 'plasma', 'inferno']).optional(),
  }).passthrough(),

  itemSchema: z.object({
    id: z.string(),
    value: z.number(),
  }),

  itemDiffSchema: z.object({
    id: z.string(),
    value: z.number().optional(),
  }),

  primaryKeyFields: ['id'],
  storageFactory: () => new HeatmapStorage(),
  fromSnapshot: (snapshot: ScenarioLayerSnapshot) => {
    const storage = new HeatmapStorage();
    storage.load(snapshot.storageSnapshot ?? {});
    return storage;
  },
  controller: {
    createItems: (context, items) => {
      context.requireStorage(HeatmapStorage, 'mypkg.heatmap').upsert(items as HeatmapCell[]);
    },
    updateItems: (context, items) => {
      context.requireStorage(HeatmapStorage, 'mypkg.heatmap').upsert(items as HeatmapCell[]);
    },
    deleteItems: (context, items) => {
      const ids = items.filter((item): item is string => typeof item === 'string');
      context.requireStorage(HeatmapStorage, 'mypkg.heatmap').remove(ids);
    },
  },
  view: {
    getSceneBounds: (metadata) => (
      typeof metadata.width === 'number' && typeof metadata.height === 'number'
        ? { width: metadata.width, height: metadata.height }
        : undefined
    ),
    sceneBoundsPriority: 20,
  },
});
```

Call `registerLayerType` **before** constructing `Scenario`, opening a
WebSocket connection, or replaying snapshots so `storageFactory`,
`fromSnapshot`, and `renderer` are available from the first layer message.

If you also want live rendering, add a `renderer` block as described below.

---

## Registration Lifecycle

Once a layer type is registered, the core runtime uses it in these places:

1. `env_layer_create` calls `storageFactory` to create the layer's live storage.
2. `env_layer_update` calls `controller.applyMetadata`, then reindexes dependencies.
3. `item_create`, `item_update`, and `item_delete` call the corresponding controller hooks.
4. Dependency changes call `controller.onDependencyItemsChanged` on dependent layers.
5. Incoming asset data calls `controller.onAssetDataReceived`.
6. Snapshot replay uses `fromSnapshot` to rebuild storage.
7. Render planning uses `view` and `renderer` to compute bounds, ordering, z-index, and host-layer creation.

If a layer type does not register a `controller`, `Scenario` treats it as
metadata-only and will warn when `item_*` messages target that layer.

---

## `LayerTypeDefinition` Reference

```typescript
interface LayerTypeDefinition {
  /** Unique string key, for example "mypkg.heatmap". */
  layer_type: string;

  /** Human-readable label shown in debugging and UI surfaces. */
  label?: string;

  /** Zod schema for env_layer_create / env_layer_update metadata. */
  metadataSchema?: ZodType;

  /** Zod schema for full item objects in item_create. */
  itemSchema?: ZodType;

  /** Zod schema for partial item diffs in item_update. */
  itemDiffSchema?: ZodType;

  /** Primary-key fields used by item_delete and diff matching. */
  primaryKeyFields?: string[];

  /** Required upstream layer types keyed through dependency_layer_ids. */
  requiredDependencyLayerTypes?: string[];

  /** Create the live storage object held by ScenarioLayerState. */
  storageFactory?: (metadata: Record<string, unknown>) => LayerStorage;

  /** Reconstruct storage from a protocol snapshot. */
  fromSnapshot?: (snapshot: ScenarioLayerSnapshot) => LayerStorage;

  /** Runtime hooks for metadata, items, dependencies, and assets. */
  controller?: ItemLayerController;

  /** View-selection helpers, such as scene bounds. */
  view?: LayerViewDefinition;

  /** Render-planning and host-layer integration hooks. */
  renderer?: LayerRendererDefinition;
}
```

Notes:

- `storageFactory` is the root hook for typed runtime storage. Without it,
  `Scenario` falls back to a generic metadata-backed storage.
- Implement `fromSnapshot` if you need snapshot replay or static rendering to
  reconstruct your storage faithfully.
- `requiredDependencyLayerTypes` validates `dependency_layer_ids` at runtime.
  The keys are layer types and the values are layer IDs.
- Re-registering the same `layer_type` replaces the previous definition in the
  current registry.

---

## Controller Hooks

```typescript
interface ItemLayerController<
  TCreateItem extends Record<string, unknown> = Record<string, unknown>,
  TUpdateItem extends Record<string, unknown> = TCreateItem,
> {
  applyMetadata?(context: LayerControllerContext): void;
  createItems?(context: LayerControllerContext, items: TCreateItem[]): void;
  updateItems?(context: LayerControllerContext, items: TUpdateItem[]): void;
  deleteItems?(context: LayerControllerContext, items: ItemDeletePayload['items']): void;
  onDependencyItemsChanged?(context: LayerControllerContext, change: LayerDependencyChange): void;
  onAssetDataReceived?(context: LayerControllerContext, assetId: string): void;
  dispose?(context: LayerControllerContext): void;
}
```

`LayerControllerContext.requireStorage()` is the normal way to access your
typed storage inside controller hooks.

---

## View Hooks

```typescript
interface LayerViewDefinition {
  getSceneBounds?: (metadata: Record<string, unknown>) => { width: number; height: number } | undefined;
  sceneBoundsPriority?: number;
  viewMetadataPriority?: number;
}
```

Lower priority numbers win. These hooks are consumed by
`findSceneBounds()` and `findViewMetadataSource()`.

Use `view` when your layer can define shared environment dimensions or should
be treated as the canonical metadata source for a composed view.

---

## Renderer Hooks

```typescript
interface LayerRendererDefinition {
  role: string;
  renderOrderPriority?: number;
  getZIndex?(metadata: Record<string, unknown>): number | undefined;
  getCoordOffset?(metadata: Record<string, unknown>): GridCoordOffset;
  getUsesGraphInteraction?(metadata: Record<string, unknown>): boolean;
  getOriginMode?(metadata: Record<string, unknown>): OriginMode;
  getFitPadding?(metadata: Record<string, unknown>): number | undefined;
  getGraphConfig?(metadata: Record<string, unknown>): GraphEnvConfig;
  getBackgroundSource?(metadata: Record<string, unknown>): unknown;
  getSnapshotGridData?(layer: ScenarioLayerSnapshot): GridEnvData | undefined;
  getSnapshotAgentLayer?(layer: ScenarioLayerSnapshot): SnapshotAgentLayerData | undefined;
  getSnapshotTrajectoryLayer?(layer: ScenarioLayerSnapshot): SnapshotTrajectoryLayerData | undefined;
  getSnapshotEdges?(layer: ScenarioLayerSnapshot): GraphEdge[];
  getSnapshotBackground?(layer: ScenarioLayerSnapshot): BackgroundData | null | undefined;
  createLayer?(plan: RenderLayerPlan, context: LayerCreateContext): CreatedLayerEntry | null;
  dependencies?: Array<{ fromRole: string; inject: string }>;
}
```

Important details:

- `role` is open-ended. Built-in roles are `background`, `grid`, `edge`,
  `trajectory`, and `agent`.
- Built-in roles receive specialized plan objects. Custom roles are emitted as
  `GenericLayerPlan`.
- `renderOrderPriority` sorts roles before reconciliation. Lower values are
  processed first. Built-ins use `background=0`, `grid=1`, `edge=2`,
  `trajectory=3`, `agent=4`.
- `dependencies` declares inter-role ordering. The current planner uses
  `fromRole` to topologically order roles.
- `createLayer` is the live host hook used by `layerRegistry.createLayer()`.
- `getSnapshot*` hooks power snapshot-oriented helpers such as
  `collectRenderData()`.

---

## Built-in Layer Types

| `layer_type` | Item key | Dependencies | Description |
| --- | --- | --- | --- |
| `agent` | `id` | - | Agents with optional `x`, `y`, `heading`, icons, and graph/grid positioning metadata. |
| `edge` | `source,target` | `agent` | Directed or undirected edges with graph layout support. |
| `trajectory` | `id` | `agent` | Trajectory config items plus per-layer default trail config. |
| `grid` | - | - | Parametric multi-scale grid overlay and common scene-bounds metadata source. |
| `background` | - | - | Background source layer; `background` accepts CSS colors, URLs, data URLs, `Uint8Array`, or `{ asset_id, interpolation? }`. |

Built-in types are registered automatically at module load time. They now ship
their storage, controller, view, and renderer definitions through the same
registry API used by custom plugins.

---

## Python Side

On the Python/server side, emit the new layer type with:

```python
runner.create_env_layer(
    env_id="my_env",
    layer_id="heat",
    layer_type="mypkg.heatmap",
    data={"width": 64, "height": 64, "colormap": "viridis"},
)
```

See the [Python API reference](../api-reference/python-api.md) for details.

---

## Using the Registry Programmatically

```typescript
import {
  findSceneBounds,
  findViewMetadataSource,
  layerRegistry,
} from '@tensnap/core/scenario';

// Check if a type is registered
layerRegistry.has('mypkg.heatmap');

// Retrieve the definition
const def = layerRegistry.get('mypkg.heatmap');

// Validate layer metadata
const result = layerRegistry.validateMetadata('mypkg.heatmap', {
  width: 64,
  height: 64,
  colormap: 'viridis',
});
if (!result.success) console.warn(result.error);

// Inspect view-selection helpers
const sceneBounds = findSceneBounds([...environment.layers.values()]);
const viewMetadataLayer = findViewMetadataSource([...environment.layers.values()]);

// Inspect render-role ordering
const roleOrder = layerRegistry.getRenderOrder();
```

For isolated tests or custom hosts, instantiate `LayerRegistryClass` instead of
mutating the process-global registry.

---

## Rendering Custom Layers

Rendering registration now lives on the same `LayerTypeDefinition`. There is no
separate component-registration API in the core path.

To render a custom layer type:

1. Implement storage and controller hooks first so the runtime state is well-defined.
2. Choose a renderer `role`.
3. If you reuse a built-in role, your layer must satisfy that built-in plan contract.
4. If you use a custom role, `createRenderPlan()` emits a `GenericLayerPlan` and your `renderer.createLayer()` must handle it.
5. Register the definition before the host initializes its renderer.

Hosts that use `createRenderPlan()`, `createRenderPlanFromSnapshot()`,
`EnvironmentRendererController`, or the backward-compatible
`createLayerForPlan()` helper will pick up registered renderers automatically.

---

## Reserved Layer IDs

The following `layer_type` strings are reserved for built-in use:

- `agent`
- `edge`
- `trajectory`
- `grid`
- `background`

Custom layer types should use a namespaced prefix such as `mypkg.heatmap` to
avoid future collisions. The same rule is a good idea for custom renderer
roles unless you are intentionally overriding a built-in behavior.

---

## References

- [Protocol v0.2](./protocol-v0.2.md) - full message spec for `env_layer_*` and `item_*`
- [Architecture](./architecture.md) - rendering layer design
