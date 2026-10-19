// @vitest-environment node
import { it, expect } from 'vitest';
import { Scenario } from '../scenario';
import { diffCapturedFrames, exactValueEqual } from './diff';
import type { CapturedFrame } from './CapturedFrame';
function frame(): CapturedFrame {
  const scenario = new Scenario();
  scenario.apply({ type: 'monitor_create', payload: { id: 'diagnostic', label: 'Diagnostic' } });
  scenario.apply({
    type: 'monitor_update',
    payload: { id: 'diagnostic', value: { replayed_calls: 1, score: 100 } },
  });
  return {
    id: 'f',
    capturedAt: 0,
    scene: scenario.dump(),
    source: { kind: 'live' },
    consistency: 'aligned',
    checkpointStatus: 'captured',
    checkpoint: { encoding: 'raw', data: 'AQ==', model_id: 'm' },
    modelIdentity: { model_id: 'm' },
  };
}
it('reports exact diagnostics separately from selected equality and opaque checkpoint bytes', () => {
  const a = frame(),
    b = frame();
  b.scene.monitors[0].value = { replayed_calls: 2, score: 100.1 };
  b.checkpoint!.data = Uint8Array.of(1);
  expect(diffCapturedFrames(a, b)).toMatchObject({
    sceneEqual: false,
    selectedEqual: false,
    checkpointEqual: true,
  });
  const result = diffCapturedFrames(a, b, {
    ignore: ['/monitors/diagnostic/value/replayed_calls'],
    relativeTolerance: 0.001,
  });
  expect(result).toMatchObject({
    sceneEqual: false,
    selectedEqual: true,
    checkpointEqual: true,
    changeCount: 2,
  });
  expect(result.changes.some((c) => c.ignored)).toBe(true);
  b.modelIdentity!.state_schema_version = 'different';
  expect(diffCapturedFrames(a, b, result.policy).selectedEqual).toBe(false);
  expect(() => diffCapturedFrames(a, b, { absoluteTolerance: -1 })).toThrow();
});
it('matches typed entities while preserving ordinary array order and reports incomplete enumeration', () => {
  const a = frame(),
    b = frame();
  a.scene.monitors[0].value = [1, 2];
  b.scene.monitors[0].value = [2, 1];
  const result = diffCapturedFrames(a, b, {}, { limit: 1 });
  expect(result).toMatchObject({
    selectedEqual: false,
    complete: false,
    continuation: 1,
    changeCount: 2,
  });
  expect(diffCapturedFrames(a, b, {}, { offset: 1 }).changes).toHaveLength(1);
});

it('selects explicit typed objects without hiding the remaining exact changes', () => {
  const a = frame(),
    b = frame();
  a.scene.metadata.time = 1;
  b.scene.metadata.time = 2;
  expect(
    diffCapturedFrames(a, b, { objects: [{ kind: 'monitor', id: 'diagnostic' }] }),
  ).toMatchObject({
    sceneEqual: false,
    selectedEqual: true,
    changeCount: 1,
    selectedChangeCount: 0,
  });
  b.checkpoint!.data = Uint8Array.of(2);
  expect(
    diffCapturedFrames(a, b, { objects: [{ kind: 'monitor', id: 'diagnostic' }] }).selectedEqual,
  ).toBe(false);
});

it('compares finite numeric extremes without tolerance arithmetic overflowing', () => {
  const a = frame(),
    b = frame();
  a.scene.monitors[0].value = Number.MAX_VALUE;
  b.scene.monitors[0].value = -Number.MAX_VALUE;
  expect(diffCapturedFrames(a, b, { relativeTolerance: 1.5 }).selectedEqual).toBe(false);
  expect(diffCapturedFrames(a, b, { relativeTolerance: 2 }).selectedEqual).toBe(true);
  expect(
    diffCapturedFrames(a, b, { absoluteTolerance: Number.MAX_VALUE, relativeTolerance: 0.5 })
      .selectedEqual,
  ).toBe(false);
});

function graphFrame(): CapturedFrame {
  const result = frame();
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'graph/:', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'graph/:', layer_id: 'agents', layer_type: 'agent' },
  });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'graph/:',
      layer_id: 'edges/:',
      layer_type: 'edge',
      dependency_layer_ids: { agent: 'agents' },
    },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'graph/:',
      layer_id: 'edges/:',
      items: [
        { source: 1, target: 'a/:b', directed: true, weight: 2, data: [1, 2] },
        { source: '1', target: 'a/:b', directed: false, weight: 3 },
        { source: 'a/:b', target: 1, directed: false, weight: 4 },
      ],
    },
  });
  result.scene = scenario.dump();
  return result;
}

it('compares graph edges by typed endpoint identity only under an explicit policy', () => {
  const left = graphFrame(),
    right = graphFrame();
  const edges = (
    right.scene.environments[0].layers.find((layer) => layer.id === 'edges/:')!.storageSnapshot as {
      edges: unknown[];
    }
  ).edges;
  edges.reverse();
  const original = structuredClone(right);
  expect(diffCapturedFrames(left, right, { comparison: 'exact' })).toMatchObject({
    sceneEqual: false,
    selectedEqual: false,
    checkpointEqual: true,
  });
  expect(diffCapturedFrames(left, right)).toMatchObject({
    sceneEqual: true,
    selectedEqual: true,
    checkpointEqual: true,
    changeCount: 0,
  });
  expect(right).toEqual(original);
  (edges[1] as { weight: number }).weight = 5;
  const changed = diffCapturedFrames(left, right, { comparison: 'identity' });
  expect(changed).toMatchObject({ selectedEqual: false, changeCount: 1 });
  expect(changed.changes[0]).toMatchObject({
    ref: { kind: 'layer', environmentId: 'graph/:', layerId: 'edges/:' },
    path: [
      'environments',
      'graph/:',
      'layers',
      'edges/:',
      'storageSnapshot',
      'edges',
      '["1","a/:b"]',
      'weight',
    ],
    before: 3,
    after: 5,
  });
  expect(
    diffCapturedFrames(left, right, { comparison: 'identity', absoluteTolerance: 2 }).selectedEqual,
  ).toBe(true);
  right.checkpoint!.data = Uint8Array.of(2);
  expect(
    diffCapturedFrames(left, right, { comparison: 'identity', absoluteTolerance: 2 }).selectedEqual,
  ).toBe(false);
});

it('reports added/removed edge identities and keeps edge attribute arrays ordered', () => {
  const left = graphFrame(),
    right = graphFrame();
  const edges = (
    right.scene.environments[0].layers.find((layer) => layer.id === 'edges/:')!.storageSnapshot as {
      edges: Array<Record<string, unknown>>;
    }
  ).edges;
  edges[0].data = [2, 1];
  edges[1].target = 2;
  const result = diffCapturedFrames(left, right, { comparison: 'identity' }, { limit: 2 });
  expect(result).toMatchObject({
    selectedEqual: false,
    changeCount: 4,
    complete: false,
    continuation: 2,
  });
  expect(
    diffCapturedFrames(left, right, { comparison: 'identity' }, { offset: 2 }).changes.map(
      (c) => c.kind,
    ),
  ).toEqual(['removed', 'added']);
});

it('rejects duplicate or malformed edge identities rather than silently dropping them', () => {
  const left = graphFrame(),
    right = graphFrame();
  const edges = (
    right.scene.environments[0].layers.find((layer) => layer.id === 'edges/:')!.storageSnapshot as {
      edges: Array<Record<string, unknown>>;
    }
  ).edges;
  edges.push(structuredClone(edges[0]));
  expect(() => diffCapturedFrames(left, right, { comparison: 'identity' })).toThrow(
    'Duplicate item identity',
  );
  edges.pop();
  edges[0].source = { id: 1 };
  expect(() => diffCapturedFrames(left, right, { comparison: 'identity' })).toThrow(
    'typed string/number field source',
  );
});

function itemFrame(layerType: string, storageSnapshot: unknown): CapturedFrame {
  const result = frame();
  result.scene.environments = [
    {
      id: 'main/:',
      type: '2d',
      layers: [{ id: 'items/:', layerType, metadata: {}, dependencyLayerIds: {}, storageSnapshot }],
    },
  ];
  return result;
}

const itemCases = [
  [
    'agent',
    'agents',
    [
      { id: 1, data: { x: 2 } },
      { id: '1', data: { x: 3 } },
    ],
  ],
  [
    'edge',
    'edges',
    [
      { source: 1, target: 'a/:b', weight: 2 },
      { source: '1', target: 'a/:b', weight: 3 },
    ],
  ],
  [
    'trajectory',
    'configs',
    [
      { id: 1, length: 2 },
      { id: '1', length: 3 },
    ],
  ],
  [
    'trajectory',
    'trajectories',
    [
      { id: 1, points: [{ x: 1, y: 1, time: 1 }] },
      { id: '1', points: [{ x: 2, y: 2, time: 1 }] },
    ],
  ],
] as const;

it.each(itemCases)(
  'defaults %s/%s to identity and provides exact and per-layer strategies',
  (type, field, items) => {
    const a = itemFrame(type, { [field]: structuredClone(items) });
    const b = itemFrame(type, { [field]: [...structuredClone(items)].reverse() });
    const result = diffCapturedFrames(a, b);
    expect(result).toMatchObject({
      sceneEqual: true,
      selectedEqual: true,
      changeCount: 0,
      policy: { comparison: 'identity' },
    });
    expect(result).not.toHaveProperty('exactSceneEqual');
    expect(diffCapturedFrames(a, b, { comparison: 'exact' })).toMatchObject({
      sceneEqual: false,
      selectedEqual: false,
    });
    expect(
      diffCapturedFrames(a, b, {
        layerComparisons: [{ environmentId: 'main/:', layerId: 'items/:', comparison: 'exact' }],
      }).selectedEqual,
    ).toBe(false);
    expect(
      diffCapturedFrames(a, b, {
        comparison: 'exact',
        layerComparisons: [{ environmentId: 'main/:', layerId: 'items/:', comparison: 'identity' }],
      }).selectedEqual,
    ).toBe(true);
    (b.scene.environments[0].layers[0].storageSnapshot as Record<string, unknown[]>)[field].push(
      structuredClone(items[0]),
    );
    expect(() => diffCapturedFrames(a, b)).toThrow('Duplicate item identity');
  },
);

it('preserves trajectory point and segment chronology under identity comparison', () => {
  const first = [
    { x: 1, y: 2, time: 0 },
    { x: 3, y: 4, time: 1 },
  ];
  const second = [{ x: 5, y: 6, time: 2 }];
  const a = itemFrame('trajectory', {
    config: { length: 100 },
    configs: [{ id: 1, color: 'red' }],
    trajectories: [
      { id: 1, points: [...first, ...second], segments: [first, second], closed: true },
    ],
  });
  const b = structuredClone(a);
  const storage = b.scene.environments[0].layers[0].storageSnapshot as {
    trajectories: Array<{ points: unknown[]; segments: unknown[][] }>;
  };
  storage.trajectories[0].points.reverse();
  expect(diffCapturedFrames(a, b).selectedEqual).toBe(false);
  storage.trajectories[0].points.reverse();
  storage.trajectories[0].segments.reverse();
  expect(diffCapturedFrames(a, b).selectedEqual).toBe(false);
});

it('supports declared custom item paths and composite typed keys without interpreting arbitrary arrays', () => {
  const a = itemFrame('custom', {
    nested: {
      items: [
        { group: 'a/:', id: 1, values: [1, 2] },
        { group: 'a/:', id: '1', values: [3, 4] },
      ],
    },
  });
  const b = structuredClone(a);
  const items = (
    b.scene.environments[0].layers[0].storageSnapshot as {
      nested: { items: Array<{ values: number[] }> };
    }
  ).nested.items;
  items.reverse();
  const policy = {
    itemCollections: [{ layerType: 'custom', path: '/nested/items', keyFields: ['group', 'id'] }],
  };
  expect(diffCapturedFrames(a, b, policy)).toMatchObject({ sceneEqual: true, selectedEqual: true });
  expect(diffCapturedFrames(a, b, { ...policy, comparison: 'exact' }).selectedEqual).toBe(false);
  items[0].values.reverse();
  expect(diffCapturedFrames(a, b, policy).selectedEqual).toBe(false);
});

it.each(['grid', 'background'])(
  'keeps %s state fields meaningful under either strategy',
  (type) => {
    const a = itemFrame(type, { value: 1 }),
      b = itemFrame(type, { value: 2 });
    for (const comparison of ['identity', 'exact'] as const)
      expect(diffCapturedFrames(a, b, { comparison })).toMatchObject({
        sceneEqual: false,
        selectedEqual: false,
      });
  },
);

it('compares agent storage extras and selects agents through their containing layer', () => {
  const a = itemFrame('agent', { agents: [{ id: 1, x: 1 }], version: 1 });
  const b = itemFrame('agent', { agents: [{ id: 1, x: 2 }], version: 2 });
  expect(
    diffCapturedFrames(a, b, {
      objects: [{ kind: 'layer', environmentId: 'main/:', layerId: 'items/:' }],
    }),
  ).toMatchObject({ changeCount: 2, selectedChangeCount: 2 });
});

it('rejects overlapping custom descriptors, duplicate overrides and obsolete edge-only policies', () => {
  const a = frame();
  expect(() => diffCapturedFrames(a, a, { edgeComparison: 'identity' } as never)).toThrow();
  expect(() =>
    diffCapturedFrames(a, a, {
      itemCollections: [
        { layerType: 'custom', path: '/items', keyFields: ['id'] },
        { layerType: 'custom', path: '/items/data', keyFields: ['id'] },
      ],
    }),
  ).toThrow('must not overlap');
  expect(() =>
    diffCapturedFrames(a, a, {
      itemCollections: [{ layerType: 'agent', path: '/agents', keyFields: ['name'] }],
    }),
  ).toThrow('cannot be redefined');
  const layer = { environmentId: 'main/:', layerId: 'items/:', comparison: 'exact' as const };
  expect(() => diffCapturedFrames(a, a, { layerComparisons: [layer, layer] })).toThrow(
    'Duplicate layer comparison',
  );
});

it('visits large reordered item payloads once and only clones the requested change page', () => {
  const count = 20_000;
  let reads = 0;
  const makeItems = (changed: boolean) =>
    Array.from({ length: count }, (_, id) => ({
      id,
      get payload() {
        reads++;
        return id === count - 1 && changed ? 1 : 0;
      },
    }));
  const a = itemFrame('agent', { agents: makeItems(false) });
  const b = itemFrame('agent', { agents: makeItems(true).reverse() });
  const result = diffCapturedFrames(a, b, {}, { limit: 1 });
  expect(result).toMatchObject({
    changeCount: 1,
    selectedChangeCount: 1,
    sceneEqual: false,
    complete: true,
  });
  expect(result.changes).toHaveLength(1);
  expect(reads).toBe(2 * count);
});

it('matches strict value equality in exact mode for reordered scene collections and changed nested state', () => {
  for (let sample = 0; sample < 40; sample++) {
    const a = graphFrame(),
      b = structuredClone(a);
    const environment = b.scene.environments[0];
    const storage = environment.layers.find((layer) => layer.layerType === 'edge')!
      .storageSnapshot as { edges: Array<Record<string, unknown>> };
    if (sample % 2) storage.edges.reverse();
    if (sample % 3) environment.layers.reverse();
    if (sample % 5) storage.edges[0].weight = sample;
    const expected = exactValueEqual(a.scene, b.scene);
    expect(diffCapturedFrames(a, b, { comparison: 'exact' }).sceneEqual).toBe(expected);
  }
});

it('matches assets by their metadata identity while preserving their binary bytes', () => {
  const a = frame();
  a.scene.assets = [1, 2].map((id) => ({
    meta: { id: String(id), hash: String(id), mime: 'image/png', size: 1 },
    data: Uint8Array.of(id),
  }));
  const b = structuredClone(a);
  b.scene.assets.reverse();
  expect(diffCapturedFrames(a, b).sceneEqual).toBe(true);
  expect(diffCapturedFrames(a, b, { comparison: 'exact' }).sceneEqual).toBe(false);
  b.scene.assets[0].data = Uint8Array.of(3);
  expect(diffCapturedFrames(a, b).sceneEqual).toBe(false);
});

it('keeps the diff page independent of later caller changes', () => {
  const a = itemFrame('trajectory', { trajectories: [] });
  const b = itemFrame('trajectory', {
    trajectories: [{ id: 1, points: [{ x: 1, y: 2, time: 0 }] }],
  });
  const result = diffCapturedFrames(a, b);
  (
    b.scene.environments[0].layers[0].storageSnapshot as { trajectories: unknown[] }
  ).trajectories.length = 0;
  expect(result.changes[0].after).toEqual({ id: 1, points: [{ x: 1, y: 2, time: 0 }] });
});

it('does not read item keys for a redundant identity index in exact mode', () => {
  const count = 1000;
  let idReads = 0;
  const items = () =>
    Array.from({ length: count }, (_, index) => ({
      get id() {
        idReads++;
        return index;
      },
      value: index,
    }));
  const a = itemFrame('custom', { items: items() }),
    b = itemFrame('custom', { items: items() });
  expect(
    diffCapturedFrames(a, b, {
      comparison: 'exact',
      itemCollections: [{ layerType: 'custom', path: '/items', keyFields: ['id'] }],
    }).sceneEqual,
  ).toBe(true);
  expect(idReads).toBe(2 * count);
});

it('distinguishes sparse item slots from explicitly present undefined values in exact mode', () => {
  const a = itemFrame('custom', { items: new Array(1) });
  const b = itemFrame('custom', { items: [undefined] });
  const policy = {
    comparison: 'exact' as const,
    itemCollections: [{ layerType: 'custom', path: '/items', keyFields: ['id'] }],
  };
  expect(diffCapturedFrames(a, b, policy)).toMatchObject({
    sceneEqual: false,
    selectedEqual: false,
    changeCount: 1,
  });
  expect(diffCapturedFrames(a, a, policy).sceneEqual).toBe(true);
});

it.each(['environment', 'layer', 'storage', 'items'])(
  'includes selected agents when their whole %s is added or removed',
  (scope) => {
    const a = itemFrame('agent', {
      agents: [
        { id: 1, x: 2 },
        { id: '1', x: 3 },
      ],
    });
    const b = structuredClone(a);
    if (scope === 'environment') b.scene.environments.length = 0;
    if (scope === 'layer') b.scene.environments[0].layers.length = 0;
    if (scope === 'storage') b.scene.environments[0].layers[0].storageSnapshot = undefined;
    if (scope === 'items')
      delete (b.scene.environments[0].layers[0].storageSnapshot as { agents?: unknown[] }).agents;
    const object = {
      kind: 'agent' as const,
      environmentId: 'main/:',
      layerId: 'items/:',
      agentId: 1,
    };
    for (const [left, right] of [
      [a, b],
      [b, a],
    ]) {
      expect(diffCapturedFrames(left, right, { objects: [object] })).toMatchObject({
        sceneEqual: false,
        selectedEqual: false,
      });
      expect(
        diffCapturedFrames(left, right, { objects: [{ ...object, agentId: 'missing' }] })
          .selectedEqual,
      ).toBe(true);
    }
  },
);

it('selects a contained layer when its whole environment disappears', () => {
  const a = itemFrame('grid', { width: 2 }),
    b = structuredClone(a);
  b.scene.environments.length = 0;
  expect(
    diffCapturedFrames(a, b, {
      objects: [{ kind: 'layer', environmentId: 'main/:', layerId: 'items/:' }],
    }).selectedEqual,
  ).toBe(false);
});

it('scans a removed agent subtree once for a full bounded selector set', () => {
  const count = 10_000;
  let reads = 0;
  const a = itemFrame('agent', {
    agents: Array.from({ length: count }, (_, id) => ({
      get id() {
        reads++;
        return id;
      },
    })),
  });
  const b = frame();
  const objects = Array.from({ length: 256 }, (_, index) => ({
    kind: 'agent' as const,
    environmentId: 'main/:',
    layerId: 'items/:',
    agentId: count + index,
  }));
  expect(diffCapturedFrames(a, b, { objects }, { offset: 1 }).selectedEqual).toBe(true);
  expect(reads).toBe(count);
});
