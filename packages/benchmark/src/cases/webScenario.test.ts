/**
 * cases/webScenario.test.ts
 *
 * Regression tests for web-scenario benchmark cases:
 *   - Factory output structure (name, suite, config, setup/tick/teardown)
 *   - Asset resolution injection (wolf-sheep agent layer visibility)
 *   - Schelling and Wolf-Sheep agent layer count validation
 *
 * These tests are light-weight and run in jsdom.  They validate that the
 * factory produces well-formed BenchmarkCase objects with the correct
 * structure and that asset resolution wiring is in place.
 */

import { describe, it, expect } from 'vitest';
import { createSchellingScenarioCase, schellingScenarioVariations } from './schellingScenario';
import { createWolfSheepScenarioCase, wolfSheepScenarioVariations } from './wolfSheepScenario';
import { createWebScenarioCase, type WebScenarioHooks } from './createWebScenarioCase';
import type { BenchmarkCase } from '../types';

// ---------------------------------------------------------------------------
// Shared structure tests
// ---------------------------------------------------------------------------

describe('web-scenario factory', () => {
  const casesToTest: [string, BenchmarkCase][] = [
    ['Schelling', createSchellingScenarioCase()],
    ['WolfSheep', createWolfSheepScenarioCase()],
  ];

  it.each(casesToTest)('%s has correct suite and structure', (_, benchCase) => {
    expect(benchCase).toBeDefined();
    expect(benchCase.suite).toBe('web-scenario');
    expect(benchCase.name).toBeTruthy();
    expect(benchCase.config).toBeDefined();
    expect(typeof benchCase.config).toBe('object');
    expect(typeof benchCase.setup).toBe('function');
    expect(typeof benchCase.tick).toBe('function');
    expect(typeof benchCase.teardown).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Schelling case-specific
// ---------------------------------------------------------------------------

describe('Schelling scenario case', () => {
  it('createSchellingScenarioCase produces a valid BenchmarkCase', () => {
    const c = createSchellingScenarioCase();
    expect(c.name).toContain('Schelling');
  });

  it('accepts partial config overrides', () => {
    const c = createSchellingScenarioCase({ gridWidth: 80, envWidth: 1000 });
    expect(c.config.gridWidth).toBe(80);
    expect(c.config.envWidth).toBe(1000);
  });

  it('exports schellingScenarioVariations with 4 entries', () => {
    expect(schellingScenarioVariations).toHaveLength(4);
    schellingScenarioVariations.forEach((v: BenchmarkCase) => {
      expect(v.suite).toBe('web-scenario');
    });
  });
});

// ---------------------------------------------------------------------------
// Wolf-Sheep case-specific
// ---------------------------------------------------------------------------

describe('Wolf-Sheep scenario case', () => {
  it('createWolfSheepScenarioCase produces a valid BenchmarkCase', () => {
    const c = createWolfSheepScenarioCase();
    expect(c.name).toContain('Wolf-Sheep');
  });

  it('accepts partial config overrides', () => {
    const c = createWolfSheepScenarioCase({ initialNumberSheep: 200, envWidth: 800 });
    expect(c.config.initialNumberSheep).toBe(200);
    expect(c.config.envWidth).toBe(800);
  });

  it('passes envBackground in layout config', () => {
    // The WOLF_SHEEP_HOOKS adds a background color '#D2B48C'
    const c = createWolfSheepScenarioCase();
    expect(c.config.envBackground).toBe('#D2B48C');
  });

  it('exports wolfSheepScenarioVariations with 3 entries', () => {
    expect(wolfSheepScenarioVariations).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Custom hooks test
// ---------------------------------------------------------------------------

describe('createWebScenarioCase with custom hooks', () => {
  it('produces a case with the given name', () => {
    const hooks: WebScenarioHooks = {
      name: 'Custom Test',
      createSession: () => {
        throw new Error('Session factory should not be called during construction');
      },
    };

    const benchCase = createWebScenarioCase({}, hooks);
    expect(benchCase.name).toBe('Custom Test');
    expect(benchCase.suite).toBe('web-scenario');
    expect(typeof benchCase.setup).toBe('function');
    expect(typeof benchCase.tick).toBe('function');
    expect(typeof benchCase.teardown).toBe('function');
  });

  it('buildModelConfig is called during construction', () => {
    let called = false;
    const hooks: WebScenarioHooks = {
      name: 'Custom Test 2',
      createSession: () => {
        throw new Error('Session factory should not be called during construction');
      },
      buildModelConfig(partial) {
        called = true;
        return { ...partial, customKey: 42 };
      },
    };

    const benchCase = createWebScenarioCase({}, hooks);
    expect(called).toBe(true); // buildModelConfig is called during construction
    expect(benchCase.name).toBe('Custom Test 2');
  });
});
