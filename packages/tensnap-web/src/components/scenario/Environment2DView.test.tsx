// @vitest-environment jsdom

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testHarness = vi.hoisted(() => {
  const environmentViewInstances: Array<{ fitToScene: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const gridLayerCalls: Array<{ storage: unknown }> = [];
  const backgroundLayerCalls: Array<{ storage: { background: string | null }; options?: { sceneBounds?: { width: number; height: number } } }> = [];
  const edgeLayerCalls: Array<{ storage: unknown; linkedAgentStorage: unknown; config: unknown; layer: { setZIndex: ReturnType<typeof vi.fn> } }> = [];
  const trajectoryLayerCalls: Array<{ storage: unknown; options: Record<string, unknown>; layer: { setZIndex: ReturnType<typeof vi.fn> } }> = [];
  const agentLayerCalls: Array<{ storage: unknown; options: Record<string, unknown>; layer: { setSceneBounds: ReturnType<typeof vi.fn>; setZIndex: ReturnType<typeof vi.fn> } }> = [];
  const toastError = vi.fn();
  let edgeLayerError: Error | null = null;

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

  class MockTrajectoryStorage {
    subscribe() {
      return () => {};
    }
  }

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
    setZIndex = vi.fn();

    constructor(_view: unknown, storage: unknown, linkedAgentStorage: unknown, config: unknown) {
      if (edgeLayerError) {
        throw edgeLayerError;
      }
      edgeLayerCalls.push({ storage, linkedAgentStorage, config, layer: this });
    }

    buildDragHandlers() {
      return { onDragStart: vi.fn(), onDrag: vi.fn(), onDragEnd: vi.fn() };
    }
  }

  class MockAgentLayer {
    setSceneBounds = vi.fn();
    setZIndex = vi.fn();

    constructor(_view: unknown, storage: unknown, options: Record<string, unknown>) {
      agentLayerCalls.push({ storage, options, layer: this });
    }
  }

  class MockTrajectoryLayer {
    setZIndex = vi.fn();

    constructor(_view: unknown, storage: unknown, options: Record<string, unknown>) {
      trajectoryLayerCalls.push({ storage, options, layer: this });
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
    trajectoryLayerCalls,
    agentLayerCalls,
    toastError,
    get edgeLayerError() {
      return edgeLayerError;
    },
    set edgeLayerError(value: Error | null) {
      edgeLayerError = value;
    },
    MockEnvironmentView,
    MockAgentStorage,
    MockBackgroundStorage,
    MockGridEnvStorage,
    MockEdgeStorage,
    MockTrajectoryStorage,
    MockBackgroundLayer,
    MockGridLayer,
    MockEdgeLayer,
    MockAgentLayer,
    MockTrajectoryLayer,
    mockStore,
  };
});

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof testHarness.mockStore) => unknown) => selector(testHarness.mockStore),
}));

vi.mock('@/store/toast', () => ({
  useToast: () => ({
    error: testHarness.toastError,
  }),
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
  TrajectoryStorage: testHarness.MockTrajectoryStorage,
  TrajectoryLayer: testHarness.MockTrajectoryLayer,
}));

import { AgentStorage, BackgroundStorage, EdgeStorage, GridEnvStorage, TrajectoryStorage } from '@tensnap/core';
import { Environment2DView } from './Environment2DView';

describe('Environment2DView', () => {
  beforeEach(() => {
    testHarness.environmentViewInstances.length = 0;
    testHarness.gridLayerCalls.length = 0;
    testHarness.backgroundLayerCalls.length = 0;
    testHarness.edgeLayerCalls.length = 0;
    testHarness.trajectoryLayerCalls.length = 0;
    testHarness.agentLayerCalls.length = 0;
    testHarness.toastError.mockReset();
    testHarness.edgeLayerError = null;
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
    const trajectoryStorage = new TrajectoryStorage();

    render(
      <Environment2DView
        environment={{
          id: 'env-graph',
          type: '2d',
          layers: new Map([
            ['background', { id: 'background', layerType: 'background', metadata: {}, storage: backgroundStorage }],
            ['agents', { id: 'agents', layerType: 'agent', metadata: {}, storage: agentStorage }],
            ['edges', { id: 'edges', layerType: 'edge', metadata: { linkDistance: 42 }, storage: edgeStorage, dependencyLayerIds: { agent: 'agents' } }],
            ['trajectories', { id: 'trajectories', layerType: 'trajectory', metadata: {}, storage: trajectoryStorage, dependencyLayerIds: { agent: 'agents' } }],
          ]),
        } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.edgeLayerCalls).toHaveLength(1);
      expect(testHarness.trajectoryLayerCalls).toHaveLength(1);
      expect(testHarness.agentLayerCalls).toHaveLength(1);
    });

    expect(testHarness.edgeLayerCalls[0].linkedAgentStorage).toBe(agentStorage);
    expect(testHarness.edgeLayerCalls[0].config).toEqual({ linkDistance: 42 });
    expect(testHarness.trajectoryLayerCalls[0].storage).toBe(trajectoryStorage);
    expect(testHarness.trajectoryLayerCalls[0].options.coordOffset).toBe('float');
    expect(testHarness.agentLayerCalls[0].options.originMode).toBe('center');
    expect(testHarness.agentLayerCalls[0].options.coordOffset).toBe('float');
    expect(testHarness.agentLayerCalls[0].options.draggable).toBe(true);
    expect(testHarness.agentLayerCalls[0].options.showLabel).toBe(false);
    expect(testHarness.agentLayerCalls[0].options.onAgentDoubleClick).toEqual(expect.any(Function));
    expect(testHarness.environmentViewInstances[0].fitToScene).toHaveBeenCalledWith({ padding: 0.05 });
  });

  it('passes grid scene bounds to trajectory layers for wrap-aware rendering', async () => {
    const gridStorage = new GridEnvStorage();
    const agentStorage = new AgentStorage([{ id: 'agent-1', x: 1, y: 2 }]);
    const trajectoryStorage = new TrajectoryStorage();

    render(
      <Environment2DView
        environment={{
          id: 'env-trajectory-bounds',
          type: '2d',
          layers: new Map([
            ['grid', { id: 'grid', layerType: 'grid', metadata: { width: 10, height: 12 }, storage: gridStorage }],
            ['agents', { id: 'agents', layerType: 'agent', metadata: { coord_offset: 'float' }, storage: agentStorage }],
            ['trails', { id: 'trails', layerType: 'trajectory', metadata: {}, storage: trajectoryStorage, dependencyLayerIds: { agent: 'agents' } }],
          ]),
        } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.trajectoryLayerCalls).toHaveLength(1);
    });

    expect(testHarness.trajectoryLayerCalls[0].options.coordOffset).toBe('float');
    expect(testHarness.trajectoryLayerCalls[0].options.worldBounds).toEqual({ width: 10, height: 12 });
  });

  it('applies explicit layer z-index overrides from metadata', async () => {
    const lowerLayer = new AgentStorage([{ id: 'patch-1', x: 0, y: 0 }]);
    const upperLayer = new AgentStorage([{ id: 'hunter-1', x: 1, y: 1 }]);

    render(
      <Environment2DView
        environment={{
          id: 'env-z',
          type: '2d',
          layers: new Map([
            ['patches', { id: 'patches', layerType: 'agent', metadata: { z_index: 35 }, storage: lowerLayer }],
            ['hunters', { id: 'hunters', layerType: 'agent', metadata: { z_index: 45 }, storage: upperLayer }],
          ]),
        } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.agentLayerCalls).toHaveLength(2);
    });

    expect(testHarness.agentLayerCalls[0].layer.setZIndex).toHaveBeenCalledWith(35);
    expect(testHarness.agentLayerCalls[1].layer.setZIndex).toHaveBeenCalledWith(45);
  });

  it('assigns stable fallback z-index values to agent layers without metadata', async () => {
    const lowerLayer = new AgentStorage([{ id: 'patch-1', x: 0, y: 0 }]);
    const upperLayer = new AgentStorage([{ id: 'hunter-1', x: 1, y: 1 }]);

    render(
      <Environment2DView
        environment={{
          id: 'env-z-fallback',
          type: '2d',
          layers: new Map([
            ['patches', { id: 'patches', layerType: 'agent', metadata: {}, storage: lowerLayer }],
            ['hunters', { id: 'hunters', layerType: 'agent', metadata: {}, storage: upperLayer }],
          ]),
        } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.agentLayerCalls).toHaveLength(2);
    });

    expect(testHarness.agentLayerCalls[0].layer.setZIndex).toHaveBeenCalledWith(40);
    expect(testHarness.agentLayerCalls[1].layer.setZIndex).toHaveBeenCalledWith(41);
  });

  it('toasts when environment rendering fails', async () => {
    testHarness.edgeLayerError = new Error('node not found: missing-agent');

    const agentStorage = new AgentStorage([{ id: 'agent-1', x: 0, y: 0 }]);
    const edgeStorage = new EdgeStorage();

    render(
      <Environment2DView
        environment={{
          id: 'env-graph-error',
          type: '2d',
          layers: new Map([
            ['agents', { id: 'agents', layerType: 'agent', metadata: {}, storage: agentStorage }],
            ['edges', { id: 'edges', layerType: 'edge', metadata: {}, storage: edgeStorage, dependencyLayerIds: { agent: 'agents' } }],
          ]),
        } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.toastError).toHaveBeenCalledWith('Environment render failed', 'node not found: missing-agent');
    });

    expect(testHarness.environmentViewInstances[0].destroy).toHaveBeenCalledTimes(1);
  });
});