import {
  ScenarioInspector,
  createAgentInspectionView,
  type AgentRef,
  type Scenario,
  type AgentInspectionView,
} from '@tensnap/core/scenario';
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
export function createAgentInspectionSource(scenario: Scenario, initialRef: AgentRef) {
  let ref = initialRef;
  const inspector = new ScenarioInspector(scenario);
  let releaseIndex: (() => void) | undefined;
  let indexDirty = true;
  let revision = 0;
  let disposed = false;
  const changed = () => {
    revision++;
  };
  const structureEvents = [
    'env:create',
    'env:delete',
    'layer:create',
    'layer:update',
    'layer:delete',
    'reset',
  ] as const;
  const events = [
    'item:create',
    'item:update',
    'item:delete',
    'asset:metadata',
    'asset:data',
    'asset:delete',
  ] as const;
  for (const event of events) scenario.addEventListener(event, changed);
  const structureChanged = () => {
    indexDirty = true;
    changed();
  };
  for (const event of structureEvents) scenario.addEventListener(event, structureChanged);
  const syncIndexes = () => {
    if (!indexDirty) return;
    releaseIndex?.();
    releaseIndex = inspector.retainSpatialIndex(ref);
    indexDirty = false;
  };
  syncIndexes();
  return {
    retarget(next: AgentRef): boolean {
      if (
        next.environmentId === ref.environmentId &&
        next.layerId === ref.layerId &&
        next.agentId === ref.agentId
      )
        return false;
      ref = next;
      revision++;
      indexDirty = true;
      syncIndexes();
      return true;
    },
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
      if (disposed) return;
      disposed = true;
      releaseIndex?.();
      releaseIndex = undefined;
      for (const event of events) scenario.removeEventListener(event, changed);
      for (const event of structureEvents) scenario.removeEventListener(event, structureChanged);
    },
  };
}
