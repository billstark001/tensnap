/**
 * @vitest-environment jsdom
 */

import type { Leafer } from '@leafer-ui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentView, type EnvironmentLeaferConfig } from './browser';
import { HeadlessEnvironmentView, type HeadlessLeaferConfig } from './headless';
import {
  AgentLayer,
  AgentStorage,
  BackgroundLayer,
  BackgroundStorage,
  EdgeLayer,
  EdgeStorage,
  GridEnvStorage,
  GridLayer,
  TrajectoryLayer,
  TrajectoryStorage,
  type IResizableLayer,
} from './index';

class FakeLeafer {
  readonly children: unknown[] = [];
  destroyed = false;
  width: number;
  height: number;

  constructor(config: { width: number; height: number }) {
    this.width = config.width;
    this.height = config.height;
  }

  add(child: unknown): void {
    if (!this.children.includes(child)) {
      this.children.push(child);
    }
  }

  remove(child: unknown): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
  }

  set(config: { width?: number; height?: number }): void {
    if (typeof config.width === 'number') {
      this.width = config.width;
    }
    if (typeof config.height === 'number') {
      this.height = config.height;
    }
  }

  forceRender(): void {}

  waitReady(callback: () => void): void {
    callback();
  }

  waitViewReady(callback: () => void): void {
    callback();
  }

  destroy(): void {
    this.destroyed = true;
    this.children.length = 0;
  }
}

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

interface NamedLayer {
  role: string;
  layer: IResizableLayer;
}

const assetUrl = 'data:image/png;base64,iVBORw0KGgo=';

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 640 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 480 });
  container.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 480,
    width: 640,
    height: 480,
    toJSON: () => ({}),
  });
  document.body.appendChild(container);
  return container;
}

function createFakeLeafer(config: EnvironmentLeaferConfig | HeadlessLeaferConfig): Leafer {
  return new FakeLeafer(config) as unknown as Leafer;
}

function createSceneLayers(): NamedLayer[] {
  const backgroundStorage = new BackgroundStorage();
  backgroundStorage.setData({ kind: 'color', value: '#101820' });
  const background = new BackgroundLayer(backgroundStorage, {
    sceneBounds: { x: 0, y: 0, width: 12, height: 8 },
    applySceneBoundsToView: true,
  });

  const grid = new GridLayer(new GridEnvStorage({
    width: 12,
    height: 8,
    x_ratio: 2,
    y_ratio: 2,
    stroke_color: '#94a3b8',
  }));

  const gridAgents = new AgentStorage();
  gridAgents.setAgents([
    { id: 'sprite', x: 1, y: 2, size: 1, icon: 'asset:badge', color: '#ffffff' },
  ]);
  const gridAgentLayer = new AgentLayer(gridAgents, {
    coordOffset: 'int',
    originMode: 'bottom-left',
    resolveAssetUrl: (assetId) => (assetId === 'badge' ? assetUrl : null),
  });

  const graphAgents = new AgentStorage();
  graphAgents.setAgents([
    { id: 'left', x: -2, y: 0, size: 1, icon: 'circle' },
    { id: 'right', x: 2, y: 0, size: 1, icon: 'triangle' },
  ]);
  const edges = new EdgeStorage([{ source: 'left', target: 'right', directed: true }]);
  const edgeLayer = new EdgeLayer(edges, graphAgents, { link_distance: 4 });
  (edgeLayer as unknown as { _simulation?: { stop(): void } })._simulation?.stop();

  const graphAgentLayer = new AgentLayer(graphAgents, {
    ...edgeLayer.buildDragHandlers(),
    coordOffset: 'float',
    originMode: 'center',
  });
  graphAgentLayer.setZIndex(41);

  const trajectories = new TrajectoryStorage({ length: 10, width: 2, color: '#f59e0b' });
  trajectories.setTrajectories([
    {
      id: 'sprite',
      points: [
        { x: 8, y: 1, time: 1 },
        { x: 9, y: 1, time: 2 },
        { x: 0, y: 1, time: 3 },
        { x: 1, y: 1, time: 4 },
      ],
    },
  ]);
  const trajectoryLayer = new TrajectoryLayer(trajectories, {
    coordOffset: 'int',
    worldBounds: { width: 10, height: 10 },
  });

  return [
    { role: 'grid-agent', layer: gridAgentLayer },
    { role: 'background', layer: background },
    { role: 'trajectory', layer: trajectoryLayer },
    { role: 'grid', layer: grid },
    { role: 'edge', layer: edgeLayer },
    { role: 'graph-agent', layer: graphAgentLayer },
  ];
}

function attachLayers(view: EnvironmentView | HeadlessEnvironmentView, layers: NamedLayer[]): void {
  for (const { layer } of layers) {
    view.addLayer(layer);
  }
}

function detachView(view: EnvironmentView | HeadlessEnvironmentView, layers: NamedLayer[]): void {
  for (const { layer } of layers) {
    view.removeLayer(layer);
  }
  (view.leafer as unknown as FakeLeafer).destroy();
}

function layerGroup(layer: IResizableLayer): unknown {
  return (layer as unknown as { group: unknown }).group;
}

function readNumber(target: unknown, key: string): number {
  if (!target) {
    return Number.NaN;
  }
  const record = target as Record<string, unknown>;
  const value = record[key] ?? (record.__ as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'number' ? value : Number(value);
}

function isLayerInteractionEnabled(layer: IResizableLayer): boolean {
  return (layer as unknown as { interactionEnabled: boolean }).interactionEnabled;
}

function summarize(
  view: EnvironmentView | HeadlessEnvironmentView,
  layers: NamedLayer[],
): Record<string, unknown> {
  const groupRole = new Map(layers.map(({ role, layer }) => [layerGroup(layer), role]));
  const leafer = view.leafer as unknown as FakeLeafer;
  const gridAgentLayer = layers.find((entry) => entry.role === 'grid-agent')?.layer as unknown as {
    _agentShapes: Map<string, { group: unknown; assetUrl: string | null }>;
  };
  const trajectoryLayer = layers.find((entry) => entry.role === 'trajectory')?.layer as unknown as {
    _lines: Map<string, { segments: Array<{ lines: unknown[] }> }>;
  };
  const edgeLayer = layers.find((entry) => entry.role === 'edge')?.layer as unknown as {
    _simLinks: unknown[];
  };
  const sprite = gridAgentLayer._agentShapes.get('sprite');

  return {
    surface: view.getSurfaceSize(),
    viewport: view.viewport,
    sceneBounds: view.calculateSceneBounds(),
    layerOrder: leafer.children.map((child) => groupRole.get(child)),
    zIndexes: layers.map(({ role, layer }) => ({ role, zIndex: layer.zIndex })),
    assetBackedIconUrl: sprite?.assetUrl,
    intCoordOffsetPosition: {
      x: readNumber(sprite?.group, 'x'),
      y: readNumber(sprite?.group, 'y'),
    },
    trajectorySegmentCount: trajectoryLayer._lines.get('sprite')?.segments
      .reduce((count, segment) => count + segment.lines.length, 0) ?? 0,
    graphLinkCount: edgeLayer._simLinks.length,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EnvironmentView and HeadlessEnvironmentView host equivalence', () => {
  it('preserves shared scene semantics across browser and headless hosts', () => {
    const browserLayers = createSceneLayers();
    const headlessLayers = createSceneLayers();
    const browserView = new EnvironmentView(createContainer(), {
      createLeafer: createFakeLeafer,
      enableLayerInteraction: false,
    });
    const headlessView = new HeadlessEnvironmentView({
      width: 640,
      height: 480,
      createLeafer: createFakeLeafer,
      enableLayerInteraction: false,
    });

    try {
      attachLayers(browserView, browserLayers);
      attachLayers(headlessView, headlessLayers);
      browserView.fitToScene({ padding: 0 });
      headlessView.fitToScene({ padding: 0 });

      const browserSummary = summarize(browserView, browserLayers);
      const headlessSummary = summarize(headlessView, headlessLayers);

      expect(browserSummary).toEqual(headlessSummary);
      expect(browserSummary.layerOrder).toEqual([
        'background',
        'grid',
        'edge',
        'trajectory',
        'grid-agent',
        'graph-agent',
      ]);
      expect(browserSummary.assetBackedIconUrl).toBe(assetUrl);
      expect(browserSummary.intCoordOffsetPosition).toEqual({ x: 1.5, y: 2.5 });
      expect(browserSummary.trajectorySegmentCount).toBeGreaterThan(1);
      expect(browserSummary.graphLinkCount).toBe(1);
    } finally {
      detachView(browserView, browserLayers);
      detachView(headlessView, headlessLayers);
    }
  });

  it('does not change render semantics when layer interaction is disabled', () => {
    const interactiveLayers = createSceneLayers();
    const passiveLayers = createSceneLayers();
    const interactiveView = new HeadlessEnvironmentView({
      width: 320,
      height: 240,
      createLeafer: createFakeLeafer,
      enableLayerInteraction: true,
    });
    const passiveView = new HeadlessEnvironmentView({
      width: 320,
      height: 240,
      createLeafer: createFakeLeafer,
      enableLayerInteraction: false,
    });

    try {
      attachLayers(interactiveView, interactiveLayers);
      attachLayers(passiveView, passiveLayers);
      interactiveView.fitToScene({ padding: 0 });
      passiveView.fitToScene({ padding: 0 });

      const interactiveSummary = summarize(interactiveView, interactiveLayers);
      const passiveSummary = summarize(passiveView, passiveLayers);

      expect(interactiveSummary).toEqual(passiveSummary);
      expect(interactiveLayers.every(({ layer }) => isLayerInteractionEnabled(layer) === true)).toBe(true);
      expect(passiveLayers.every(({ layer }) => isLayerInteractionEnabled(layer) === false)).toBe(true);

      interactiveView.enableLayerInteraction = false;
      expect(summarize(interactiveView, interactiveLayers)).toEqual(interactiveSummary);
      expect(interactiveLayers.every(({ layer }) => isLayerInteractionEnabled(layer) === false)).toBe(true);
    } finally {
      detachView(interactiveView, interactiveLayers);
      detachView(passiveView, passiveLayers);
    }
  });
});
