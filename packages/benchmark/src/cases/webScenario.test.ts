import { describe, expect, it, vi } from 'vitest';
import type { ISimulatorTransport } from '@tensnap/core';
import { createSchellingScenarioCase, schellingScenarioVariations } from './schellingScenario';
import { createWolfSheepScenarioCase, wolfSheepScenarioVariations } from './wolfSheepScenario';
import { createAxelrodScenarioCase, axelrodScenarioVariations } from './axelrodScenario';
import { createRandomWalkCases } from './randomWalk';
import { getCaseGroups } from './variations';
import { createWebScenarioCase } from './createWebScenarioCase';

describe('production web scenario benchmark definitions', () => {
  it.each([
    createSchellingScenarioCase(),
    createWolfSheepScenarioCase(),
    createAxelrodScenarioCase(),
  ])('$name only describes a model and mounts through the web host', (benchCase) => {
    expect(benchCase.actionId).toBe('start');
    expect(typeof benchCase.mount).toBe('function');
    expect(benchCase.config).toEqual(expect.objectContaining({ previewWidth: 1000, previewHeight: 760 }));
    expect(benchCase).not.toHaveProperty('tick');
    expect(benchCase).not.toHaveProperty('setup');
  });

  it('keeps the intended model-size variations', () => {
    expect(schellingScenarioVariations).toHaveLength(4);
    expect(wolfSheepScenarioVariations).toHaveLength(3);
    expect(axelrodScenarioVariations).toHaveLength(3);
  });

  it('defines the three requested suites and six component cases', () => {
    const groups = getCaseGroups();
    expect(groups.map((group) => group.category)).toEqual(['component', 'model', 'random-walk']);
    expect(groups[0].cases).toHaveLength(6);
    expect(groups[1].cases).toHaveLength(3);
    expect(createRandomWalkCases().map((benchCase) => benchCase.variant)).toEqual([
      'raw-leafer', 'layers-no-transport', 'production-transport',
    ]);
  });

  it('does not construct a second simulator session while defining a case', () => {
    const createTransport = vi.fn(() => ({}) as ISimulatorTransport);
    const benchCase = createWebScenarioCase({
      name: 'Custom',
      config: {},
      width: 800,
      height: 600,
      createTransport,
    });
    expect(benchCase.name).toBe('Custom');
    expect(createTransport).not.toHaveBeenCalled();
  });
});
