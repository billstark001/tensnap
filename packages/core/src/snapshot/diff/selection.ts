import type { ScenarioLayerSnapshot, ScenarioSnapshot } from '../../scenario/types';
import type { ResolvedComparisonPolicy } from './policy';
import type { ChangeRef } from './types';

type AgentId = string | number;

/** Compile bounded selectors once; inspect parent subtrees only when they change atomically. */
export class ObjectSelection {
  private readonly all;
  private metadata = false;
  private readonly named = new Map<string, Set<string>>();
  private readonly layers = new Map<string, Set<string>>();
  private readonly agents = new Map<string, Map<string, Set<AgentId>>>();
  private agentSources?: Map<string, Map<string, ScenarioLayerSnapshot[]>>;
  private readonly presence = new Map<string, Map<string, boolean>>();

  constructor(
    objects: ResolvedComparisonPolicy['objects'],
    private readonly scenes: readonly ScenarioSnapshot[],
  ) {
    this.all = objects === undefined;
    for (const object of objects ?? []) {
      if (object.kind === 'metadata') this.metadata = true;
      else if (object.kind === 'layer') {
        let layers = this.layers.get(object.environmentId);
        if (!layers) {
          layers = new Set();
          this.layers.set(object.environmentId, layers);
        }
        layers.add(object.layerId);
      } else if (object.kind === 'agent') {
        let layers = this.agents.get(object.environmentId);
        if (!layers) {
          layers = new Map();
          this.agents.set(object.environmentId, layers);
        }
        let ids = layers.get(object.layerId);
        if (!ids) {
          ids = new Set();
          layers.set(object.layerId, ids);
        }
        ids.add(object.agentId);
      } else {
        let ids = this.named.get(object.kind);
        if (!ids) {
          ids = new Set();
          this.named.set(object.kind, ids);
        }
        ids.add(object.id);
      }
    }
  }

  includes(
    path: readonly string[],
    ref: ChangeRef | undefined,
    before: unknown,
    after: unknown,
  ): boolean {
    if (this.all || (this.metadata && path[0] === 'metadata')) return true;
    if (ref && 'environmentId' in ref) {
      if (this.layers.get(ref.environmentId)?.has(ref.layerId)) return true;
      if ('agentId' in ref)
        return this.agents.get(ref.environmentId)?.get(ref.layerId)?.has(ref.agentId) ?? false;
      // A removed/added layer, its storage, or its agents array may contain the selected agent.
      if (
        path.length === 4 ||
        (path.length === 5 && path[4] === 'storageSnapshot') ||
        (path.length === 6 && path[4] === 'storageSnapshot' && path[5] === 'agents')
      )
        return this.hasSelectedAgent(ref.environmentId, ref.layerId);
    }
    if (ref && 'id' in ref && ref.id !== undefined && this.named.get(ref.kind)?.has(ref.id))
      return true;
    if (path[0] !== 'environments' || path.length !== 2) return false;
    for (const value of [before, after]) {
      if (!value || typeof value !== 'object') continue;
      const environment = value as ScenarioSnapshot['environments'][number];
      if (
        environment.layers?.some(
          (layer) =>
            this.layers.get(environment.id)?.has(layer.id) ||
            this.hasSelectedAgent(environment.id, layer.id),
        )
      )
        return true;
    }
    return false;
  }

  private hasSelectedAgent(envId: string, layerId: string): boolean {
    const ids = this.agents.get(envId)?.get(layerId);
    if (!ids) return false;
    const cached = this.presence.get(envId);
    if (cached?.has(layerId)) return cached.get(layerId)!;
    if (!this.agentSources) {
      this.agentSources = new Map();
      for (const scene of this.scenes)
        for (const environment of scene.environments) {
          const requested = this.agents.get(environment.id);
          if (!requested) continue;
          for (const layer of environment.layers)
            if (layer.layerType === 'agent' && requested.has(layer.id)) {
              let layers = this.agentSources.get(environment.id);
              if (!layers) {
                layers = new Map();
                this.agentSources.set(environment.id, layers);
              }
              const sources = layers.get(layer.id) ?? [];
              sources.push(layer);
              layers.set(layer.id, sources);
            }
        }
    }
    const found =
      this.agentSources
        .get(envId)
        ?.get(layerId)
        ?.some((layer) => {
          const agents = (layer.storageSnapshot as { agents?: Array<{ id: AgentId }> } | null)
            ?.agents;
          return Array.isArray(agents) && agents.some((agent) => ids.has(agent.id));
        }) ?? false;
    const results = cached ?? new Map<string, boolean>();
    results.set(layerId, found);
    this.presence.set(envId, results);
    return found;
  }
}
