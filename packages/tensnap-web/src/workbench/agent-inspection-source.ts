import {
  ScenarioInspector,
  createAgentInspectionView,
  type AgentRef,
  type Scenario,
  type AgentInspectionView,
} from '@tensnap/core/scenario';
import { AgentStorage } from '@tensnap/core/environment';
export interface InspectionRequest {
  radius: number;
  token?: string;
  assets: Record<string, string>;
}
export type InspectionResponse =
  | { unchanged: true }
  | { view: AgentInspectionView | null; token: string };
export interface AgentInspectionSource {
  read(request: InspectionRequest, signal: AbortSignal): Promise<InspectionResponse>;
}

/** One retained owner-side index; one request in flight is enforced by the receiving island. */
export function createAgentInspectionSource(scenario: Scenario, ref: AgentRef) {
  const inspector = new ScenarioInspector(scenario);
  const retained = new Map<AgentStorage, () => void>();
  let revision = 0;
  let disposed = false;
  const changed = () => {
    revision++;
  };
  const events = [
    'env:create',
    'env:delete',
    'layer:create',
    'layer:update',
    'layer:delete',
    'item:create',
    'item:update',
    'item:delete',
    'asset:metadata',
    'asset:data',
    'asset:delete',
    'reset',
  ] as const;
  for (const event of events) scenario.addEventListener(event, changed);
  const syncIndexes = () => {
    const environment = scenario.getEnvironment(ref.environmentId);
    const current = new Set<AgentStorage>();
    for (const layer of environment?.layers.values() ?? []) {
      if (!(layer.storage instanceof AgentStorage)) continue;
      current.add(layer.storage);
      if (!retained.has(layer.storage))
        retained.set(layer.storage, layer.storage.retainSpatialIndex());
    }
    retained.forEach((release, storage) => {
      if (!current.has(storage)) {
        release();
        retained.delete(storage);
      }
    });
  };
  syncIndexes();
  return {
    async read(request: InspectionRequest, signal: AbortSignal): Promise<InspectionResponse> {
      signal.throwIfAborted();
      if (disposed) throw new Error('The inspection source has closed.');
      const { radius } = request;
      if (!Number.isFinite(radius) || radius < 0.5)
        throw new Error('Inspection radius must be finite and at least 0.5.');
      const token = `${revision}:${radius}`;
      if (request.token === token) return { unchanged: true };
      syncIndexes();
      const inspection = inspector.inspectLive(ref, { radius });
      const view = inspection
        ? createAgentInspectionView(scenario, inspection, new Map(Object.entries(request.assets)))
        : null;
      signal.throwIfAborted();
      return { view, token };
    },
    dispose() {
      disposed = true;
      retained.forEach((release) => release());
      retained.clear();
      for (const event of events) scenario.removeEventListener(event, changed);
    },
  };
}
