import type { ScenarioEnvironmentSnapshot, ScenarioSnapshot } from '../../scenario/types';
import { compareExactItems, compareIdentityItems } from './items';
import { LayerComparison } from './layers';
import type { ResolvedComparisonPolicy } from './policy';
import type { VisitValue } from './types';
import { visitProperties } from './properties';

const namedCollections = new Map<string, 'action' | 'parameter' | 'chart' | 'monitor'>([
  ['actions', 'action'],
  ['parameters', 'parameter'],
  ['charts', 'chart'],
  ['monitors', 'monitor'],
]);
function namedKey(item: unknown): string {
  const id = (item as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') throw new Error('Scene entity identity requires a string ID.');
  return id;
}

/** Scene entity collections use the default strategy; each layer may override it. */
export function compareScenes(
  left: ScenarioSnapshot,
  right: ScenarioSnapshot,
  policy: ResolvedComparisonPolicy,
  visit: VisitValue,
): void {
  const compare = policy.comparison === 'identity' ? compareIdentityItems : compareExactItems;
  const layers = new LayerComparison(policy, visit);
  const compareEnvironment: VisitValue = (old, next, path, _ref, hasA = true, hasB = true) => {
    const a = old as ScenarioEnvironmentSnapshot,
      b = next as ScenarioEnvironmentSnapshot;
    if (!hasA || !hasB) {
      visit(a, b, path, undefined, hasA, hasB);
      return;
    }
    visitProperties(a, b, path, visit, undefined, 'layers');
    compare(
      a.layers,
      b.layers,
      [...path, 'layers'],
      (oldLayer, nextLayer, layerPath, _ref, oldExists = true, nextExists = true) =>
        layers.compare(b.id, oldLayer, nextLayer, layerPath, oldExists, nextExists),
      namedKey,
    );
  };
  const visitScene: VisitValue = (old, next, path, ref, hasA = true, hasB = true) => {
    const name = path[0];
    if (hasA && hasB && name === 'environments')
      compare(
        old as ScenarioEnvironmentSnapshot[],
        next as ScenarioEnvironmentSnapshot[],
        path,
        compareEnvironment,
        namedKey,
      );
    else if (hasA && hasB && name === 'assets')
      compare(
        old as ScenarioSnapshot['assets'],
        next as ScenarioSnapshot['assets'],
        path,
        visit,
        (asset) => asset.meta.id,
      );
    else if (hasA && hasB && namedCollections.has(name)) {
      const kind = namedCollections.get(name)!;
      compare(
        old as Array<{ id: string }>,
        next as Array<{ id: string }>,
        path,
        visit,
        namedKey,
        (item) => ({ kind, id: item.id }),
      );
    } else visit(old, next, path, ref, hasA, hasB);
  };
  visitProperties(left, right, [], visitScene);
}
