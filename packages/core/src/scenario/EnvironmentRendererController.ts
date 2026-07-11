/**
 * scenario/EnvironmentRendererController.ts
 *
 * Canonical browser-side controller that reconciles an EnvironmentView with
 * a ScenarioEnvironmentState using the standard RenderPlan pipeline.
 *
 * This is the same reconciliation logic used by the web application's
 * Environment2DRendererController.  Keeping it in core makes it reusable
 * by benchmark and any other consumer that wants to render a Scenario
 * environment without pulling in the React/Zustand web-app shell.
 */

import { EnvironmentView } from '../environment/EnvironmentView';
import type { AgentId } from '@tensnap/protocol/layers';
import type { AgentRenderState, AgentStorage, Viewport } from '../environment';
import { layerRegistry, type LayerCreateContext } from './layer-registry';
import {
  createRenderPlan,
  type RenderLayerPlan,
  type RenderPlan,
} from './render-plan';
import type { ScenarioEnvironmentState } from './types';

export interface EnvironmentRendererControllerOptions {
  resolveAssetUrl?: (assetId: string) => string | undefined;
  onAgentSelect?: (agent: AgentRenderState, layerId?: string) => void;
  onRenderError?: (title: string, detail: string) => void;
  /** Highlight one agent without mutating Scenario storage. */
  highlightedAgent?: { layerId: string; agentId: AgentId };
  /** Do not create a second d3-force simulation for inspection renders. */
  readOnlyGraphLayout?: boolean;
}

interface LayerEntry {
  key: string;
  role: string;
  layerId: string;
  layer: { destroy(): void };
  storage?: AgentStorage;
}

export class EnvironmentRendererController {
  private envView: EnvironmentView | null = null;
  private agentStorages: Array<{ layerId: string; storage: AgentStorage }> = [];
  /** Keyed by string role to support third-party layer types. */
  private readonly layerEntriesByRole = new Map<string, Map<string, LayerEntry>>();
  private lastPlan: RenderPlan | null = null;
  private lastEnvironmentId: string | null = null;
  private fitPadding = 0;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly options: EnvironmentRendererControllerOptions = {},
  ) {}

  render(environment: ScenarioEnvironmentState): void {
    if (this.lastEnvironmentId !== environment.id) {
      this.destroy();
      this.lastEnvironmentId = environment.id;
    }

    if (!this.envView) {
      this.envView = new EnvironmentView(this.container, {
        type: 'design',
        enablePan: true,
        enableTouchZoom: true,
        enableWheelZoom: true,
      });
    }

    const plan = createRenderPlan(environment);

    try {
      this.reconcile(plan);
    } catch (error) {
      this.destroy();
      this.options.onRenderError?.(
        'Environment render failed',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
  }

  resetView(): void {
    this.envView?.fitToScene({ padding: this.fitPadding });
  }

  /** Set an explicit inspection viewport after the render plan is reconciled. */
  setViewport(viewport: Viewport): void {
    this.envView?.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
  }

  destroy(): void {
    this.envView?.destroy();
    this.envView = null;
    this.agentStorages = [];
    this.layerEntriesByRole.forEach((entries) => entries.clear());
    this.lastPlan = null;
    this.lastEnvironmentId = null;
  }

  private reconcile(plan: RenderPlan): void {
    if (!this.envView) {
      return;
    }

    // Reset linked edge layers once per reconcile so edge-layer registrations
    // are visible to subsequently-created agent layers within the same pass.
    this.layerFactoryContext.linkedEdgeLayers.clear();

    // Derive processing order from the registry, then extend with any roles
    // present in this plan that the registry didn't enumerate.
    const registryOrder = layerRegistry.getRenderOrder();
    const roleOrder: string[] = [...registryOrder];
    for (const layerPlan of plan.layers) {
      if (!roleOrder.includes(layerPlan.role)) {
        roleOrder.push(layerPlan.role);
      }
      if (!this.layerEntriesByRole.has(layerPlan.role)) {
        this.layerEntriesByRole.set(layerPlan.role, new Map());
      }
    }

    const nextByRole = new Map<string, Map<string, LayerEntry>>();
    const plansByRole = new Map<string, RenderLayerPlan[]>();
    for (const role of roleOrder) {
      nextByRole.set(role, new Map());
      plansByRole.set(role, []);
    }

    for (const layerPlan of plan.layers) {
      plansByRole.get(layerPlan.role)?.push(layerPlan);
    }

    for (const role of roleOrder) {
      const previous = this.layerEntriesByRole.get(role) ?? new Map<string, LayerEntry>();
      const next = nextByRole.get(role)!;
      const plans = plansByRole.get(role) ?? [];

      for (const layerPlan of plans) {
        const existing = previous.get(layerPlan.layerId);
        if (existing?.key === layerPlan.key) {
          next.set(layerPlan.layerId, existing);
          continue;
        }

        if (existing) {
          this.detachLayer(existing.layer);
        }

        const created = this.createLayerEntry(layerPlan);
        if (!created) {
          continue;
        }

        next.set(layerPlan.layerId, created);
      }

      this.cleanupRemoved(previous, next);
    }

    this.layerEntriesByRole.clear();
    nextByRole.forEach((entries, role) => this.layerEntriesByRole.set(role, entries));

    this.agentStorages = [...(this.layerEntriesByRole.get('agent')?.values() ?? [])]
      .flatMap((entry) => (entry.storage ? [{ layerId: entry.layerId, storage: entry.storage }] : []));

    this.syncSceneBounds(plan);

    const shouldFit = !this.lastPlan || this.lastPlan.buildKey !== plan.buildKey;
    this.fitPadding = plan.fitPadding;
    if (shouldFit) {
      this.envView.fitToScene({ padding: plan.fitPadding });
    }

    this.lastPlan = plan;
    this.lastEnvironmentId = plan.environmentId;
  }

  /** Shared context for layer creation, reused across reconciles. */
  private readonly layerFactoryContext: LayerCreateContext = {
    linkedEdgeLayers: new Map(),
  };

  private createLayerEntry(layerPlan: RenderLayerPlan): LayerEntry | null {
    if (!this.envView) {
      return null;
    }

    // Browser-specific: graph-interaction layers use double-click for selection,
    // grid agents use single-click.  The factory stays generic — we resolve the
    // correct handler set here.
    // usesGraphInteraction is now determined by the registry via render-plan,
    // not by role-specific branching in the controller.
    const isGraphInteraction = 'usesGraphInteraction' in layerPlan
      && (layerPlan as { usesGraphInteraction: boolean }).usesGraphInteraction;

    const factoryContext: LayerCreateContext = {
      linkedEdgeLayers: this.layerFactoryContext.linkedEdgeLayers,
      resolveAssetUrl: this.options.resolveAssetUrl,
      clickable: true,
      showLabel: false,
      onAgentClick: (isGraphInteraction
        ? undefined
        : (agent: unknown) => this.handleAgentSelect(agent as AgentRenderState, layerPlan.layerId)) as ((agent: unknown) => void) | undefined,
      onAgentDoubleClick: (isGraphInteraction
        ? (agent: unknown) => this.handleAgentSelect(agent as AgentRenderState, layerPlan.layerId)
        : undefined) as ((agent: unknown) => void) | undefined,
      highlightedAgent: this.options.highlightedAgent,
      readOnlyGraphLayout: this.options.readOnlyGraphLayout,
    };

    const created = layerRegistry.createLayer(layerPlan, factoryContext);
    if (!created) return null;

    this.envView.addLayer(created.layer as never);
    return {
      key: created.key,
      role: created.role,
      layerId: created.layerId,
      layer: created.layer,
      storage: created.storage,
    };
  }

  private syncSceneBounds(plan: RenderPlan): void {
    if (!plan.sceneBounds) {
      return;
    }

    this.layerEntriesByRole.forEach((entries) => {
      entries.forEach((entry) => {
        if ('setSceneBounds' in entry.layer && typeof entry.layer.setSceneBounds === 'function') {
          (entry.layer as { setSceneBounds(bounds: RenderPlan['sceneBounds']): void }).setSceneBounds(
            plan.sceneBounds!,
          );
        }
      });
    });
  }

  private detachLayer(layer: { destroy(): void }): void {
    this.envView?.removeLayer(layer as never);
    layer.destroy();
  }

  private cleanupRemoved<T extends LayerEntry>(
    previous: Map<string, T>,
    next: Map<string, T>,
  ): void {
    previous.forEach((entry, layerId) => {
      if (!next.has(layerId)) {
        this.detachLayer(entry.layer);
      }
    });
  }

  private handleAgentSelect = (agent: AgentRenderState, sourceLayerId?: string): void => {
    if (!this.options.onAgentSelect) {
      return;
    }
    if (sourceLayerId) {
      const source = this.layerEntriesByRole.get('agent')?.get(sourceLayerId)?.storage;
      this.options.onAgentSelect(source?.getAgent(agent.id) ?? agent, sourceLayerId);
      return;
    }
    for (const { layerId, storage } of this.agentStorages) {
      const found = storage.getAgent(agent.id);
      if (found) {
        this.options.onAgentSelect(found as AgentRenderState, layerId);
        return;
      }
    }
    this.options.onAgentSelect(agent);
  };
}
