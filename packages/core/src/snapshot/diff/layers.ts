import type { ScenarioLayerSnapshot } from '../../scenario/types';
import { compileFieldPath } from '../../scenario/query';
import { compareExactItems, compareIdentityItems, typedItemKey } from './items';
import type { ComparisonStrategy, ResolvedComparisonPolicy } from './policy';
import type { ChangeRef, VisitValue } from './types';
import { visitProperties } from './properties';
type LayerRef = { kind: 'layer'; environmentId: string; layerId: string };

interface CollectionNode {
  key?: ReturnType<typeof typedItemKey>;
  children: Map<string, CollectionNode>;
}

function collectionNode(): CollectionNode {
  return { children: new Map() };
}

function addCollection(
  root: CollectionNode,
  path: readonly string[],
  fields: readonly string[],
): void {
  let node = root;
  for (const part of path) {
    let child = node.children.get(part);
    if (!child) {
      child = collectionNode();
      node.children.set(part, child);
    }
    node = child;
  }
  node.key = typedItemKey(fields);
}

const builtinCollections = new Map<string, CollectionNode>();
for (const [type, fields] of [
  ['agent', [['agents', ['id']]]],
  ['edge', [['edges', ['source', 'target']]]],
  [
    'trajectory',
    [
      ['configs', ['id']],
      ['trajectories', ['id']],
    ],
  ],
] as const) {
  const root = collectionNode();
  for (const [field, keys] of fields) addCollection(root, [field], keys);
  builtinCollections.set(type, root);
}

const strategies = { identity: compareIdentityItems, exact: compareExactItems };

function compareStorage(
  a: unknown,
  b: unknown,
  path: string[],
  ref: LayerRef,
  node: CollectionNode,
  strategy: ComparisonStrategy,
  visit: VisitValue,
  layerType: string,
  hasA = true,
  hasB = true,
): void {
  if (node.key) {
    if ((hasA && !Array.isArray(a)) || (hasB && !Array.isArray(b)))
      throw new Error(`Item collection must be an array at ${JSON.stringify(path)}.`);
    if (!hasA || !hasB) {
      visit(a, b, path, ref, hasA, hasB);
      return;
    }
    const itemReference =
      layerType === 'agent' && path[path.length - 1] === 'agents'
        ? (item: unknown): ChangeRef => ({
            kind: 'agent',
            environmentId: ref.environmentId,
            layerId: ref.layerId,
            agentId: (item as { id: string | number }).id,
          })
        : () => ref;
    strategies[strategy](a as unknown[], b as unknown[], path, visit, node.key, itemReference);
    return;
  }
  if (
    !hasA ||
    !hasB ||
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    visit(a, b, path, ref, hasA, hasB);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
    visit(a.length, b.length, [...path, 'length'], ref);
  const childVisit: VisitValue = (
    old,
    next,
    childPath,
    childRef,
    oldExists = true,
    nextExists = true,
  ) => {
    const child = node.children.get(childPath[childPath.length - 1]);
    if (child)
      compareStorage(
        old,
        next,
        childPath,
        ref,
        child,
        strategy,
        visit,
        layerType,
        oldExists,
        nextExists,
      );
    else visit(old, next, childPath, childRef, oldExists, nextExists);
  };
  visitProperties(a, b, path, childVisit, ref);
}

export class LayerComparison {
  private readonly layerStrategies: Map<string, ComparisonStrategy>;
  private readonly collections: Map<string, CollectionNode>;
  constructor(
    private readonly policy: ResolvedComparisonPolicy,
    private readonly visit: VisitValue,
  ) {
    this.layerStrategies = new Map(
      policy.layerComparisons.map((layer) => [
        JSON.stringify([layer.environmentId, layer.layerId]),
        layer.comparison,
      ]),
    );
    const collections = new Map(builtinCollections);
    for (const collection of policy.itemCollections) {
      let root = collections.get(collection.layerType);
      if (!root) {
        root = collectionNode();
        collections.set(collection.layerType, root);
      }
      addCollection(root, compileFieldPath(collection.path), collection.keyFields);
    }
    this.collections = collections;
  }
  compare(
    envId: string,
    old: unknown,
    next: unknown,
    path: string[],
    hasA = true,
    hasB = true,
  ): void {
    const a = old as ScenarioLayerSnapshot,
      b = next as ScenarioLayerSnapshot;
    const layer = hasB ? b : a;
    const ref = { kind: 'layer' as const, environmentId: envId, layerId: layer.id };
    if (!hasA || !hasB) {
      this.visit(a, b, path, ref, hasA, hasB);
      return;
    }
    visitProperties(a, b, path, this.visit, ref, 'storageSnapshot');
    const strategy =
      this.layerStrategies.get(JSON.stringify([envId, layer.id])) ?? this.policy.comparison;
    const root = a.layerType === b.layerType ? this.collections.get(layer.layerType) : undefined;
    if (root)
      compareStorage(
        a.storageSnapshot,
        b.storageSnapshot,
        [...path, 'storageSnapshot'],
        ref,
        root,
        strategy,
        this.visit,
        layer.layerType,
      );
    else this.visit(a.storageSnapshot, b.storageSnapshot, [...path, 'storageSnapshot'], ref);
  }
}
