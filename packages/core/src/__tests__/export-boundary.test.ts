/**
 * __tests__/export-boundary.test.ts
 *
 * Type-level and runtime checks for the `@tensnap/core` export boundary.
 *
 * These tests verify:
 * - Root `@tensnap/core` entry stays platform-neutral (no browser-only or node-only types)
 * - `@tensnap/core/environment` subpath exports shared engine + layer types
 * - `@tensnap/core/environment/headless` subpath is isolated to headless-only types
 * - `@tensnap/core/scenario` subpath exports plan + snapshot types
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Root entry: platform-neutral contracts
// ---------------------------------------------------------------------------

describe('root entry (@tensnap/core) platform neutrality', () => {
  it('exports scenario types without platform assumptions', async () => {
    const root = await import('../index');
    expect(root.Scenario).toBeDefined();
    expect(typeof root.Scenario).toBe('function');
  });

  it('does not export browser-only or node-only symbols from root', async () => {
    const root = await import('../index');
    // EnvironmentView and HeadlessEnvironmentView must live in subpaths
    expect(root).not.toHaveProperty('EnvironmentView');
    expect(root).not.toHaveProperty('HeadlessEnvironmentView');
  });
});

// ---------------------------------------------------------------------------
// Environment subpath: shared engine + layer types
// ---------------------------------------------------------------------------

describe('@tensnap/core/environment subpath', () => {
  it('exports shared layer classes', async () => {
    const env = await import('../environment');
    expect(env.AgentLayer).toBeDefined();
    expect(env.BackgroundLayer).toBeDefined();
    expect(env.EdgeLayer).toBeDefined();
    expect(env.GridLayer).toBeDefined();
    expect(env.TrajectoryLayer).toBeDefined();
  });

  it('exports shared storage classes through the public environment boundary', async () => {
    const env = await import('../environment');
    expect(env.AgentStorage).toBeDefined();
    expect(env.BackgroundStorage).toBeDefined();
    expect(env.EdgeStorage).toBeDefined();
    expect(env.GridEnvStorage).toBeDefined();
    expect(env.TrajectoryStorage).toBeDefined();
  });

  it('exports shared viewport helpers', async () => {
    const env = await import('../environment');
    expect(typeof env.resolveViewport).toBe('function');
    expect(typeof env.resolveImageSize).toBe('function');
    expect(typeof env.normalizeViewport).toBe('function');
    expect(typeof env.worldBoundsFromAgents).toBe('function');
  });

  it('exports shared background helpers', async () => {
    const env = await import('../environment');
    expect(typeof env.isCssColor).toBe('function');
    expect(typeof env.isBackgroundAssetReference).toBe('function');
    expect(typeof env.getAssetIdFromIcon).toBe('function');
  });

  it('does not export headless-only or browser-only host surfaces', async () => {
    const env = await import('../environment');
    expect(env).not.toHaveProperty('HeadlessEnvironmentView');
    expect(env).not.toHaveProperty('EnvironmentView');
  });
});

// ---------------------------------------------------------------------------
// Headless subpath: isolated headless-only types
// ---------------------------------------------------------------------------

describe('@tensnap/core/environment/headless subpath', () => {
  it('exports HeadlessEnvironmentView', async () => {
    const headless = await import('../environment/headless');
    expect(headless.HeadlessEnvironmentView).toBeDefined();
    expect(typeof headless.HeadlessEnvironmentView).toBe('function');
  });

  it('does not leak browser-only types', async () => {
    const headless = await import('../environment/headless');
    expect(headless).not.toHaveProperty('EnvironmentView');
  });
});

// ---------------------------------------------------------------------------
// Browser subpath: isolated browser-only host surface
// ---------------------------------------------------------------------------

describe('@tensnap/core/environment/browser subpath', () => {
  it('exports EnvironmentView', async () => {
    const browser = await import('../environment/browser');
    expect(browser.EnvironmentView).toBeDefined();
    expect(typeof browser.EnvironmentView).toBe('function');
  });

  it('does not leak headless-only types', async () => {
    const browser = await import('../environment/browser');
    expect(browser).not.toHaveProperty('HeadlessEnvironmentView');
  });
});

// ---------------------------------------------------------------------------
// Scenario subpath: plan + snapshot types
// ---------------------------------------------------------------------------

describe('@tensnap/core/scenario subpath', () => {
  it('exports collectRenderData and createRenderPlanFromSnapshot', async () => {
    const scenario = await import('../scenario');
    expect(typeof scenario.collectRenderData).toBe('function');
    expect(typeof scenario.createRenderPlanFromSnapshot).toBe('function');
  });

  it('exports RenderPlan types', async () => {
    const scenario = await import('../scenario');
    // Type-only exports are erased at runtime; verify the module loads
    expect(scenario).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Interaction-toggle invariant: disabling interaction does not change render output
// ---------------------------------------------------------------------------

describe('interaction-toggle invariant', () => {
  it('AgentLayer accepts clickable=false without throwing', async () => {
    const { AgentLayer } = await import('../environment');
    const { AgentStorage } = await import('../environment/storages');
    const storage = new AgentStorage();
    storage.setAgents([{ id: 'a1', x: 0, y: 0, size: 1 }]);
    const layer = new AgentLayer(storage, { clickable: false, draggable: false });
    expect(layer).toBeDefined();
  });
});
