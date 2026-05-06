/**
 * scenario/utils/plan.test.ts
 *
 * Tests for the shared snapshot-to-render-plan conversion utilities.
 * These tests verify that `createRenderPlanFromSnapshot` correctly bridges
 * protocol-level snapshots to the runtime `RenderPlan` used by both hosts.
 */

import { describe, expect, it } from 'vitest';
import { createRenderPlanFromSnapshot } from './plan';
import type { ScenarioEnvironmentSnapshot } from '../types';

describe('createRenderPlanFromSnapshot', () => {
  const baseSnapshot: ScenarioEnvironmentSnapshot = {
    id: 'env-1',
    type: '2d',
    layers: [
      {
        id: 'layer-bg',
        layerType: 'background',
        metadata: { background: '#ffffff' },
        dependencyLayerIds: {},
        storageSnapshot: { kind: 'color', value: '#ffffff' },
      },
      {
        id: 'layer-grid',
        layerType: 'grid',
        metadata: { width: 10, height: 10 },
        dependencyLayerIds: {},
        storageSnapshot: { cells: [] },
      },
      {
        id: 'layer-agents',
        layerType: 'agent',
        metadata: {},
        dependencyLayerIds: {},
        storageSnapshot: {
          agents: [
            { id: 'agent-1', x: 5, y: 5, size: 1, color: '#ff0000' },
          ],
        },
      },
      {
        id: 'layer-edges',
        layerType: 'edge',
        metadata: { edges: [{ source: 'agent-1', target: 'agent-2' }] },
        dependencyLayerIds: { agent: 'layer-agents' },
        storageSnapshot: { edges: [{ source: 'agent-1', target: 'agent-2' }] },
      },
      {
        id: 'layer-traj',
        layerType: 'trajectory',
        metadata: {},
        dependencyLayerIds: { agent: 'layer-agents' },
        storageSnapshot: { trajectories: [] },
      },
    ],
  };

  it('produces a RenderPlan with correct environment id', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    expect(plan.environmentId).toBe('env-1');
  });

  it('includes background, grid, and agent layers in the plan', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    // Edge and trajectory layers require dependency links to agent layers
    expect(plan.layers.length).toBeGreaterThanOrEqual(3);
    const roles = plan.layers.map((l) => l.role);
    expect(roles).toContain('background');
    expect(roles).toContain('grid');
    expect(roles).toContain('agent');
  });

  it('assigns background layer the correct storage type', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    const bg = plan.layers.find((l) => l.kind === 'background');
    expect(bg).toBeDefined();
    expect(bg!.storage.getData()).toEqual({ kind: 'color', value: '#ffffff' });
  });

  it('assigns grid layer the correct storage type', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    const grid = plan.layers.find((l) => l.kind === 'grid');
    expect(grid).toBeDefined();
    expect(grid!.storage.getData()).toEqual(expect.objectContaining({ width: 10, height: 10 }));
  });

  it('assigns agent layer the correct storage type', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    const agent = plan.layers.find((l) => l.kind === 'agent');
    expect(agent).toBeDefined();
    const data = agent!.storage.getData();
    expect(data.agents.has('agent-1')).toBe(true);
    expect(data.agents.get('agent-1')).toMatchObject({ x: 5, y: 5, size: 1 });
  });

  it('assigns edge layer the correct storage type', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    const edge = plan.layers.find((l) => l.kind === 'edge');
    expect(edge).toBeDefined();
    const data = edge!.storage.getData();
    expect(data.edges.size).toBe(1);
  });

  it('assigns trajectory layer the correct storage type', () => {
    const plan = createRenderPlanFromSnapshot(baseSnapshot);
    const traj = plan.layers.find((l) => l.kind === 'trajectory');
    expect(traj).toBeDefined();
    const data = traj!.storage.getData();
    expect(data.trajectories).toBeDefined();
    expect(data.config).toBeDefined();
  });

  it('handles empty snapshot gracefully', () => {
    const empty: ScenarioEnvironmentSnapshot = {
      id: 'empty',
      type: '2d',
      layers: [],
    };
    const plan = createRenderPlanFromSnapshot(empty);
    expect(plan.layers).toHaveLength(0);
    expect(plan.agentLayers).toHaveLength(0);
  });

  it('ignores unknown layer types that are not in the layer registry', () => {
    const snapshot: ScenarioEnvironmentSnapshot = {
      id: 'env-2',
      type: '2d',
      layers: [
        {
          id: 'layer-unknown',
          layerType: 'unknown' as any,
          metadata: {},
          dependencyLayerIds: {},
          storageSnapshot: null,
        },
      ],
    };
    const plan = createRenderPlanFromSnapshot(snapshot);
    // Unknown layer types are filtered out by the layer registry
    expect(plan.layers).toHaveLength(0);
  });
});
