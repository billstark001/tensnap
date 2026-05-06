/**
 * cases/schellingScenario.ts
 *
 * Schelling Segregation Model benchmark case (web-scenario).
 *
 * Delegates to the shared createWebScenarioCase factory so that lifecycle
 * management (Scenario, EnvironmentRendererController, chart views, asset
 * resolution, session open/state_sync/tick/teardown) stays in one place.
 *
 * See createWebScenarioCase.ts for the shared implementation.
 */

import { SCHELLING_EXAMPLE } from '@tensnap/examples-js';
import { createWebScenarioCase, type WebScenarioHooks } from './createWebScenarioCase';
import type { BenchmarkCase } from '../types';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const SCHELLING_HOOKS: WebScenarioHooks = {
  name: 'Schelling Segregation Model (web-scenario)',

  createSession: (modelConfig) => SCHELLING_EXAMPLE.createSession(modelConfig),

  buildModelConfig(partial) {
    return {
      gridWidth: (partial.gridWidth as number) ?? 40,
      gridHeight: (partial.gridHeight as number) ?? 40,
      numAgentsType1: (partial.numAgentsType1 as number) ?? 500,
      numAgentsType2: (partial.numAgentsType2 as number) ?? 500,
      similarityThreshold: (partial.similarityThreshold as number) ?? 0.4,
      moveDistance: (partial.moveDistance as number) ?? 10,
    };
  },

  buildLayoutConfig(partial, modelConfig) {
    return {
      ...modelConfig,
      envWidth: (partial.envWidth as number) ?? 600,
      envHeight: (partial.envHeight as number) ?? 600,
      chartWidth: (partial.chartWidth as number) ?? 600,
      chartHeight: (partial.chartHeight as number) ?? 200,
    };
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createSchellingScenarioCase(partial: Record<string, unknown> = {}): BenchmarkCase {
  return createWebScenarioCase(partial, SCHELLING_HOOKS);
}

export const schellingScenarioVariations = [
  createSchellingScenarioCase({
    gridWidth: 30,
    gridHeight: 30,
    numAgentsType1: 400,
    numAgentsType2: 400,
    similarityThreshold: 0.8,
    moveDistance: 8,
    envWidth: 500,
    envHeight: 500,
  }),
  createSchellingScenarioCase({
    gridWidth: 40,
    gridHeight: 40,
    numAgentsType1: 700,
    numAgentsType2: 700,
    similarityThreshold: 0.85,
    moveDistance: 10,
    envWidth: 600,
    envHeight: 600,
  }),
  createSchellingScenarioCase({
    gridWidth: 80,
    gridHeight: 80,
    numAgentsType1: 2500,
    numAgentsType2: 2500,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
  createSchellingScenarioCase({
    gridWidth: 120,
    gridHeight: 120,
    numAgentsType1: 5800,
    numAgentsType2: 5800,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
];
