// @vitest-environment jsdom

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testHarness = vi.hoisted(() => {
  const environmentViewInstances: Array<{ fitToScene: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const gridLayerCalls: Array<{ storage: unknown }> = [];
  const backgroundLayerCalls: Array<{ storage: { background: string | null }; options?: { sceneBounds?: { width: number; height: number } } }> = [];
  const edgeLayerCalls: Array<{ storage: unknown; linkedAgentStorage: unknown; config: unknown }> = [];
  const agentLayerCalls: Array<{ storage: unknown; options: Record<string, unknown>; layer: { setSceneBounds: ReturnType<typeof vi.fn> } }> = [];

  class MockEnvironmentView {
    fitToScene = vi.fn();
    destroy = vi.fn();

    constructor(public node: HTMLElement, public options: Record<string, unknown>) {
      environmentViewInstances.push(this);
    }

    addLayer() {}
  }

  class MockAgentStorage {
    private agents = new Map<string | number, any>();

    constructor(initialAgents: any[] = []) {
      this.agents = new Map(initialAgents.map((agent) => [agent.id, agent]));
    }

    getAgent(id: string | number) {
      return this.agents.get(id);
    }

    subscribe() {
      return () => {};
    }
  }

  class MockBackgroundStorage {
    background: string | null = null;

    async setBackground(background: string) {
      this.background = background;
    }
  }

  class MockGridEnvStorage {}

  class MockEdgeStorage {}

  class MockBackgroundLayer {
    setSceneBounds = vi.fn();

    constructor(_view: unknown, public storage: MockBackgroundStorage, public options?: { sceneBounds?: { width: number; height: number } }) {
      backgroundLayerCalls.push({ storage, options });
    }
  }

  class MockGridLayer {
    constructor(_view: unknown, storage: unknown) {
      gridLayerCalls.push({ storage });
    }
  }

  class MockEdgeLayer {
    constructor(_view: unknown, storage: unknown, linkedAgentStorage: unknown, config: unknown) {
      edgeLayerCalls.push({ storage, linkedAgentStorage, config });
    }

    buildDragHandlers() {
      return { onDragStart: vi.fn(), onDrag: vi.fn(), onDragEnd: vi.fn() };
    }
  }

  class MockAgentLayer {
    setSceneBounds = vi.fn();

    constructor(_view: unknown, storage: unknown, options: Record<string, unknown>) {
      agentLayerCalls.push({ storage, options, layer: this });
    }
  }

  const mockStore = {
    scenario: {
      assets: {
        getUrl: vi.fn(),
      },
    },
    _assetRevision: 0,
  };

  return {
    environmentViewInstances,
    gridLayerCalls,
    backgroundLayerCalls,
    edgeLayerCalls,
    agentLayerCalls,
    MockEnvironmentView,
    MockAgentStorage,
    MockBackgroundStorage,
    MockGridEnvStorage,
    MockEdgeStorage,
    MockBackgroundLayer,
    MockGridLayer,
    MockEdgeLayer,
    MockAgentLayer,
    mockStore,
  };
});

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof testHarness.mockStore) => unknown) => selector(testHarness.mockStore),
}));

vi.mock('@lingui/react', async () => {
  const actual = await vi.importActual<typeof import('@lingui/react')>('@lingui/react');
  return {
    ...actual,
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../dialogs/AgentDetailsDialog', () => ({
  AgentDetailsDialog: () => null,
}));

vi.mock('@tensnap/core', () => ({
  EnvironmentView: testHarness.MockEnvironmentView,
  AgentStorage: testHarness.MockAgentStorage,
  BackgroundStorage: testHarness.MockBackgroundStorage,
  AgentLayer: testHarness.MockAgentLayer,
  BackgroundLayer: testHarness.MockBackgroundLayer,
  GridEnvStorage: testHarness.MockGridEnvStorage,
  GridLayer: testHarness.MockGridLayer,
  EdgeStorage: testHarness.MockEdgeStorage,
  EdgeLayer: testHarness.MockEdgeLayer,
}));

import { AgentStorage, BackgroundStorage, EdgeStorage, GridEnvStorage } from '@tensnap/core';
import { Environment2DView } from './Environment2DView';

describe('Environment2DView', () => {
  beforeEach(() => {
    testHarness.environmentViewInstances.length = 0;
    testHarness.gridLayerCalls.length = 0;
    testHarness.backgroundLayerCalls.length = 0;
    testHarness.edgeLayerCalls.length = 0;
    testHarness.agentLayerCalls.length = 0;
    testHarness.mockStore._assetRevision = 0;
    testHarness.mockStore.scenario.assets.getUrl.mockReset();
  });

  it('renders grid-style 2d layers with renderer overrides and grid metadata', async () => {
    const gridStorage = new GridEnvStorage();
    const agentStorage = new AgentStorage([{ id: 'agent-1', x: 1, y: 2 }]);

    render(
      <Environment2DView
        environment={{
          id: 'env-grid',
          type: '2d',
          layers: new Map([
            ['grid', { id: 'grid', layerType: 'grid', metadata: { width: 10, height: 12 }, storage: gridStorage }],
            ['agents', { id: 'agents', layerType: 'agent', metadata: { coord_offset: 'int' }, storage: agentStorage }],
          ]),
        } as any}
        view={{ id: 'view-grid', type: 'environment', data: { id: 'env-grid', type: '2d', rendererOverrides: { environment2d: { showGrid: false, fallbackBackgroundColor: '#ffffff' } } } } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.agentLayerCalls).toHaveLength(1);
    });

    expect(testHarness.gridLayerCalls).toHaveLength(0);
    expect(testHarness.backgroundLayerCalls).toHaveLength(1);
    expect(testHarness.backgroundLayerCalls[0].storage.background).toBe('#ffffff');
    expect(testHarness.agentLayerCalls[0].options.originMode).toBe('bottom-left');
    expect(testHarness.agentLayerCalls[0].options.coordOffset).toBe('int');
    expect(testHarness.agentLayerCalls[0].options.showLabel).toBe(false);
    expect(testHarness.agentLayerCalls[0].options.sceneBounds).toEqual({ width: 10, height: 12 });
    expect(testHarness.environmentViewInstances[0].fitToScene).toHaveBeenCalledWith({ padding: 0 });
  });

  it('renders edge-driven 2d layers with graph-like interaction config', async () => {
    const backgroundStorage = new BackgroundStorage();
    const agentStorage = new AgentStorage([{ id: 'agent-1', x: 0, y: 0 }]);
    const edgeStorage = new EdgeStorage();

    render(
      <Environment2DView
        environment={{
          id: 'env-graph',
          type: '2d',
          layers: new Map([
            ['background', { id: 'background', layerType: 'background', metadata: {}, storage: backgroundStorage }],
            ['agents', { id: 'agents', layerType: 'agent', metadata: {}, storage: agentStorage }],
            ['edges', { id: 'edges', layerType: 'edge', metadata: { linkDistance: 42 }, storage: edgeStorage, agentLayerRef: 'agents' }],
          ]),
        } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.edgeLayerCalls).toHaveLength(1);
      expect(testHarness.agentLayerCalls).toHaveLength(1);
    });

    expect(testHarness.edgeLayerCalls[0].linkedAgentStorage).toBe(agentStorage);
    expect(testHarness.edgeLayerCalls[0].config).toEqual({ linkDistance: 42 });
    expect(testHarness.agentLayerCalls[0].options.originMode).toBe('center');
    expect(testHarness.agentLayerCalls[0].options.coordOffset).toBe('float');
    expect(testHarness.agentLayerCalls[0].options.draggable).toBe(true);
    expect(testHarness.agentLayerCalls[0].options.showLabel).toBe(false);
    expect(testHarness.agentLayerCalls[0].options.onAgentDoubleClick).toEqual(expect.any(Function));
    expect(testHarness.environmentViewInstances[0].fitToScene).toHaveBeenCalledWith({ padding: 0.05 });
  });
});